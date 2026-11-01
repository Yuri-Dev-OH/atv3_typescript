import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SistemaRecomendacao } from '../src/application/service.js';
import { FabricaAnimacao, FabricaDocumentario, FabricaFiccao, FabricaPublicitario, type FabricaProjeto } from '../src/domain/fabricas.js';
import { id, type AjustesProjeto, type ProfissionalDados, type ProjetoDados, type TipoProjeto } from '../src/domain/model.js';
import { ProjetoAnimacao, ProjetoDocumentario, ProjetoFiccao, ProjetoPublicitario } from '../src/domain/projetos.js';
import { RegistroPrototipos } from '../src/domain/prototipos.js';
import { ValidadorAnimacao, ValidadorDocumentario, ValidadorFiccao, ValidadorPublicitario, type ValidadorProjeto } from '../src/domain/validadores.js';
import { GeradorRelatorio, GeradorRelatorioAnimacao } from '../src/domain/visitors.js';
import { NotificadorAnimacao, NotificadorDocumentario, NotificadorFiccao, NotificadorPublicitario } from '../src/events/notificadores-projeto.js';
import { criarApp } from '../src/http/app.js';
import { RepositorioMemoria } from '../src/infrastructure/memory-repository.js';
import { OrquestradorPadrao } from '../src/recommendation/orchestrator.js';
import { estrategias, RecomendadorPriorizado } from '../src/recommendation/strategies.js';
import { servicosDePapeis } from '../src/domain/servicos.js';
import { comServicos, profissionaisExemplo, projetoExemplo } from '../scripts/fixtures.js';

const TIPOS: TipoProjeto[] = ['ficcao', 'documentario', 'animacao', 'publicitario'];
const fabrica = (tipo: TipoProjeto) => RegistroPrototipos.padrao().obter(tipo).criarFabrica();
const projeto = (ajustes: Partial<ProjetoDados> = {}): ProjetoDados => comServicos({ ...projetoExemplo(), id: id(), ...ajustes });
const profissionais = (): ProfissionalDados[] => profissionaisExemplo().map(p => ({ ...p, id: id() }));
// Especialista em efeitos visuais com domínio de modelagem 3D, mas menor aderência à competência pedida no papel.
const modelador = (base: ProfissionalDados): ProfissionalDados => ({ ...base, id: 'modelador-3d', nome: 'Modelador 3D',
  competencias: [{ nome: 'efeitos_visuais', nivel: 0.9 }, { nome: 'modelagem 3d', nivel: 1 }],
  avaliacoes: base.avaliacoes.map(a => ({ ...a, nota: 5 })) });

describe('Abstract Factory: famílias coerentes por tipo', () => {
  it.each([
    ['ficcao', FabricaFiccao, ProjetoFiccao, ValidadorFiccao, NotificadorFiccao],
    ['documentario', FabricaDocumentario, ProjetoDocumentario, ValidadorDocumentario, NotificadorDocumentario],
    ['animacao', FabricaAnimacao, ProjetoAnimacao, ValidadorAnimacao, NotificadorAnimacao],
    ['publicitario', FabricaPublicitario, ProjetoPublicitario, ValidadorPublicitario, NotificadorPublicitario],
  ] as const)('%s: o protótipo cria sua fábrica e ela produz objetos do mesmo tipo', (tipo, Fabrica, Projeto, Validador, Notificador) => {
    const f = fabrica(tipo);
    expect(f).toBeInstanceOf(Fabrica);
    expect(f.tipo).toBe(tipo);
    const criado = f.criarProjeto({ ...projetoExemplo(), duracao: 1 });
    expect(criado).toBeInstanceOf(Projeto);
    expect(criado.estado.projeto.tipoCaptacao).toBe(tipo);
    expect(f.criarValidador()).toBeInstanceOf(Validador);
    expect(f.criarNotificador()).toBeInstanceOf(Notificador);
    expect(f.criarRelatorio()).toBeInstanceOf(tipo === 'animacao' ? GeradorRelatorioAnimacao : GeradorRelatorio);
    // O Factory Method do projeto criado devolve a fábrica da mesma família.
    expect(criado.criarFabrica()).toBeInstanceOf(Fabrica);
  });
  it('ficção usa a estratégia pura; os demais tipos priorizam suas competências', () => {
    expect(fabrica('ficcao').criarRecomendador('colaborativa')).toBe(estrategias.colaborativa);
    for (const tipo of TIPOS.slice(1)) expect(fabrica(tipo).criarRecomendador('cosseno')).toBeInstanceOf(RecomendadorPriorizado);
  });
  it('produtos recebem cópias das restrições do protótipo', () => {
    const prototipo = RegistroPrototipos.padrao().obter('publicitario') as ProjetoPublicitario;
    const f = prototipo.criarFabrica();
    prototipo.ajustar({}, { prazoMaximoDias: 60 });
    expect(f.criarValidador().validar(projeto({ duracao: 1, inicio: '2027-01-01', prazo: '2027-02-15' }))).toEqual([]);
    expect(fabrica('publicitario').criarValidador().validar(projeto({ duracao: 1, inicio: '2027-01-01', prazo: '2027-02-15' })))
      .toEqual(['Publicidade: a entrega deve ocorrer em até 30 dias.']);
  });
});

