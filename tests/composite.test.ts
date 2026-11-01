import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { estadoInicial, id, type EstadoProjeto, type NovoProjeto, type ProjetoDados } from '../src/domain/model.js';
import { ProjetoDocumentario } from '../src/domain/projetos.js';
import { RegistroPrototipos } from '../src/domain/prototipos.js';
import { LIMITES_SERVICOS, PacoteServico, servicoDeDados, ServicoAtomico, servicosDePapeis, type ServicoDados, type ServicoProjeto } from '../src/domain/servicos.js';
import { criarApp } from '../src/http/app.js';
import { RepositorioMemoria } from '../src/infrastructure/memory-repository.js';
import { comServicos, profissionaisExemplo, projetoExemplo } from '../scripts/fixtures.js';

const atomico = (nome: string, papel: ServicoAtomico['papel'], custo: number, prazo: number) => new ServicoAtomico(nome, papel, custo, prazo);
/** Pacote de pós-produção com subpacotes, como no enunciado. */
function posProducao(): PacoteServico {
  return new PacoteServico('Pós-produção', [
    atomico('Edição de vídeo', 'EDITOR', 1500, 10),
    new PacoteServico('Finalização de imagem', [atomico('Coloração', 'EDITOR', 800, 4), atomico('Efeitos visuais', 'EFEITOS_VISUAIS', 2500.5, 7)], true),
    new PacoteServico('Áudio', [atomico('Mixagem de áudio', 'SONOPLASTA', 600, 3), atomico('Trilha sonora', 'SONOPLASTA', 900.25, 5)]),
  ]);
}
/** Cadeia linear de pacotes com um serviço atômico no fundo. */
function encadeado(profundidade: number): ServicoDados {
  let atual: ServicoDados = { tipo: 'atomico', nome: 'Direção', papel: 'DIRETOR', custo: 100, prazo: 2 };
  for (let i = 1; i < profundidade; i++) atual = { tipo: 'pacote', nome: `Nível ${i}`, itens: [atual] };
  return atual;
}

describe('Composite: custo e prazo recursivos', () => {
  it('trata serviço atômico e pacote pela mesma interface', () => {
    const servicos: ServicoProjeto[] = [atomico('Roteiro', 'ROTEIRISTA', 1200, 6), posProducao()];
    expect(servicos.map(s => [s.calcularCusto(), s.obterPrazo(), s.listarSubservicos().length])).toEqual([[1200, 6, 0], [6300.75, 25, 3]]);
  });
  it.each([
    [1, 100, 2], [2, 100, 2], [4, 100, 2], [LIMITES_SERVICOS.profundidade, 100, 2],
  ])('calcula estruturas com %i nível(is)', (profundidade, custo, prazo) => {
    const servico = servicoDeDados(encadeado(profundidade));
    expect([servico.calcularCusto(), servico.obterPrazo(), servico.validar()]).toEqual([custo, prazo, []]);
  });
  it('soma prazos em sequência e usa o maior prazo em paralelo, em vários níveis', () => {
    // Pós-produção: 10 (edição) + max(4, 7) (finalização) + 3 + 5 (áudio em sequência).
    expect(posProducao().obterPrazo()).toBe(25);
    const projeto = new PacoteServico('Projeto', [
      new PacoteServico('Pré-produção', [atomico('Roteiro', 'ROTEIRISTA', 1000, 8), atomico('Storyboard', 'DIRETOR', 400, 5)], true),
      new PacoteServico('Filmagem', [atomico('Direção', 'DIRETOR', 3000, 12), atomico('Fotografia', 'DIRETOR_FOTOGRAFIA', 2500, 12)], true),
      posProducao(),
    ]);
    expect(projeto.obterPrazo()).toBe(8 + 12 + 25);
    expect(projeto.calcularCusto()).toBe(1000 + 400 + 3000 + 2500 + 6300.75);
    // Somar em centavos evita o erro clássico de ponto flutuante (0,1 + 0,2).
    expect(new PacoteServico('Centavos', [atomico('a', 'EDITOR', 0.1, 1), atomico('b', 'EDITOR', 0.2, 1)]).calcularCusto()).toBe(0.3);
    expect(new PacoteServico('Vazio').obterPrazo()).toBe(0);
  });
  it('consolida papéis repetidos e avalia a cobertura de todos os componentes', () => {
    const papeis = posProducao().papeisExigidos();
    expect(papeis.map(p => p.papel)).toEqual(['EDITOR', 'EFEITOS_VISUAIS', 'SONOPLASTA']);
    const comPeso = new PacoteServico('P', [new ServicoAtomico('a', 'EDITOR', 1, 1, 1, [{ nome: 'corte', nivel: 0.4 }]),
      new ServicoAtomico('b', 'EDITOR', 1, 1, 3, [{ nome: 'Corte', nivel: 0.9 }, { nome: 'cor', nivel: 0.5 }])]);
    expect(comPeso.papeisExigidos()).toEqual([{ papel: 'EDITOR', peso: 3, competencias: [{ nome: 'corte', nivel: 0.9 }, { nome: 'cor', nivel: 0.5 }] }]);
    expect(posProducao().avaliarCobertura(new Set(['EDITOR', 'EFEITOS_VISUAIS']))).toBe(false);
    expect(posProducao().avaliarCobertura(new Set(['EDITOR', 'EFEITOS_VISUAIS', 'SONOPLASTA']))).toBe(true);
  });
  it('preserva a estrutura ao serializar e reconstruir, e permite editar o pacote', () => {
    const original = posProducao();
    const copia = servicoDeDados(original.paraDados());
    expect(copia.paraDados()).toEqual(original.paraDados());
    const extra = atomico('Legendagem', 'EDITOR', 300, 2);
    original.adicionar(extra);
    expect(original.calcularCusto()).toBe(6600.75);
    expect(original.remover(extra)).toBe(true);
    expect(original.remover(extra)).toBe(false);
    expect(copia.calcularCusto()).toBe(original.calcularCusto());
  });
});

