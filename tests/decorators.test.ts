import { performance } from 'node:perf_hooks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { id, type Candidato, type NomeDecorador, type Papel, type ProfissionalDados, type ProjetoDados } from '../src/domain/model.js';
import { criarApp } from '../src/http/app.js';
import { RepositorioMemoria } from '../src/infrastructure/memory-repository.js';
import { ArmazemCacheRecomendacao, AuditoriaDecorator, CacheDecorator, CompressaoDecorator, MedidorCompressao, MontadorPilhaRecomendacao, POLITICA_PADRAO, RegistroAuditoriaRecomendacao } from '../src/recommendation/decorators.js';
import { cosseno, descreverRecomendador, RecomendadorBase, SimilaridadeCosseno, type Pontuador, type RecomendacaoStrategy } from '../src/recommendation/strategies.js';
import { comServicos, profissionaisExemplo, projetoExemplo } from '../scripts/fixtures.js';

const projeto = (ajustes: Partial<ProjetoDados> = {}): ProjetoDados => comServicos({ ...projetoExemplo(), id: id(), ...ajustes });
const profissionais = (): ProfissionalDados[] => profissionaisExemplo().map(p => ({ ...p, id: id() }));
/** Recomendador base lento e instrumentado; nenhum decorador o modifica. */
class RecomendadorLento extends RecomendadorBase {
  chamadas = 0;
  constructor(private readonly atrasoMs = 25) { super(); }
  protected criarPontuador(): Pontuador {
    this.chamadas++;
    const fim = performance.now() + this.atrasoMs;
    while (performance.now() < fim) { /* simula um cálculo caro */ }
    return (prof, competencias) => cosseno(competencias, prof.competencias);
  }
}
const medir = (acao: () => unknown) => { const inicio = performance.now(); acao(); return performance.now() - inicio; };

describe('Decorator: cache', () => {
  it('reduz o tempo de resposta de requisições repetidas sem alterar o resultado', () => {
    const base = new RecomendadorLento(), recomendador = new CacheDecorator(base);
    const p = projeto(), lista = profissionais();
    let primeiro: Map<string, unknown> | undefined, segundo: Map<string, unknown> | undefined;
    const frio = medir(() => { primeiro = recomendador.recomendar(p, lista); });
    const quente = medir(() => { segundo = recomendador.recomendar(p, lista); });
    expect(base.chamadas).toBe(1);
    expect(quente).toBeLessThan(frio / 2);
    expect(segundo).toEqual(primeiro);
    // Projeto semelhante (outro id e título, mesmos requisitos) reaproveita o cache.
    recomendador.recomendar({ ...p, id: id(), titulo: 'Outro título' }, lista);
    expect(base.chamadas).toBe(1);
  });
  it('separa requisitos, catálogos e estratégias diferentes, e devolve cópias', () => {
    const armazem = new ArmazemCacheRecomendacao();
    const base = new RecomendadorLento(0), recomendador = new CacheDecorator(base, armazem);
    const p = projeto(), lista = profissionais();
    const resultado = recomendador.recomendar(p, lista);
    resultado.get('DIRETOR')!.length = 0;
    expect(recomendador.recomendar(p, lista).get('DIRETOR')!.length).toBe(3);
    recomendador.recomendar({ ...p, orcamento: 100 }, lista);
    recomendador.recomendar(p, profissionais());
    new CacheDecorator(new SimilaridadeCosseno(), armazem).recomendar(p, lista);
    expect(base.chamadas).toBe(3);
    expect(armazem.metricas()).toMatchObject({ entradas: 4, acertos: 1, falhas: 4 });
  });
  it('expira entradas pelo TTL e descarta a menos usada ao atingir a capacidade', () => {
    let agora = 0;
    const armazem = new ArmazemCacheRecomendacao(2, 1000, () => agora);
    const ranking = new Map<Papel, Candidato[]>([['DIRETOR', []]]);
    armazem.guardar('a', ranking); armazem.guardar('b', ranking);
    expect(armazem.obter('a')).toBeDefined();
    armazem.guardar('c', ranking);
    expect(armazem.obter('b')).toBeUndefined();
    agora = 1500;
    expect(armazem.obter('a')).toBeUndefined();
    armazem.limpar();
    expect(armazem.metricas().entradas).toBe(0);
  });
});