describe('OrquestradorEquipe com fábricas diferentes', () => {
  it('a mesma classe de orquestrador aplica as validações de cada tipo', () => {
    const lista = profissionais();
    const orquestrar = (tipo: TipoProjeto, p: ProjetoDados) => () => new OrquestradorPadrao(fabrica(tipo)).orquestrar(p, lista);
    for (const tipo of ['ficcao', 'documentario', 'animacao'] as const) expect(orquestrar(tipo, projeto())).not.toThrow();
    expect(orquestrar('publicitario', projeto())).toThrow('Publicidade: a duração máxima é de 3 min.');
    expect(orquestrar('publicitario', projeto({ duracao: 1 }))).not.toThrow();

    const soDiretor = projeto({ papeis: projetoExemplo().papeis.slice(0, 1) });
    expect(orquestrar('ficcao', soDiretor)).not.toThrow();
    expect(orquestrar('animacao', soDiretor)).toThrow('Animação: papéis obrigatórios ausentes (EFEITOS_VISUAIS, EDITOR).');
    expect(orquestrar('documentario', soDiretor)).toThrow('DIRETOR_FOTOGRAFIA');

    expect(orquestrar('documentario', projeto({ prazo: '2027-02-08' }))).toThrow('ao menos 14 dias');
    expect(orquestrar('animacao', projeto({ duracao: 1000 }))).toThrow('render estimado (2000 h)');
    expect(orquestrar('publicitario', projeto({ duracao: 1, prazo: '2027-03-31' }))).toThrow('até 30 dias');
  });
  it('a recomendação muda conforme a fábrica: animação prioriza modelagem 3D', () => {
    const lista = profissionais();
    const efeitos = lista.find(p => p.papeis.includes('EFEITOS_VISUAIS') && p.preco === 1200)!;
    lista.push(modelador(efeitos));
    const primeiro = (tipo: TipoProjeto) => {
      const { ranking, membros } = new OrquestradorPadrao(fabrica(tipo)).orquestrar(projeto(), lista);
      return { ranking: ranking.get('EFEITOS_VISUAIS')![0]!.nome, equipe: membros.find(m => m.papel === 'EFEITOS_VISUAIS')!.nome };
    };
    expect(primeiro('ficcao')).toEqual({ ranking: efeitos.nome, equipe: efeitos.nome });
    expect(primeiro('animacao')).toEqual({ ranking: 'Modelador 3D', equipe: 'Modelador 3D' });
  });
  it('aceita um tipo novo sem nenhuma alteração no orquestrador', () => {
    // Simula um tipo (realidade virtual) que ainda não existe no domínio.
    const validador: ValidadorProjeto = { validar: p => p.papeis.some(x => x.papel === 'EFEITOS_VISUAIS') ? [] : ['RV: exige efeitos visuais.'] };
    const realidadeVirtual: FabricaProjeto = {
      tipo: 'realidade-virtual' as TipoProjeto,
      criarProjeto: (dados: AjustesProjeto) => RegistroPrototipos.padrao().criar('ficcao', dados),
      criarValidador: () => validador,
      criarRecomendador: e => new RecomendadorPriorizado(typeof e === 'string' ? estrategias[e] : e, [{ nome: 'unity', nivel: 1 }], 0.9),
      criarServicoPrincipal: p => servicosDePapeis(p),
      criarNotificador: () => ({ compor: (tipo, p) => ({ assunto: 'RV', mensagem: `${tipo}: experiência imersiva ${p.titulo}` }) }),
      criarRelatorio: () => new GeradorRelatorio(),
    };
    const lista = profissionais();
    const efeitos = lista.find(p => p.papeis.includes('EFEITOS_VISUAIS') && p.preco === 400)!;
    efeitos.competencias.push({ nome: 'unity', nivel: 1 });
    const o = new OrquestradorPadrao(realidadeVirtual);
    expect(o.orquestrar(projeto(), lista).ranking.get('EFEITOS_VISUAIS')![0]!.profissionalId).toBe(efeitos.id);
    expect(() => o.orquestrar(projeto({ papeis: projetoExemplo().papeis.slice(0, 1) }), lista)).toThrow('RV: exige efeitos visuais.');
  });
  it('orquestrador e serviço não têm condicionais por tipo de projeto', () => {
    for (const arquivo of ['src/recommendation/orchestrator.ts', 'src/application/service.ts']) {
      const fonte = readFileSync(new URL(`../${arquivo}`, import.meta.url), 'utf8');
      expect(fonte).not.toMatch(/'(ficcao|documentario|animacao|publicitario)'/);
      expect(fonte).not.toMatch(/switch\s*\(|instanceof Projeto/);
    }
  });
});

describe('SistemaRecomendacao seleciona a fábrica pelo tipo', () => {
  it('cria o orquestrador com a fábrica do tipo de cada solicitação', async () => {
    const usadas: TipoProjeto[] = [];
    const sistema = new SistemaRecomendacao(new RepositorioMemoria(), { async processar() {} },
      { criarOrquestrador: (f, configuracao) => { usadas.push(f.tipo); return new OrquestradorPadrao(f, configuracao); } });
    for (const p of profissionaisExemplo()) await sistema.cadastrarProfissional(p);
    for (const tipo of TIPOS) await sistema.criar({ ...projetoExemplo(), duracao: 1, tipoCaptacao: tipo });
    expect(usadas).toEqual(TIPOS);
    expect(() => sistema.fabricaPara('vr' as TipoProjeto)).toThrow('não suportado');
  });

  describe('pela API', () => {
    let repo: RepositorioMemoria;
    let contexto: ReturnType<typeof criarApp>;
    const emails: { assunto: string; texto: string }[] = [];
    beforeEach(async () => {
      emails.length = 0;
      repo = new RepositorioMemoria();
      contexto = criarApp(repo, { processarEventos: false, email: { async enviar(_destino, assunto, texto) { emails.push({ assunto, texto }); } } });
      for (const p of profissionaisExemplo()) await contexto.sistema.cadastrarProfissional(p);
    });
    afterEach(async () => { await contexto.app.close(); });
    async function criar(tipo: TipoProjeto, ajustes: Partial<ProjetoDados> = {}) {
      return contexto.app.inject({ method: 'POST', url: '/projetos', payload: { ...projetoExemplo(), tipoCaptacao: tipo, ...ajustes } });
    }
    it.each([
      ['ficcao', 20, 'Cinebridge', /^RECOMENDACAO_GERADA: projeto [0-9a-f-]{36}$/],
      ['documentario', 20, 'Cinebridge | Documentário: Curta independente', /documentário "Curta independente".*termo de direito de imagem/],
      ['animacao', 20, 'Cinebridge | Animação: Curta independente', /Pipeline Blender\/Maya; render estimado de 40 h/],
      ['publicitario', 1, 'Cinebridge | Publicidade: Curta independente', /peça publicitária.*aprovação do cliente/],
    ] as const)('%s: notificações no formato do tipo', async (tipo, duracao, assunto, mensagem) => {
      const r = await criar(tipo, { duracao });
      expect(r.statusCode, r.body).toBe(201);
      await contexto.eventos.processar();
      const doProdutor = (await repo.notificacoes('produtor-demo')).filter(n => n.canal === 'interno');
      expect(doProdutor.map(n => n.mensagem)).toEqual([expect.stringMatching(mensagem)]);
      expect(emails.length).toBeGreaterThan(0);
      expect(emails.every(e => e.assunto === assunto && mensagem.test(e.texto))).toBe(true);
    });
    it('rejeita pela regra do tipo e relata pendências do validador da fábrica', async () => {
      const recusado = await criar('publicitario');
      expect(recusado.statusCode).toBe(422);
      expect(recusado.json().erro).toContain('Publicidade: a duração máxima');
      expect(repo.projetos.size).toBe(0);
      const criado = (await criar('animacao')).json();
      const relatorio = (await contexto.app.inject(`/projetos/${criado.projeto.id}/relatorio`)).json();
      expect(relatorio.tipo).toBe('animacao');
      expect(relatorio.pendencias).toEqual(['Há membros sem confirmação de ambas as partes.']);
    });
    it('relatório de animação traz métricas de eficiência de renderização', async () => {
      const animacao = (await criar('animacao')).json();
      const ficcao = (await criar('ficcao')).json();
      const texto = async (pid: string) => (await contexto.app.inject(`/projetos/${pid}/relatorio`)).json().texto as string;
      const relatorio = await texto(animacao.projeto.id);
      expect(relatorio).toContain('Projeto: Curta independente');
      expect(relatorio).toContain('Render estimado: 40 h (120 min de máquina por minuto de obra; Blender/Maya)');
      expect(relatorio).toContain('Ocupação da janela de render: 6.0% de 672 h');
      expect(relatorio).toMatch(/Custo por minuto de obra: R\$ \d+\.\d{2}/);
      expect(await texto(ficcao.projeto.id)).not.toContain('Render');
    });
  });
});