describe('Composite: validação recursiva', () => {
  it('aponta papéis inválidos, prazos e custos inconsistentes em qualquer nível', () => {
    const invalido = servicoDeDados({ tipo: 'pacote', nome: 'Raiz', itens: [
      { tipo: 'pacote', nome: 'Interno', itens: [{ tipo: 'atomico', nome: 'Drone', papel: 'PILOTO' as never, custo: 10, prazo: 1 }] },
      { tipo: 'atomico', nome: 'Edição', papel: 'EDITOR', custo: -1, prazo: 0, peso: 0, competencias: [{ nome: 'x', nivel: 2 }, { nome: 'X', nivel: 1 }] },
      { tipo: 'pacote', nome: 'Vazio', itens: [] },
      { tipo: 'atomico', nome: ' ', papel: 'EDITOR', custo: 1, prazo: 1, competencias: [] },
    ] });
    expect(invalido.validar()).toEqual([
      'Serviço "Drone": papel inválido (PILOTO).',
      'Serviço "Edição": o custo deve ser um valor não negativo.', 'Serviço "Edição": o prazo deve ser maior que zero.',
      'Serviço "Edição": o peso deve ser maior que zero.', 'Serviço "Edição": o nível das competências vai de 0 a 1.', 'Serviço "Edição": competências duplicadas.',
      'Pacote "Vazio": informe ao menos um serviço.',
      'Há serviço sem nome.', 'Serviço " ": informe ao menos uma competência.',
    ]);
  });
  it('limita profundidade, quantidade de nós e impede ciclos', () => {
    expect(() => servicoDeDados(encadeado(LIMITES_SERVICOS.profundidade + 1))).toThrow('excede 6 níveis');
    const largo: ServicoDados = { tipo: 'pacote', nome: 'Largo', itens: Array.from({ length: LIMITES_SERVICOS.nos }, (_, i) => ({ tipo: 'atomico' as const, nome: `s${i}`, papel: 'EDITOR' as const, custo: 1, prazo: 1 })) };
    expect(() => servicoDeDados(largo)).toThrow('excede 200 serviços');
    const pacote = new PacoteServico('A'), filho = new PacoteServico('B', [pacote]);
    expect(() => pacote.adicionar(filho)).toThrow('não pode conter a si mesmo');
    expect(() => pacote.adicionar(pacote)).toThrow('não pode conter a si mesmo');
  });
  it('o validador da fábrica rejeita serviços que não cabem na janela do projeto', () => {
    const fabrica = RegistroPrototipos.padrao().obter('ficcao').criarFabrica();
    const p: ProjetoDados = { ...comServicos({ ...projetoExemplo(), id: id() }), servicoPrincipal: posProducao().paraDados(), prazo: '2027-02-10' };
    // Janela de 1 a 10 de fevereiro: 10 dias, contra 25 exigidos.
    expect(fabrica.criarValidador().validar(p)).toContain('Os serviços exigem 25 dias, mas a janela do projeto tem 10 dias.');
    expect(fabrica.criarValidador().validar({ ...p, prazo: '2027-03-01' })).toEqual([]);
    expect(fabrica.criarValidador().validar({ ...p, servicoPrincipal: undefined as never })).toContain('O projeto não possui serviço principal.');
  });
});