describe('Decorator: auditoria', () => {
  it('registra todas as chamadas, o tempo de resposta e as falhas', () => {
    const registro = new RegistroAuditoriaRecomendacao(2), logs: unknown[] = [];
    const logger = { info: (obj: unknown) => logs.push(obj), error: (obj: unknown) => logs.push(obj) };
    const recomendador = new AuditoriaDecorator(new RecomendadorLento(1), registro, logger);
    const p = projeto(), lista = profissionais();
    for (let i = 0; i < 3; i++) recomendador.recomendar(p, lista);
    const falha: RecomendacaoStrategy = { recomendar: () => { throw new Error('motor fora do ar'); } };
    expect(() => new AuditoriaDecorator(falha, registro, logger).recomendar(p, lista)).toThrow('motor fora do ar');
    expect(registro.total).toBe(4);
    const [penultima, ultima] = registro.listar();
    expect(penultima).toMatchObject({ projetoId: p.id, tipo: 'ficcao', estrategia: 'cosseno', recomendador: 'RecomendadorLento', profissionais: 18, candidatos: 18, sucesso: true });
    expect(penultima!.duracaoMs).toBeGreaterThanOrEqual(1);
    expect(ultima).toMatchObject({ sucesso: false, erro: 'motor fora do ar', candidatos: 0 });
    expect(logs).toHaveLength(4);
  });
});

describe('Decorator: compressão', () => {
  it('reduz o tamanho dos dados transmitidos sem perder informação', () => {
    const medidor = new MedidorCompressao();
    const base = new SimilaridadeCosseno(), recomendador = new CompressaoDecorator(base, medidor);
    const p = projeto(), lista = profissionais();
    expect(recomendador.recomendar(p, lista)).toEqual(base.recomendar(p, lista));
    const { original, comprimido } = medidor.ultima!;
    expect(comprimido).toBeLessThan(original);
    expect(medidor.metricas()).toMatchObject({ chamadas: 1, bytesOriginais: original, bytesComprimidos: comprimido });
    expect(medidor.metricas().reducao).toBeGreaterThan(0.2);
    const json = JSON.stringify([...base.recomendar(p, lista)]);
    expect(CompressaoDecorator.descomprimir(CompressaoDecorator.comprimir(json))).toEqual(base.recomendar(p, lista));
    expect(new MedidorCompressao().metricas().reducao).toBe(0);
  });
});

describe('Decorator: composição em tempo de execução', () => {
  const ORDENS: NomeDecorador[][] = [
    ['cache', 'auditoria', 'compressao'], ['cache', 'compressao', 'auditoria'], ['auditoria', 'cache', 'compressao'],
    ['auditoria', 'compressao', 'cache'], ['compressao', 'cache', 'auditoria'], ['compressao', 'auditoria', 'cache'],
  ];
  it.each(ORDENS)('combina %s, %s e %s com o mesmo resultado do recomendador base', (...ordem) => {
    const base = new SimilaridadeCosseno(), montador = new MontadorPilhaRecomendacao();
    const recomendador = montador.montar(base, ordem);
    const p = projeto(), lista = profissionais();
    expect(recomendador.recomendar(p, lista)).toEqual(base.recomendar(p, lista));
    expect(recomendador.recomendar(p, lista)).toEqual(base.recomendar(p, lista));
    expect(descreverRecomendador(recomendador)).toBe([...ordem].reverse().map(n => ({ cache: 'CacheDecorator', auditoria: 'AuditoriaDecorator', compressao: 'CompressaoDecorator' })[n]).concat('SimilaridadeCosseno').join(' > '));
    // A ordem muda o efeito: auditoria por fora do cache vê as 2 chamadas; por dentro, só a primeira.
    expect(montador.auditoria.total).toBe(ordem.indexOf('auditoria') > ordem.indexOf('cache') ? 2 : 1);
  });
  it('valida, lê e troca a política sem alterar o SistemaRecomendacao', () => {
    expect(MontadorPilhaRecomendacao.lerPolitica(undefined)).toEqual([...POLITICA_PADRAO]);
    expect(MontadorPilhaRecomendacao.lerPolitica('')).toEqual([]);
    expect(MontadorPilhaRecomendacao.lerPolitica(' compressao , cache ')).toEqual(['compressao', 'cache']);
    expect(() => MontadorPilhaRecomendacao.lerPolitica('cache,zip')).toThrow('Decorador desconhecido: zip');
    expect(() => new MontadorPilhaRecomendacao({ politica: ['cache', 'cache'] })).toThrow('uma única vez');
    const montador = new MontadorPilhaRecomendacao({ politica: ['auditoria'] });
    const base = new SimilaridadeCosseno();
    expect(montador.montar(base)).toBeInstanceOf(AuditoriaDecorator);
    expect(montador.montar(base, [])).toBe(base);
    montador.definirPolitica(['cache']);
    expect(montador.montar(base)).toBeInstanceOf(CacheDecorator);
    expect(montador.politica).toEqual(['cache']);
  });
});

