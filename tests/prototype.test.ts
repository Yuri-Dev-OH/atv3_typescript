import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ErroDominio, Profissional, type EstadoProjeto, type Projeto, type TipoProjeto } from '../src/domain/model.js';
import { ProjetoAnimacao, ProjetoDocumentario, ProjetoFiccao, ProjetoPublicitario } from '../src/domain/projetos.js';
import { RegistroPrototipos, estadoInicial } from '../src/domain/prototipos.js';
import { CalculadorCompatibilidade, GeradorRelatorio } from '../src/domain/visitors.js';
import { criarApp } from '../src/http/app.js';
import { RepositorioMemoria } from '../src/infrastructure/memory-repository.js';
import { comServicos, profissionaisExemplo, projetoExemplo } from '../scripts/fixtures.js';

const classes: Record<TipoProjeto, new (estado: EstadoProjeto) => Projeto> = {
  ficcao: ProjetoFiccao, documentario: ProjetoDocumentario, animacao: ProjetoAnimacao, publicitario: ProjetoPublicitario,
};
const ajustes = () => ({ ...projetoExemplo(), titulo: 'Clone' });

describe('Prototype: clonar() em cada subclasse de Projeto', () => {
  it.each(Object.entries(classes))('%s devolve cópia profunda do próprio tipo', (tipo, Classe) => {
    const base = RegistroPrototipos.padrao().criar(tipo as TipoProjeto, ajustes());
    const original = base.comEstado(base.estado, [new Profissional({ ...profissionaisExemplo()[0]!, id: 'p1' })]);
    const clone = original.clonar();

    expect(clone).toBeInstanceOf(Classe);
    expect(clone.tipo).toBe(tipo);
    expect(clone).not.toBe(original);
    expect(clone.estado).toEqual(original.estado);
    expect(clone.restricoes).toEqual(original.restricoes);
    // Nenhum agregado pode ser compartilhado entre original e clone.
    expect(clone.estado).not.toBe(original.estado);
    expect(clone.estado.projeto.papeis).not.toBe(original.estado.projeto.papeis);
    expect(clone.estado.projeto.papeis[0]!.competencias).not.toBe(original.estado.projeto.papeis[0]!.competencias);
    expect(clone.restricoes).not.toBe(original.restricoes);
    expect(clone.restricoes.papeisObrigatorios).not.toBe(original.restricoes.papeisObrigatorios);
    expect(clone.profissionais[0]).not.toBe(original.profissionais[0]);
    expect(clone.profissionais[0]!.dados.competencias).not.toBe(original.profissionais[0]!.dados.competencias);

    const antes = structuredClone({ estado: original.estado, restricoes: original.restricoes });
    clone.estado.projeto.papeis[0]!.competencias[0]!.nivel = 0.1;
    clone.estado.projeto.papeis.pop();
    clone.restricoes.papeisObrigatorios.push('SONOPLASTA');
    clone.profissionais[0]!.dados.preco = 1;
    expect({ estado: original.estado, restricoes: original.restricoes }).toEqual(antes);
    expect(original.profissionais[0]!.dados.preco).not.toBe(1);
  });
  it('clona restrições específicas de cada tipo', () => {
    const animacao = new ProjetoAnimacao(estadoInicial(comServicos({ ...projetoExemplo(), id: 'a', tipoCaptacao: 'animacao' })));
    const clone = animacao.clonar();
    clone.restricoes.softwares3D.push('Houdini');
    expect(animacao.restricoes.softwares3D).toEqual(['Blender', 'Maya']);
    expect(clone.restricoes.minutosRenderPorMinuto).toBe(120);
    const publicitario = new ProjetoPublicitario(estadoInicial(comServicos({ ...projetoExemplo(), id: 'p', tipoCaptacao: 'publicitario' }))).clonar();
    expect(publicitario.restricoes).toMatchObject({ prazoMaximoDias: 30, duracaoMaxima: 3, aprovacaoCliente: true });
    expect(new ProjetoDocumentario(estadoInicial(comServicos({ ...projetoExemplo(), id: 'd' }))).clonar().restricoes.exigeDireitoImagem).toBe(true);
  });
  it('visitantes continuam operando sobre qualquer subclasse', () => {
    const registro = RegistroPrototipos.padrao();
    for (const tipo of registro.tipos()) {
      const projeto = registro.criar(tipo, ajustes());
      expect(projeto.aceitar(new GeradorRelatorio())).toContain('Projeto: Clone');
      expect(projeto.aceitar(new CalculadorCompatibilidade())).toBe(0);
    }
  });
});