describe('Composite: Projeto delega ao serviço principal', () => {
  it('calcularCustoTotal, prazo e validação passam pela hierarquia', () => {
    const estado = estadoInicial(comServicos({ ...projetoExemplo(), id: id(), tipoCaptacao: 'documentario' }));
    const projeto = new ProjetoDocumentario(estado).definirServicoPrincipal(posProducao());
    expect(projeto.calcularCustoTotal()).toBe(6300.75);
    expect(projeto.obterPrazoTotal()).toBe(25);
    expect(projeto.validarEstrutura()).toEqual([]);
    // A lista de papéis passa a ser derivada da árvore.
    expect(projeto.estado.projeto.papeis.map(p => p.papel)).toEqual(['EDITOR', 'EFEITOS_VISUAIS', 'SONOPLASTA']);
    expect(projeto.servicoPrincipal.listarSubservicos().map(s => s.nome)).toEqual(['Edição de vídeo', 'Finalização de imagem', 'Áudio']);
    // O clone (Prototype) copia a árvore em profundidade.
    const clone = projeto.clonar();
    clone.definirServicoPrincipal(atomico('Só roteiro', 'ROTEIRISTA', 10, 1));
    expect(projeto.calcularCustoTotal()).toBe(6300.75);
  });
  it('cada tipo tem um pacote padrão em etapas, e a lista legada vira um pacote paralelo', () => {
    const registro = RegistroPrototipos.padrao();
    const entrada = { ...projetoExemplo(), papeis: undefined, orcamento: 10000, inicio: '2027-01-01', prazo: '2027-01-30' };
    const etapas = (tipo: ProjetoDados['tipoCaptacao']) => registro.obter(tipo).criarFabrica().criarProjeto({ ...entrada, duracao: 1 }).servicoPrincipal.listarSubservicos().map(s => s.nome);
    expect(etapas('documentario')).toEqual(['Pesquisa e roteiro', 'Captação em campo', 'Pós-produção']);
    expect(etapas('animacao')).toEqual(['Roteiro e direção de arte', 'Modelagem, animação e render', 'Finalização']);
    expect(etapas('publicitario')).toEqual(['Filmagem', 'Finalização']);
    const documentario = registro.obter('documentario').criarFabrica().criarProjeto(entrada);
    expect(documentario.obterPrazoTotal()).toBeLessThanOrEqual(30);
    expect(documentario.calcularCustoTotal()).toBeLessThanOrEqual(10000);
    expect(documentario.validarEstrutura()).toEqual([]);
    const legado = servicosDePapeis({ ...projetoExemplo(), inicio: '2027-02-01', prazo: '2027-03-01' });
    expect([legado.paralelo, legado.obterPrazo(), legado.calcularCusto(), legado.listarSubservicos().length]).toEqual([true, 29, 8000, 6]);
    expect(legado.papeisExigidos()).toEqual(projetoExemplo().papeis);
  });
});