describe('Decorator pela API', () => {
  let contexto: ReturnType<typeof criarApp>;
  beforeEach(async () => {
    contexto = criarApp(new RepositorioMemoria(), { processarEventos: false });
    for (const p of profissionaisExemplo()) await contexto.sistema.cadastrarProfissional(p);
  });
  afterEach(async () => { await contexto.app.close(); });
  const criar = async (corpo: object) => {
    const r = await contexto.app.inject({ method: 'POST', url: '/projetos', payload: corpo });
    expect(r.statusCode, r.body).toBe(201);
    return r.json();
  };
  it('aplica a política do sistema e a preferência de cada produtor', async () => {
    // Política padrão: cache e auditoria. O segundo projeto semelhante sai do cache.
    await criar(projetoExemplo());
    await criar({ ...projetoExemplo(), titulo: 'Outro curta' });
    let metricas = (await contexto.app.inject('/recomendador')).json();
    expect(metricas).toMatchObject({ politica: ['cache', 'auditoria'], cache: { acertos: 1, falhas: 1 }, auditoria: { total: 2 }, compressao: { chamadas: 0 } });
    expect(metricas.auditoria.ultimas[0].recomendador).toBe('CacheDecorator > SimilaridadeCosseno');
    // O produtor pede só compressão para o seu projeto.
    await criar({ ...projetoExemplo(), decoradores: ['compressao'] });
    metricas = (await contexto.app.inject('/recomendador')).json();
    expect(metricas).toMatchObject({ auditoria: { total: 2 }, compressao: { chamadas: 1 } });
    expect(metricas.compressao.ultima.comprimido).toBeLessThan(metricas.compressao.ultima.original);
    // A política do sistema muda em tempo de execução.
    const troca = await contexto.app.inject({ method: 'PUT', url: '/recomendador/decoradores', payload: { decoradores: ['auditoria', 'compressao'] } });
    expect(troca.json()).toEqual({ politica: ['auditoria', 'compressao'] });
    await criar(projetoExemplo());
    metricas = (await contexto.app.inject('/recomendador')).json();
    expect(metricas).toMatchObject({ auditoria: { total: 3 }, compressao: { chamadas: 2 } });
    expect((await contexto.app.inject({ method: 'PUT', url: '/recomendador/decoradores', payload: { decoradores: ['zip'] } })).statusCode).toBe(400);
    expect((await contexto.app.inject({ method: 'POST', url: '/projetos', payload: { ...projetoExemplo(), decoradores: ['cache', 'cache'] } })).statusCode).toBe(400);
  });
  it('um cadastro novo invalida o cache, e a estratégia pode ser fixada em tempo de execução', async () => {
    const primeiro = await criar(projetoExemplo());
    await contexto.sistema.cadastrarProfissional({ ...profissionaisExemplo()[0]!, nome: 'Nova Diretora', email: 'nova@example.com' });
    await criar(projetoExemplo());
    expect((await contexto.app.inject('/recomendador')).json().cache).toMatchObject({ acertos: 0, falhas: 2 });
    // Estratégia fixa: o pior candidato vira o melhor, sem mudar a fábrica nem o orquestrador.
    class PrefereMaisBarato extends RecomendadorBase {
      protected criarPontuador(): Pontuador { return prof => 1 - prof.preco / 2000; }
    }
    contexto.sistema.definirEstrategia(new PrefereMaisBarato());
    const fixo = await criar(projetoExemplo());
    expect(fixo.equipe.membros.every((m: { preco: number }) => m.preco === 400)).toBe(true);
    expect(primeiro.equipe.membros.every((m: { preco: number }) => m.preco === 1200)).toBe(true);
    contexto.sistema.definirEstrategia();
    expect((await criar(projetoExemplo())).equipe.membros.every((m: { preco: number }) => m.preco === 1200)).toBe(true);
  });
});