describe('RegistroPrototipos', () => {
  it('registra os quatro tipos e nunca expõe o protótipo armazenado', () => {
    const registro = RegistroPrototipos.padrao();
    expect(registro.tipos().sort()).toEqual(['animacao', 'documentario', 'ficcao', 'publicitario']);
    const primeiro = registro.obter('animacao');
    primeiro.estado.projeto.papeis.length = 0;
    primeiro.restricoes.papeisObrigatorios.length = 0;
    const segundo = registro.obter('animacao');
    expect(segundo.estado.projeto.papeis.length).toBeGreaterThan(0);
    expect(segundo.restricoes.papeisObrigatorios.length).toBeGreaterThan(0);
  });
  it('armazena cópia ao registrar e rejeita tipo desconhecido', () => {
    const modelo = new ProjetoFiccao(estadoInicial(comServicos({ ...projetoExemplo(), id: '' })));
    const registro = new RegistroPrototipos().registrar(modelo);
    modelo.estado.projeto.genero = 'alterado depois';
    expect(registro.obter('ficcao').estado.projeto.genero).toBe('drama');
    expect(() => registro.obter('animacao')).toThrow(ErroDominio);
    expect(() => registro.obter('animacao')).toThrow('não suportado');
  });
  it('cria instâncias com identidade própria, ajustes finos e dados do modelo', () => {
    const registro = RegistroPrototipos.padrao();
    const { papeis: _papeis, estrategia: _estrategia, parametros: _parametros, ...entrada } = { ...projetoExemplo(), tipoCaptacao: 'publicitario' as const };
    const a = registro.criar('publicitario', entrada), b = registro.criar('publicitario', entrada);
    expect(a).toBeInstanceOf(ProjetoPublicitario);
    expect(a.estado.projeto.id).not.toBe(b.estado.projeto.id);
    expect(a.estado.equipe.id).not.toBe(b.estado.equipe.id);
    expect(a.estado).toMatchObject({ versao: 0, convites: [], excluidos: {}, equipe: { membros: [], status: 'parcial' } });
    expect(a.estado.projeto).toMatchObject({ titulo: 'Curta independente', estrategia: 'orcamento', tipoCaptacao: 'publicitario' });
    expect(a.estado.projeto.papeis.map(p => p.papel)).toEqual(['DIRETOR', 'DIRETOR_FOTOGRAFIA', 'EDITOR', 'SONOPLASTA']);
    expect(a.estado.recomendacao.estrategia).toBe('orcamento');
  });
  it('copia os ajustes e impede trocar o tipo pela entrada', () => {
    const entrada = { ...projetoExemplo(), tipoCaptacao: 'ficcao' as const };
    const projeto = RegistroPrototipos.padrao().criar('animacao', entrada);
    entrada.papeis[0]!.peso = 99;
    expect(projeto.estado.projeto.papeis[0]!.peso).toBe(2);
    expect(projeto.estado.projeto.tipoCaptacao).toBe('animacao');
    expect(projeto.ajustar({ titulo: undefined, duracao: 7 }).estado.projeto).toMatchObject({ titulo: 'Curta independente', duracao: 7 });
  });
  it('ajusta restrições específicas somente no clone', () => {
    const registro = RegistroPrototipos.padrao();
    const clone = registro.obter('publicitario') as ProjetoPublicitario;
    clone.ajustar({}, { prazoMaximoDias: 15 });
    expect(clone.restricoes.prazoMaximoDias).toBe(15);
    expect((registro.obter('publicitario') as ProjetoPublicitario).restricoes.prazoMaximoDias).toBe(30);
  });
  it('hidrata o estado persistido na subclasse correta, sem copiá-lo', () => {
    const registro = RegistroPrototipos.padrao();
    const persistido: EstadoProjeto = JSON.parse(JSON.stringify(registro.criar('documentario', ajustes()).estado));
    const profissional = new Profissional({ ...profissionaisExemplo()[0]!, id: 'p1' });
    const projeto = registro.hidratar(persistido, [profissional]);
    expect(projeto).toBeInstanceOf(ProjetoDocumentario);
    expect(projeto.estado).toBe(persistido);
    expect(projeto.profissionais).toEqual([profissional]);
    expect(projeto.restricoes).toEqual((registro.obter('documentario')).restricoes);
  });
});

describe('Prototype pela API', () => {
  let contexto: ReturnType<typeof criarApp>;
  beforeEach(async () => {
    contexto = criarApp(new RepositorioMemoria(), { processarEventos: false });
    for (const p of profissionaisExemplo()) await contexto.sistema.cadastrarProfissional(p);
  });
  afterEach(async () => { await contexto.app.close(); });
  it('cria projeto publicitário só com os dados obrigatórios e relata o tipo', async () => {
    const { papeis: _p, estrategia: _e, parametros: _r, ...dados } = projetoExemplo();
    const r = await contexto.app.inject({ method: 'POST', url: '/projetos', payload: { ...dados, duracao: 1, tipoCaptacao: 'publicitario' } });
    expect(r.statusCode, r.body).toBe(201);
    const estado: EstadoProjeto = r.json();
    expect(estado.projeto.estrategia).toBe('orcamento');
    expect(estado.equipe.membros.map(m => m.papel).sort()).toEqual(['DIRETOR', 'DIRETOR_FOTOGRAFIA', 'EDITOR', 'SONOPLASTA']);
    const relatorio = (await contexto.app.inject(`/projetos/${estado.projeto.id}/relatorio`)).json();
    expect(relatorio.tipo).toBe('publicitario');
    expect(relatorio.restricoes.prazoMaximoDias).toBe(30);
  });
  it('preserva papéis enviados e rejeita tipo inexistente', async () => {
    const r = await contexto.app.inject({ method: 'POST', url: '/projetos', payload: { ...projetoExemplo(), tipoCaptacao: 'animacao' } });
    expect(r.statusCode).toBe(201);
    expect(r.json().projeto.papeis).toHaveLength(6);
    const invalido = await contexto.app.inject({ method: 'POST', url: '/projetos', payload: { ...projetoExemplo(), tipoCaptacao: 'realidade-virtual' } });
    expect(invalido.statusCode).toBe(400);
  });
});