describe('Composite pela API', () => {
  let contexto: ReturnType<typeof criarApp>;
  beforeEach(async () => {
    contexto = criarApp(new RepositorioMemoria(), { processarEventos: false });
    for (const p of profissionaisExemplo()) await contexto.sistema.cadastrarProfissional(p);
  });
  afterEach(async () => { await contexto.app.close(); });
  const novo = (extra: Partial<NovoProjeto> = {}): NovoProjeto => {
    const { papeis: _papeis, ...base } = projetoExemplo();
    return { ...base, ...extra };
  };
  async function criar(corpo: unknown): Promise<EstadoProjeto> {
    const r = await contexto.app.inject({ method: 'POST', url: '/projetos', payload: corpo as object });
    expect(r.statusCode, r.body).toBe(201);
    return r.json();
  }
  it('cria o projeto a partir de uma hierarquia de serviços e recomenda a equipe pelos papéis da árvore', async () => {
    // Direção acompanha a pós-produção em paralelo: prazo = max(20, 25).
    const servicoPrincipal = new PacoteServico('Curta', [atomico('Direção', 'DIRETOR', 2000, 20), posProducao()], true).paraDados();
    const estado = await criar(novo({ servicoPrincipal, orcamento: 9000 }));
    expect(estado.projeto.papeis.map(p => p.papel)).toEqual(['DIRETOR', 'EDITOR', 'EFEITOS_VISUAIS', 'SONOPLASTA']);
    expect(estado.equipe.membros.map(m => m.papel).sort()).toEqual(['DIRETOR', 'EDITOR', 'EFEITOS_VISUAIS', 'SONOPLASTA']);
    const servicos = (await contexto.app.inject(`/projetos/${estado.projeto.id}/servicos`)).json();
    expect(servicos).toMatchObject({ nome: 'Curta', custo: 8300.75, prazo: 25, coberto: true });
    expect(servicos.subservicos[1].subservicos[1]).toMatchObject({ nome: 'Finalização de imagem', prazo: 7, subservicos: [{ papel: 'EDITOR' }, { papel: 'EFEITOS_VISUAIS' }] });
    const relatorio = (await contexto.app.inject(`/projetos/${estado.projeto.id}/relatorio`)).json();
    expect(relatorio.servicos).toMatchObject({ custoTotal: 8300.75, prazoTotal: 25 });
    expect(relatorio.texto).toContain('Serviços: R$ 8300.75 em 25 dias');
  });
  it('recusa árvores inválidas, ambíguas ou maiores que a janela', async () => {
    const enviar = (corpo: object) => contexto.app.inject({ method: 'POST', url: '/projetos', payload: corpo });
    const grande = new PacoteServico('Longo', [atomico('Direção', 'DIRETOR', 1, 400)]).paraDados();
    const curto = await enviar(novo({ servicoPrincipal: grande }));
    expect([curto.statusCode, curto.json().erro]).toEqual([422, 'Os serviços exigem 400 dias, mas a janela do projeto tem 29 dias.']);
    expect((await enviar({ ...projetoExemplo(), servicoPrincipal: grande })).json().erro).toBe('Informe servicoPrincipal ou papeis, não ambos.');
    expect((await enviar(novo({ servicoPrincipal: { tipo: 'pacote', nome: 'x', itens: [] } }))).statusCode).toBe(400);
    expect((await enviar(novo({ servicoPrincipal: { tipo: 'atomico', nome: 'x', papel: 'PILOTO', custo: 1, prazo: 1 } as never }))).statusCode).toBe(400);
    expect((await enviar(novo({ servicoPrincipal: encadeado(LIMITES_SERVICOS.profundidade + 1) }))).json().erro).toBe('A árvore de serviços excede 6 níveis.');
    const semPapelObrigatorio = await enviar(novo({ tipoCaptacao: 'documentario', servicoPrincipal: atomico('Edição', 'EDITOR', 100, 20).paraDados() }));
    expect(semPapelObrigatorio.json().erro).toContain('papéis obrigatórios ausentes');
  });
  it('alerta quando o custo estimado supera o orçamento', async () => {
    const estado = await criar(novo({ servicoPrincipal: atomico('Direção', 'DIRETOR', 9000, 10).paraDados() }));
    expect(estado.recomendacao.avisos).toContain('O custo estimado dos serviços (R$ 9000.00) excede o orçamento.');
    expect((await contexto.app.inject(`/projetos/${estado.projeto.id}/relatorio`)).json().pendencias).toContain('O custo estimado dos serviços (R$ 9000.00) excede o orçamento.');
  });
  it('na reavaliação, recalcula pacotes automáticos e preserva pacotes personalizados', async () => {
    const reavaliar = (pid: string, corpo: object) => contexto.app.inject({ method: 'POST', url: `/projetos/${pid}/reavaliar`, payload: corpo });
    const legado = await criar(projetoExemplo());
    const encurtado = (await reavaliar(legado.projeto.id, { prazo: '2027-02-15' })).json();
    expect(servicoDeDados(encurtado.projeto.servicoPrincipal).obterPrazo()).toBe(15);
    const padrao = await criar(novo({ tipoCaptacao: 'documentario' }));
    const maisVerba = (await reavaliar(padrao.projeto.id, { orcamento: 16000 })).json();
    expect(servicoDeDados(maisVerba.projeto.servicoPrincipal).calcularCusto()).toBeGreaterThan(servicoDeDados(padrao.projeto.servicoPrincipal).calcularCusto());
    expect(maisVerba.projeto.servicoPrincipal.itens.map((i: { nome: string }) => i.nome)).toEqual(['Pesquisa e roteiro', 'Captação em campo', 'Pós-produção']);
    const personalizado = await criar(novo({ servicoPrincipal: atomico('Direção', 'DIRETOR', 500, 20).paraDados() }));
    const recusado = await reavaliar(personalizado.projeto.id, { prazo: '2027-02-10' });
    expect([recusado.statusCode, recusado.json().erro]).toEqual([422, 'Os serviços exigem 20 dias, mas a janela do projeto tem 10 dias.']);
    const novaArvore = new PacoteServico('Nova', [atomico('Direção', 'DIRETOR', 500, 20), posProducao()], true).paraDados();
    const trocado = (await reavaliar(personalizado.projeto.id, { servicoPrincipal: novaArvore, orcamento: 9000 })).json();
    expect(trocado.projeto.papeis.map((p: { papel: string }) => p.papel)).toEqual(['DIRETOR', 'EDITOR', 'EFEITOS_VISUAIS', 'SONOPLASTA']);
    const pelaLista = (await reavaliar(personalizado.projeto.id, { papeis: projetoExemplo().papeis.slice(0, 2) })).json();
    expect(pelaLista.projeto.servicoPrincipal).toMatchObject({ tipo: 'pacote', paralelo: true, itens: [{ papel: 'DIRETOR' }, { papel: 'DIRETOR_FOTOGRAFIA' }] });
    expect((await reavaliar(personalizado.projeto.id, { papeis: projetoExemplo().papeis, servicoPrincipal: posProducao().paraDados() })).statusCode).toBe(422);
  });
  it('simula a recomendação sem gravar o projeto', async () => {
    const r = await contexto.app.inject({ method: 'POST', url: '/recomendacoes/simulacoes', payload: novo({ tipoCaptacao: 'publicitario', duracao: 1, prazo: '2027-02-20' }) });
    expect(r.statusCode, r.body).toBe(200);
    const { equipe, servicos } = r.json();
    expect(equipe.membros.map((m: { papel: string }) => m.papel)).toEqual(['DIRETOR', 'DIRETOR_FOTOGRAFIA', 'EDITOR', 'SONOPLASTA']);
    expect(servicos).toMatchObject({ nome: 'Pacote padrão de publicitario', coberto: true });
    expect((await contexto.app.inject('/eventos')).json().filter((e: { tipo: string }) => e.tipo === 'RECOMENDACAO_GERADA')).toEqual([]);
  });
  it('completa estados gravados antes da atividade 3', async () => {
    const repo = new RepositorioMemoria();
    const antigo = criarApp(repo, { processarEventos: false });
    const estado = estadoInicial(comServicos({ ...projetoExemplo(), id: id() }));
    const { servicoPrincipal: _s, ...semServicos } = estado.projeto;
    const { pagamentos: _p, ...semPagamentos } = estado;
    repo.projetos.set(estado.projeto.id, { ...semPagamentos, projeto: semServicos } as EstadoProjeto);
    const lido = await antigo.sistema.obter(estado.projeto.id);
    expect(lido.pagamentos).toEqual([]);
    expect(servicoDeDados(lido.projeto.servicoPrincipal).papeisExigidos()).toEqual(projetoExemplo().papeis);
    await antigo.app.close();
  });
});
