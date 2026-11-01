import { describe, expect, it } from 'vitest';
import { id, Profissional, validarCompetencias, validarData, validarProfissional, validarProjeto, type Candidato, type EstadoProjeto, type Papel, type ProfissionalDados, type ProjetoDados } from '../src/domain/model.js';
import { ProjetoFiccao } from '../src/domain/projetos.js';
import { CalculadorCompatibilidade, GeradorRelatorio, ValidadorConsistencia } from '../src/domain/visitors.js';
import { OrquestradorEquipe, OrquestradorPadrao, type Composicao } from '../src/recommendation/orchestrator.js';
import { cosseno, estrategias, mediaAvaliacoes, type RecomendacaoStrategy } from '../src/recommendation/strategies.js';
import { RegistroPrototipos } from '../src/domain/prototipos.js';
import { comServicos, profissionaisExemplo, projetoExemplo } from '../scripts/fixtures.js';

const projeto = (): ProjetoDados => comServicos({ ...projetoExemplo(), id: id() });
const profissionais = (): ProfissionalDados[] => profissionaisExemplo().map(p => ({ ...p, id: id() }));
const ficcao = () => RegistroPrototipos.padrao().obter('ficcao').criarFabrica();
// Com `estrategia`, a fábrica de ficção passa a fornecer esse recomendador ao orquestrador.
const orquestrador = (estrategia?: RecomendacaoStrategy) => {
  const fabrica = ficcao();
  if (estrategia) fabrica.criarRecomendador = () => estrategia;
  return new OrquestradorPadrao(fabrica);
};
describe('Strategy', () => {
  it('trocar a estratégia muda a equipe e o custo', () => {
    const p = projeto(), lista = profissionais(), o = orquestrador();
    const tecnico = o.orquestrar({ ...p, estrategia: 'cosseno' }, lista);
    const colaborativo = o.orquestrar({ ...p, estrategia: 'colaborativa' }, lista);
    const economico = o.orquestrar({ ...p, estrategia: 'orcamento' }, lista);
    expect(tecnico.membros).toHaveLength(6);
    expect(tecnico.membros.every(m => m.preco === 1200)).toBe(true);
    expect(colaborativo.membros.every(m => m.preco === 400)).toBe(true);
    expect(economico.membros.every(m => m.preco === 400)).toBe(true);
    expect(economico.faltantes).toEqual([]);
  });
  it('cosseno trata vetores vazios, zero e nomes normalizados', () => {
    expect(cosseno([], [])).toBe(0);
    expect(cosseno([{ nome: 'Som', nivel: 1 }], [{ nome: ' som ', nivel: 1 }])).toBe(1);
    expect(cosseno([{ nome: 'x', nivel: 1 }], [{ nome: 'y', nivel: 1 }])).toBe(0);
    const vetor = Array.from({ length: 20 }, (_, i) => ({ nome: `c${i}`, nivel: 1 }));
    expect(cosseno(vetor, vetor)).toBe(1);
    expect(cosseno(vetor, vetor.map(c => ({ ...c, nome: `outro-${c.nome}` })))).toBe(0);
  });
  it('filtragem colaborativa usa produtores semelhantes e tem fallback sem histórico', () => {
    const p = projeto(); p.produtorId = 'novo';
    const lista = profissionais(); lista[0]!.avaliacoes = [];
    expect(mediaAvaliacoes(lista[0]!)).toBe(0.5);
    const ranking = estrategias.colaborativa.recomendar(p, lista);
    expect(ranking.get('DIRETOR')![0]!.pontuacao).toBe(1);
    p.parametros.notaMinima = 0.9;
    expect(estrategias.colaborativa.recomendar(p, lista).get('DIRETOR')!.some(c => c.profissionalId === lista[0]!.id)).toBe(false);
  });
  it('desempata de forma determinística por id', () => {
    const p = projeto(), a = profissionais()[0]!;
    const b = { ...a, id: 'a' }, c = { ...a, id: 'b' };
    expect(estrategias.cosseno.recomendar(p, [c, b]).get('DIRETOR')!.map(x => x.profissionalId)).toEqual(['a', 'b']);
  });
  it('orçamento zero só admite profissionais gratuitos', () => {
    const p = projeto(); p.orcamento = 0;
    const lista = profissionais(); lista[0]!.preco = 0;
    expect(orquestrador().orquestrar({ ...p, estrategia: 'orcamento' }, lista).membros).toHaveLength(1);
  });
});
describe('Template Method', () => {
  it('seleciona os melhores independentes e mantém a busca quando disputam o mesmo profissional', () => {
    const p = projeto(); p.papeis = p.papeis.slice(0, 2).map(papel => ({ ...papel, peso: 1 })); p.orcamento = 200;
    const candidato = (profissionalId: string, pontuacao: number, preco = 50): Candidato => ({ profissionalId, nome: profissionalId, pontuacao, preco });
    const ranking = new Map<Papel, Candidato[]>([
      [p.papeis[0]!.papel, [candidato('a', 1), candidato('b', 0.8)]],
      [p.papeis[1]!.papel, [candidato('c', 1), candidato('d', 0.7)]],
    ]);
    const estrategia = { recomendar: () => ranking };
    const o = orquestrador(estrategia);
    expect(o.orquestrar(p, []).membros.map(m => m.profissionalId)).toEqual(['a', 'c']);
    ranking.set(p.papeis[1]!.papel, [candidato('a', 1), candidato('d', 0.7)]);
    const resultado = o.orquestrar(p, []);
    expect(new Set(resultado.membros.map(m => m.profissionalId)).size).toBe(2);
    expect(resultado.membros.reduce((s, m) => s + m.pontuacao, 0)).toBeCloseTo(1.8);
    ranking.set(p.papeis[0]!.papel, [candidato('a', 1, 150), candidato('b', 0.8)]);
    ranking.set(p.papeis[1]!.papel, [candidato('c', 1, 150), candidato('d', 0.7)]);
    expect(o.orquestrar(p, []).membros.reduce((s, m) => s + m.preco, 0)).toBeLessThanOrEqual(200);
  });
  it('executa as etapas em ordem e impede substituição do método principal', () => {
    const chamadas: string[] = [];
    class Instrumentado extends OrquestradorEquipe {
      protected validarRestricoes(): void { chamadas.push('validar'); }
      protected normalizarDados(_p: ProjetoDados, lista: ProfissionalDados[]): ProfissionalDados[] { chamadas.push('normalizar'); return lista; }
      protected posProcessar(_p: ProjetoDados, ranking: Map<Papel, Candidato[]>): Composicao { chamadas.push('posProcessar'); return { ranking, membros: [], faltantes: [] }; }
    }
    const fabrica = ficcao();
    fabrica.criarRecomendador = () => ({ recomendar: () => { chamadas.push('recomendar'); return new Map(); } });
    const o = new Instrumentado(fabrica);
    o.orquestrar(projeto(), []);
    expect(chamadas).toEqual(['validar', 'normalizar', 'recomendar', 'posProcessar']);
    expect(() => Object.defineProperty(o, 'orquestrar', { value: () => undefined })).toThrow();
  });
  it('respeita orçamento, disponibilidade, local e exclusões', () => {
    const p = projeto(), lista = profissionais(); p.orcamento = 2400;
    const resultado = orquestrador().orquestrar({ ...p, estrategia: 'cosseno' }, lista);
    expect(resultado.membros.reduce((s, m) => s + m.preco, 0)).toBeLessThanOrEqual(2400);
    expect(resultado.faltantes).toEqual([]);
    lista.forEach(x => { x.disponibilidade.fim = '2026-01-01'; });
    expect(orquestrador().orquestrar({ ...p, estrategia: 'cosseno' }, lista).faltantes).toHaveLength(6);
    const remoto = profissionais()[0]!; remoto.remoto = true; remoto.localizacao = 'Recife';
    expect(orquestrador().orquestrar({ ...p, estrategia: 'cosseno' }, [remoto]).membros).toHaveLength(1);
    remoto.remoto = false;
    expect(orquestrador().orquestrar({ ...p, estrategia: 'cosseno' }, [remoto]).membros).toHaveLength(0);
    remoto.remoto = true;
    expect(orquestrador().orquestrar({ ...p, estrategia: 'cosseno' }, [remoto], [], { DIRETOR: [remoto.id] }).membros).toHaveLength(0);
  });
  it('não repete profissional e não troca membros fixos', () => {
    const p = projeto(), lista = profissionais();
    lista[0]!.papeis = ['DIRETOR', 'EDITOR'];
    const o = orquestrador(), original = o.orquestrar({ ...p, estrategia: 'cosseno' }, lista);
    const fixos = original.membros.filter(m => m.papel !== 'EDITOR');
    const atualizado = o.orquestrar({ ...p, estrategia: 'orcamento' }, lista, fixos);
    expect(new Set(atualizado.membros.map(m => m.profissionalId)).size).toBe(atualizado.membros.length);
    for (const fixo of fixos) expect(atualizado.membros).toContainEqual(fixo);
    expect(() => o.orquestrar({ ...p, orcamento: 0, estrategia: 'cosseno' }, lista, fixos)).toThrow('fixos');
  });
  it('encontra equipe viável em casos comparados com busca exaustiva', () => {
    let seed = 12345;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let caso = 0; caso < 100; caso++) {
      const p = projeto(); p.papeis = p.papeis.slice(0, 4); p.orcamento = Math.floor(random() * 20);
      const lista = Array.from({ length: 6 }, (_, i) => ({ ...profissionais()[0]!, id: String(i), preco: Math.floor(random() * 10), papeis: p.papeis.filter(() => random() < 0.5).map(x => x.papel) }));
      function viavel(indice: number, usados: Set<string>, custo: number): boolean {
        if (indice === p.papeis.length) return custo <= p.orcamento;
        return lista.some(prof => !usados.has(prof.id) && prof.papeis.includes(p.papeis[indice]!.papel) && viavel(indice + 1, new Set([...usados, prof.id]), custo + prof.preco));
      }
      const resultado = orquestrador().orquestrar({ ...p, estrategia: 'orcamento' }, lista);
      expect(resultado.faltantes.length === 0).toBe(viavel(0, new Set(), 0));
    }
  });
});
describe('Visitor e validações do domínio', () => {
  it('opera sobre o mesmo projeto sem modificar seu estado', () => {
    const p = projeto(), resultado = orquestrador().orquestrar({ ...p, estrategia: 'cosseno' }, profissionais());
    const estado: EstadoProjeto = { projeto: p, equipe: { id: id(), membros: resultado.membros, status: 'sugerida', custo: 7200 },
      recomendacao: { id: id(), criadaEm: '', estrategia: 'cosseno', ranking: {}, faltantes: [], avisos: [], degradada: false }, convites: [], excluidos: {}, pagamentos: [], versao: 1 };
    const entidade = new ProjetoFiccao(estado), antes = structuredClone(estado);
    expect(entidade.aceitar(new ValidadorConsistencia())).toEqual(['Há membros sem confirmação de ambas as partes.']);
    expect(entidade.aceitar(new CalculadorCompatibilidade())).toBeGreaterThan(0);
    expect(entidade.aceitar(new GeradorRelatorio())).toContain('Curta independente');
    expect(estado).toEqual(antes);
    estado.equipe.membros.forEach(m => { m.confirmado = true; m.aceitoProdutor = true; });
    expect(entidade.aceitar(new ValidadorConsistencia())).toEqual([]);
    expect(entidade.aceitar(new GeradorRelatorio())).toContain('confirmado');
    estado.equipe.membros.push(estado.equipe.membros[0]!);
    estado.projeto.orcamento = 1;
    expect(entidade.aceitar(new ValidadorConsistencia())).toEqual(['Orçamento excedido.', 'Profissional repetido na equipe.']);
    estado.equipe.membros = [];
    expect(entidade.aceitar(new ValidadorConsistencia())).toContain('Há papéis sem profissional.');
    expect(entidade.aceitar(new CalculadorCompatibilidade())).toBe(0);
  });
  it('visita profissionais e valida datas e competências', () => {
    expect(() => validarData('2027-02-30')).toThrow('Data inválida');
    expect(() => validarData('inválida')).toThrow('Data inválida');
    const p = profissionais()[0]!, entidade = new Profissional(p);
    expect(entidade.aceitar(new ValidadorConsistencia())).toEqual([]);
    expect(entidade.aceitar(new CalculadorCompatibilidade())).toBe(0.6);
    expect(entidade.aceitar(new GeradorRelatorio())).toContain(p.nome);
    p.disponibilidade.fim = '2020-01-01';
    expect(entidade.aceitar(new ValidadorConsistencia())).toContain('Disponibilidade inválida.');
    expect(() => validarProfissional(p)).toThrow('Disponibilidade');
    p.disponibilidade.fim = '2030-01-01';
    p.avaliacoes.push(p.avaliacoes[0]!);
    expect(() => validarProfissional(p)).toThrow('avaliação');
    expect(() => validarCompetencias([{ nome: 'Som', nivel: 1 }, { nome: 'som', nivel: 0.5 }])).toThrow('duplicadas');
    const proj = projeto(); proj.prazo = '2020-01-01';
    expect(() => validarProjeto(proj)).toThrow('início');
    proj.prazo = '2028-01-01'; proj.papeis.push(proj.papeis[0]!);
    expect(() => validarProjeto(proj)).toThrow('únicos');
    proj.papeis.pop(); proj.parametros = { pesoTecnico: 0, pesoHistorico: 0, notaMinima: 0 };
    expect(() => validarProjeto(proj)).toThrow('peso');
  });
  it('percorre os profissionais ligados ao projeto', () => {
    const p = projeto(), lista = profissionais(), resultado = orquestrador().orquestrar({ ...p, estrategia: 'cosseno' }, lista);
    const estado: EstadoProjeto = { projeto: p, equipe: { id: id(), membros: resultado.membros, status: 'sugerida', custo: 7200 }, recomendacao: { id: id(), criadaEm: '', estrategia: 'cosseno', ranking: {}, faltantes: [], avisos: [], degradada: false }, convites: [], excluidos: {}, pagamentos: [], versao: 1 };
    const prof = new Profissional(lista[0]!); prof.dados.disponibilidade.fim = '2020-01-01';
    const entidade = new ProjetoFiccao(estado, [prof]);
    expect(entidade.aceitar(new ValidadorConsistencia()).length).toBeGreaterThan(2);
    expect(entidade.aceitar(new GeradorRelatorio())).toContain('avaliação');
    expect(entidade.aceitar(new CalculadorCompatibilidade())).toBeGreaterThan(0);
  });
});
