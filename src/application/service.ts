import { isDeepStrictEqual } from 'node:util';
import { agora, centavos, exigir, id, Profissional, validarProfissional, validarProjeto, type Convite, type Destinatario, type Equipe, type EstadoProjeto, type EventoRecomendacao, type MembroEquipe, type NovoProjeto, type Pagamento, type Papel, type ProfissionalDados, type Projeto, type ProjetoDados, type TipoProjeto } from '../domain/model.js';
import type { FabricaProjeto } from '../domain/fabricas.js';
import { RegistroPrototipos } from '../domain/prototipos.js';
import type { AdaptadorArmazenamento, AdaptadoresExternos, AdaptadorPagamento, AdaptadorProfissional, CriteriosProfissional, MetadadosArquivo, NovaAvaliacao, ProcessadorEventos, Repositorio, RepositorioProfissionais } from '../domain/ports.js';
import { resumirServico, servicoDeDados, servicosDePapeis, type ResumoServico } from '../domain/servicos.js';
import { CalculadorCompatibilidade, ValidadorConsistencia } from '../domain/visitors.js';
import { MontadorPilhaRecomendacao } from '../recommendation/decorators.js';
import { OrquestradorPadrao, type ConfiguracaoRecomendador, type OrquestradorEquipe } from '../recommendation/orchestrator.js';
import type { RecomendacaoStrategy } from '../recommendation/strategies.js';
import { CatalogoProfissionais } from './catalog.js';

type Alteracoes = Partial<Omit<ProjetoDados, 'id' | 'produtorId' | 'emailProdutor'>>;
/** Dependências opcionais do sistema; todas são interfaces ou fábricas. */
export interface DependenciasSistema {
  /** Monta o orquestrador com a fábrica do tipo e a configuração do recomendador. */
  criarOrquestrador?: (fabrica: FabricaProjeto, configuracao: ConfiguracaoRecomendador) => OrquestradorEquipe;
  /** Origem do catálogo usado nas recomendações; padrão: o próprio repositório. */
  profissionais?: RepositorioProfissionais;
  /** Protótipos de projeto; cada um fornece sua fábrica (Factory Method). */
  prototipos?: RegistroPrototipos;
  /** Adaptadores de armazenamento, pagamento e cadastro de profissionais (Adapter). */
  adaptadores?: Partial<AdaptadoresExternos>;
  /** Pilha de decoradores do recomendador (Decorator). */
  pilha?: MontadorPilhaRecomendacao;
}
/** Arquivo de mídia de um projeto. */
export interface ArquivoProjeto { id: string; arquivo: string }

export class SistemaRecomendacao {
  readonly catalogo: CatalogoProfissionais;
  readonly prototipos: RegistroPrototipos;
  readonly pilha: MontadorPilhaRecomendacao;
  private adaptadorArmazenamento?: AdaptadorArmazenamento;
  private adaptadorPagamento?: AdaptadorPagamento;
  private adaptadorProfissional?: AdaptadorProfissional;
  private estrategiaAtual?: RecomendacaoStrategy;
  private readonly criarOrquestrador: NonNullable<DependenciasSistema['criarOrquestrador']>;
  private readonly profissionais: RepositorioProfissionais;
  private readonly configuracao: ConfiguracaoRecomendador;

  /**
   * @param repo Repositório de projetos, eventos e cadastros.
   * @param eventos Processador da fila de eventos (Observer).
   * @param dependencias Implementações injetadas; nenhuma classe concreta de provedor é criada aqui.
   */
  constructor(private readonly repo: Repositorio, private readonly eventos: ProcessadorEventos, dependencias: DependenciasSistema = {}) {
    this.profissionais = dependencias.profissionais ?? repo;
    this.prototipos = dependencias.prototipos ?? RegistroPrototipos.padrao();
    this.pilha = dependencias.pilha ?? new MontadorPilhaRecomendacao();
    this.criarOrquestrador = dependencias.criarOrquestrador ?? ((fabrica, configuracao) => new OrquestradorPadrao(fabrica, configuracao));
    this.catalogo = new CatalogoProfissionais(this.profissionais);
    this.configuracao = {
      estrategia: () => this.estrategiaAtual,
      decorar: (recomendador, projeto) => this.pilha.montar(recomendador, projeto.decoradores),
    };
    const { armazenamento, pagamento, profissional } = dependencias.adaptadores ?? {};
    this.adaptadorArmazenamento = armazenamento;
    this.adaptadorPagamento = pagamento;
    this.adaptadorProfissional = profissional;
  }
  /**
   * Troca os provedores externos em tempo de execução. A lógica de negócio só
   * conhece as interfaces, então nenhuma outra linha muda.
   */
  configurarAdaptadores(armazenamento: AdaptadorArmazenamento, pagamento: AdaptadorPagamento, profissional: AdaptadorProfissional): void {
    this.adaptadorArmazenamento = armazenamento;
    this.adaptadorPagamento = pagamento;
    this.adaptadorProfissional = profissional;
  }
  /** Provedores configurados no momento, para diagnóstico. */
  provedores(): Partial<Record<keyof AdaptadoresExternos, string>> {
    return { armazenamento: this.adaptadorArmazenamento?.provedor, pagamento: this.adaptadorPagamento?.provedor, profissional: this.adaptadorProfissional?.provedor };
  }
  /**
   * Fixa a estratégia base de todas as recomendações; a fábrica do tipo e a pilha
   * de decoradores continuam sendo aplicadas sobre ela.
   *
   * @param estrategia Estratégia a usar, ou indefinido para voltar à escolhida em cada projeto.
   */
  definirEstrategia(estrategia?: RecomendacaoStrategy): void { this.estrategiaAtual = estrategia; }
  /**
   * Seleciona a fábrica do tipo de projeto, sem condicionais: o protótipo registrado
   * para o tipo cria a fábrica concreta da sua família.
   *
   * @throws ErroDominio Quando o tipo não tem protótipo registrado.
   */
  fabricaPara(tipo: TipoProjeto): FabricaProjeto {
    return this.prototipos.obter(tipo).criarFabrica();
  }
  private orquestradorPara(projeto: ProjetoDados): OrquestradorEquipe {
    return this.criarOrquestrador(this.fabricaPara(projeto.tipoCaptacao), this.configuracao);
  }
  private evento(tipo: string, projetoId: string, origem: string, dados: Record<string, unknown>, destinatarios: Destinatario[] = []): EventoRecomendacao {
    return { id: id(), tipo, projetoId, origem, dados, destinatarios: [...new Map(destinatarios.map(d => [d.id, d])).values()], data: agora(), entregues: [] };
  }
  async cadastrarProfissional(dados: Omit<ProfissionalDados, 'id'>): Promise<ProfissionalDados> {
    const profissional = { ...dados, faixaPreco: dados.faixaPreco ?? { minimo: dados.preco, maximo: dados.preco }, id: id() };
    validarProfissional(profissional);
    await this.gravarProfissional(profissional, this.evento('PROFISSIONAL_CADASTRADO', '', profissional.id, { profissionalId: profissional.id }));
    return profissional;
  }
  /**
   * Importa para o cadastro interno os profissionais da fonte configurada
   * (AdaptadorProfissional). Perfis já importados e sem mudança não são regravados.
   */
  async importarProfissionais(criterios: CriteriosProfissional = {}): Promise<{ provedor: string; importados: number; atualizados: number; inalterados: number; profissionais: string[] }> {
    const fonte = this.exigirAdaptador(this.adaptadorProfissional, 'profissionais');
    const encontrados = await fonte.listarProfissionais(criterios);
    const atuais = new Map((await this.profissionais.listarProfissionais()).map(p => [p.id, p]));
    const resultado = { provedor: fonte.provedor, importados: 0, atualizados: 0, inalterados: 0, profissionais: [] as string[] };
    for (const { dados } of encontrados) {
      resultado.profissionais.push(dados.id);
      const atual = atuais.get(dados.id);
      if (atual && isDeepStrictEqual(normalizarProfissional(atual), normalizarProfissional(dados))) { resultado.inalterados++; continue; }
      await this.gravarProfissional(dados, this.evento('PROFISSIONAL_IMPORTADO', '', dados.id, { profissionalId: dados.id, provedor: fonte.provedor }));
      if (atual) resultado.atualizados++;
      else resultado.importados++;
    }
    return resultado;
  }
  /** Detalhes de um profissional na fonte configurada. */
  async detalharProfissional(profissionalId: string): Promise<ProfissionalDados> {
    return (await this.exigirAdaptador(this.adaptadorProfissional, 'profissionais').detalharProfissional(profissionalId)).dados;
  }
  /** Registra a avaliação de um produtor na fonte configurada. */
  async avaliarProfissional(profissionalId: string, avaliacao: NovaAvaliacao): Promise<void> {
    await this.exigirAdaptador(this.adaptadorProfissional, 'profissionais').registrarAvaliacao(profissionalId, avaliacao);
    this.catalogo.invalidar();
  }
  async obter(projetoId: string): Promise<EstadoProjeto> {
    const estado = await this.repo.obterProjeto(projetoId);
    exigir(estado, 'Projeto não encontrado.', 404);
    return this.normalizar(estado);
  }
  async criar(dados: NovoProjeto): Promise<EstadoProjeto> {
    // O protótipo do tipo fornece papéis, estratégia e parâmetros não informados;
    // a fábrica monta o serviço principal (Composite).
    const { estado } = this.fabricaPara(dados.tipoCaptacao).criarProjeto(dados);
    validarProjeto(estado.projeto);
    const eventos = await this.recomendar(estado, []);
    return this.salvar(estado, eventos);
  }
  /**
   * Monta a equipe de um projeto sem gravá-lo, usando a fábrica do próprio projeto.
   *
   * @param projeto Projeto do domínio; seu estado não é alterado.
   * @returns Equipe sugerida, com custo e status calculados.
   */
  async executarRecomendacao(projeto: Projeto): Promise<Equipe> {
    const estado = structuredClone(projeto.estado);
    const { profissionais } = await this.catalogo.obter();
    const fixos = estado.equipe.membros.filter(m => m.aceitoProdutor);
    const resultado = this.criarOrquestrador(projeto.criarFabrica(), this.configuracao).orquestrar(estado.projeto, profissionais, fixos, estado.excluidos);
    estado.equipe = { id: estado.equipe.id, membros: resultado.membros, custo: 0, status: 'sugerida' };
    this.atualizarEquipe(estado);
    return estado.equipe;
  }
  /** Simula a criação de um projeto: equipe sugerida e resumo dos serviços, sem gravar nada. */
  async simular(dados: NovoProjeto): Promise<{ equipe: Equipe; servicos: ResumoServico }> {
    const projeto = this.fabricaPara(dados.tipoCaptacao).criarProjeto(dados);
    validarProjeto(projeto.estado.projeto);
    const equipe = await this.executarRecomendacao(projeto);
    return { equipe, servicos: resumirServico(projeto.servicoPrincipal, new Set(equipe.membros.map(m => m.papel))) };
  }
  async reavaliar(projetoId: string, alteracoes: Alteracoes): Promise<EstadoProjeto> {
    exigir(!(alteracoes.servicoPrincipal && alteracoes.papeis), 'Informe servicoPrincipal ou papeis, não ambos.');
    const estado = await this.obter(projetoId);
    const anterior = estado.projeto;
    estado.projeto = { ...anterior, ...alteracoes };
    this.sincronizarServicos(estado, anterior, alteracoes);
    validarProjeto(estado.projeto);
    estado.excluidos = {};
    for (const convite of estado.convites) if (convite.status === 'pendente' || convite.status === 'aceito') convite.status = 'cancelado';
    const anteriores = estado.equipe.membros;
    const eventos = await this.recomendar(estado, []);
    eventos.unshift(await this.notificar(estado, 'EQUIPE_REAVALIADA', anteriores, { alteracoes }));
    return this.salvar(estado, eventos);
  }
  async decidir(projetoId: string, papel: Papel, acao: 'aceitar' | 'rejeitar' | 'substituir', profissionalId?: string): Promise<EstadoProjeto> {
    const estado = await this.obter(projetoId);
    exigir(estado.projeto.papeis.some(p => p.papel === papel), 'Papel não exigido pelo projeto.');
    const membro = estado.equipe.membros.find(m => m.papel === papel);
    if (acao === 'aceitar') {
      exigir(membro, 'Não há profissional sugerido para esse papel.');
      exigir(!membro.aceitoProdutor, 'Esse profissional já foi aceito pelo produtor.', 409);
      membro.aceitoProdutor = true;
      const convite: Convite = { id: id(), papel, profissionalId: membro.profissionalId, status: 'pendente' };
      estado.convites.push(convite);
      this.atualizarEquipe(estado);
      return this.salvar(estado, [await this.notificar(estado, 'CONVITE_ENVIADO', [membro], { conviteId: convite.id })]);
    }
    exigir(membro || acao === 'substituir', 'Não há membro para rejeitar.');
    if (membro) {
      estado.excluidos[papel] = [...(estado.excluidos[papel] ?? []), membro.profissionalId];
      this.cancelarConvites(estado, papel);
    }
    const fixos = estado.equipe.membros.filter(m => m.papel !== papel);
    const eventos = [await this.notificar(estado, acao === 'rejeitar' ? 'MEMBRO_REJEITADO' : 'MEMBRO_SUBSTITUIDO', membro ? [membro] : [], { papel })];
    if (profissionalId) {
      exigir(!estado.excluidos[papel]?.includes(profissionalId), 'Profissional já rejeitado para esse papel.');
      const { profissionais, degradada } = await this.catalogo.obter();
      exigir(!degradada, 'Não foi possível validar o substituto no catálogo.', 503);
      const candidato = profissionais.find(p => p.id === profissionalId);
      exigir(candidato, 'Profissional não encontrado.', 404);
      const { membros } = this.orquestradorPara(estado.projeto).orquestrar(estado.projeto, [candidato], fixos, estado.excluidos);
      const substituto = membros.find(m => m.papel === papel && m.profissionalId === profissionalId);
      exigir(substituto, 'O substituto não atende ao papel, disponibilidade, localização, nota ou orçamento.');
      fixos.push(substituto);
    }
    eventos.push(...await this.recomendar(estado, fixos));
    return this.salvar(estado, eventos);
  }
  async responderConvite(projetoId: string, conviteId: string, aceitar: boolean): Promise<EstadoProjeto> {
    const estado = await this.obter(projetoId);
    const convite = estado.convites.find(c => c.id === conviteId);
    exigir(convite, 'Convite não encontrado.', 404);
    exigir(convite.status === 'pendente', 'Convite já respondido ou cancelado.', 409);
    const membro = estado.equipe.membros.find(m => m.papel === convite.papel && m.profissionalId === convite.profissionalId);
    exigir(membro, 'O profissional não pertence mais à equipe.', 409);
    convite.status = aceitar ? 'aceito' : 'recusado';
    await this.salvar(estado, [this.formatar(estado, this.evento(aceitar ? 'CONVITE_ACEITO' : 'CONVITE_RECUSADO', projetoId, convite.profissionalId, { conviteId, papel: convite.papel }, [this.produtor(estado)]))]);
    await this.eventos.processar();
    return this.obter(projetoId);
  }
  async aplicarRespostaConvite(evento: EventoRecomendacao): Promise<void> {
    if (evento.tipo !== 'CONVITE_ACEITO' && evento.tipo !== 'CONVITE_RECUSADO') return;
    const estado = await this.obter(evento.projetoId);
    const convite = estado.convites.find(c => c.id === evento.dados.conviteId);
    // O evento pode ser repetido ou chegar depois de uma reavaliação/substituição.
    if (!convite || convite.respostaProcessada || convite.status === 'cancelado') return;
    exigir(convite.status === (evento.tipo === 'CONVITE_ACEITO' ? 'aceito' : 'recusado'), 'Resposta incompatível com o convite.', 409);
    const membro = estado.equipe.membros.find(m => m.papel === convite.papel && m.profissionalId === convite.profissionalId);
    exigir(membro, 'O profissional não pertence mais à equipe.', 409);
    const eventos: EventoRecomendacao[] = [];
    if (convite.status === 'aceito') {
      membro.confirmado = true;
      this.atualizarEquipe(estado);
      if (estado.equipe.status === 'formada') eventos.push(await this.notificar(estado, 'EQUIPE_FORMADA', estado.equipe.membros, { equipe: estado.equipe }));
    } else {
      estado.excluidos[convite.papel] = [...(estado.excluidos[convite.papel] ?? []), convite.profissionalId];
      eventos.push(...await this.recomendar(estado, estado.equipe.membros.filter(m => m.papel !== convite.papel)));
    }
    convite.respostaProcessada = true;
    await this.salvar(estado, eventos);
  }
  /** Relatório do produtor: Visitors da atividade 1, produtos da fábrica e hierarquia de serviços. */
  async gerarRelatorio(projetoId: string) {
    const estado = await this.obter(projetoId);
    const { profissionais } = await this.catalogo.obter();
    const membros = new Set(estado.equipe.membros.map(m => m.profissionalId));
    const projeto = this.prototipos.hidratar(estado, profissionais.filter(p => membros.has(p.id)).map(p => new Profissional(p)));
    const fabrica = projeto.criarFabrica();
    const custo = projeto.calcularCustoTotal();
    return {
      tipo: projeto.tipo, restricoes: projeto.restricoes, texto: projeto.aceitar(fabrica.criarRelatorio()),
      compatibilidade: projeto.aceitar(new CalculadorCompatibilidade()),
      pendencias: [...projeto.aceitar(new ValidadorConsistencia()), ...fabrica.criarValidador().validar(estado.projeto), ...this.avisosServicos(estado.projeto, custo)],
      servicos: { custoTotal: custo, prazoTotal: projeto.obterPrazoTotal(),
        arvore: resumirServico(projeto.servicoPrincipal, new Set(estado.equipe.membros.map(m => m.papel))) },
    };
  }
  /** Hierarquia de serviços do projeto, com custo, prazo e cobertura de cada nó. */
  async servicos(projetoId: string): Promise<ResumoServico> {
    const estado = await this.obter(projetoId);
    return resumirServico(this.prototipos.hidratar(estado).servicoPrincipal, new Set(estado.equipe.membros.map(m => m.papel)));
  }
  /**
   * Armazena um arquivo de mídia do projeto no provedor configurado.
   *
   * @returns Identificador do provedor e nome curto usado nas rotas.
   */
  async anexarArquivo(projetoId: string, conteudo: Buffer, metadados: Omit<MetadadosArquivo, 'pasta'>): Promise<ArquivoProjeto> {
    await this.obter(projetoId);
    const idArquivo = await this.exigirAdaptador(this.adaptadorArmazenamento, 'armazenamento')
      .salvarArquivo(conteudo, { ...metadados, pasta: pastaProjeto(projetoId) });
    return arquivoProjeto(idArquivo);
  }
  async listarArquivos(projetoId: string): Promise<ArquivoProjeto[]> {
    await this.obter(projetoId);
    const ids = await this.exigirAdaptador(this.adaptadorArmazenamento, 'armazenamento').listarArquivos(`${pastaProjeto(projetoId)}/`);
    return ids.map(arquivoProjeto);
  }
  /** @param arquivo Nome curto devolvido por anexarArquivo ou listarArquivos. */
  async obterArquivo(projetoId: string, arquivo: string): Promise<Buffer> {
    await this.obter(projetoId);
    // O identificador é montado aqui, então um projeto nunca lê arquivos de outro.
    return this.exigirAdaptador(this.adaptadorArmazenamento, 'armazenamento').recuperarArquivo(`${pastaProjeto(projetoId)}/${arquivo}`);
  }
  /**
   * Paga cada membro da equipe formada pelo gateway configurado. Membros já pagos
   * são ignorados, então repetir a chamada não gera cobrança dupla. Pagamentos
   * concluídos antes de uma falha do gateway são gravados mesmo assim.
   */
  async pagarEquipe(projetoId: string): Promise<{ efetuados: Pagamento[]; pagamentos: Pagamento[] }> {
    const gateway = this.exigirAdaptador(this.adaptadorPagamento, 'pagamento');
    const estado = await this.obter(projetoId);
    exigir(estado.equipe.status === 'formada', 'A equipe precisa estar formada para o pagamento.', 409);
    const efetuados: Pagamento[] = [];
    try {
      for (const membro of estado.equipe.membros) {
        const pago = estado.pagamentos.some(p => p.profissionalId === membro.profissionalId && p.papel === membro.papel && (p.status === 'aprovado' || p.status === 'pendente'));
        if (pago) continue;
        const transacaoId = await gateway.efetuarPagamento(membro.preco, estado.projeto.produtorId, membro.profissionalId);
        const pagamento: Pagamento = { id: id(), transacaoId, provedor: gateway.provedor, profissionalId: membro.profissionalId, papel: membro.papel,
          valor: membro.preco, status: await gateway.verificarPagamento(transacaoId), criadoEm: agora() };
        estado.pagamentos.push(pagamento);
        efetuados.push(pagamento);
      }
    } finally {
      if (efetuados.length) {
        await this.salvar(estado, [await this.notificar(estado, 'PAGAMENTOS_EFETUADOS', efetuados, { provedor: gateway.provedor, pagamentos: efetuados.map(p => p.id) })]);
      }
    }
    return { efetuados, pagamentos: estado.pagamentos };
  }
  /** Pagamentos do projeto, com o status consultado no provedor que os processou. */
  async listarPagamentos(projetoId: string): Promise<Pagamento[]> {
    const estado = await this.obter(projetoId);
    const gateway = this.adaptadorPagamento;
    return Promise.all(estado.pagamentos.map(async pagamento => {
      // Pagamentos de outro provedor (configuração anterior) mantêm o último status gravado.
      if (!gateway || gateway.provedor !== pagamento.provedor) return pagamento;
      return { ...pagamento, status: await gateway.verificarPagamento(pagamento.transacaoId) };
    }));
  }
  async cancelarPagamento(projetoId: string, pagamentoId: string): Promise<Pagamento> {
    const gateway = this.exigirAdaptador(this.adaptadorPagamento, 'pagamento');
    const estado = await this.obter(projetoId);
    const pagamento = estado.pagamentos.find(p => p.id === pagamentoId);
    exigir(pagamento, 'Pagamento não encontrado.', 404);
    exigir(pagamento.provedor === gateway.provedor, `O pagamento foi processado por ${pagamento.provedor}; configure esse provedor para cancelá-lo.`, 409);
    exigir(pagamento.status === 'aprovado' || pagamento.status === 'pendente', 'O pagamento já foi cancelado ou recusado.', 409);
    exigir(await gateway.cancelarPagamento(pagamento.transacaoId), 'O provedor recusou o cancelamento.', 409);
    pagamento.status = await gateway.verificarPagamento(pagamento.transacaoId);
    await this.salvar(estado, [await this.notificar(estado, 'PAGAMENTO_CANCELADO', [pagamento], { pagamentoId, provedor: gateway.provedor })]);
    return pagamento;
  }
  private cancelarConvites(estado: EstadoProjeto, papel: Papel): void {
    for (const convite of estado.convites) if (convite.papel === papel && ['pendente', 'aceito'].includes(convite.status)) convite.status = 'cancelado';
  }
  private produtor(estado: EstadoProjeto): Destinatario { return { id: estado.projeto.produtorId, email: estado.projeto.emailProdutor }; }
  private async notificar(estado: EstadoProjeto, tipo: string, membros: Pick<MembroEquipe, 'profissionalId'>[], dados: Record<string, unknown>): Promise<EventoRecomendacao> {
    const { profissionais } = await this.catalogo.obter();
    const envolvidos = new Set(membros.map(m => m.profissionalId));
    return this.formatar(estado, this.evento(tipo, estado.projeto.id, estado.projeto.produtorId, dados,
      [this.produtor(estado), ...profissionais.filter(p => envolvidos.has(p.id)).map(p => ({ id: p.id, email: p.email }))]));
  }
  /** Anexa ao evento o assunto e a mensagem no formato do notificador do tipo de projeto. */
  private formatar(estado: EstadoProjeto, evento: EventoRecomendacao): EventoRecomendacao {
    return { ...evento, ...this.fabricaPara(estado.projeto.tipoCaptacao).criarNotificador().compor(evento.tipo, estado.projeto) };
  }
  private async recomendar(estado: EstadoProjeto, fixos: MembroEquipe[]): Promise<EventoRecomendacao[]> {
    const { profissionais, degradada } = await this.catalogo.obter();
    const resultado = this.orquestradorPara(estado.projeto).orquestrar(estado.projeto, profissionais, fixos, estado.excluidos);
    estado.equipe = { id: estado.equipe.id, membros: resultado.membros, custo: 0, status: 'sugerida' };
    estado.recomendacao = {
      id: id(), criadaEm: agora(), estrategia: estado.projeto.estrategia,
      ranking: Object.fromEntries([...resultado.ranking].map(([papel, candidatos]) => [papel, candidatos.slice(0, 10)])),
      faltantes: resultado.faltantes, degradada,
      avisos: [...(degradada ? ['Catálogo indisponível: utilizando cache recente ou equipe parcial.'] : []),
        ...(resultado.faltantes.length ? ['Não foi encontrada uma equipe completa dentro das restrições.'] : []),
        ...this.avisosServicos(estado.projeto, servicoDeDados(estado.projeto.servicoPrincipal).calcularCusto())],
    };
    this.atualizarEquipe(estado);
    const recomendados = [...resultado.membros, ...Object.values(estado.recomendacao.ranking).flat()];
    return [await this.notificar(estado, 'RECOMENDACAO_GERADA', recomendados, { recomendacaoId: estado.recomendacao.id, estrategia: estado.projeto.estrategia, degradada, faltantes: resultado.faltantes })];
  }
  private atualizarEquipe(estado: EstadoProjeto): void {
    const { equipe, projeto } = estado;
    equipe.custo = equipe.membros.reduce((s, m) => s + centavos(m.preco), 0) / 100;
    const completa = projeto.papeis.every(p => equipe.membros.some(m => m.papel === p.papel));
    equipe.status = !completa ? 'parcial' : equipe.membros.every(m => m.confirmado && m.aceitoProdutor) ? 'formada'
      : equipe.membros.some(m => m.aceitoProdutor) ? 'aguardando' : 'sugerida';
    if (equipe.status === 'formada') equipe.dataFormacao = agora();
    else delete equipe.dataFormacao;
  }
  /** O custo estimado acima do orçamento é um alerta, não um erro: a equipe real pode custar menos. */
  private avisosServicos(projeto: ProjetoDados, custo: number): string[] {
    return centavos(custo) > centavos(projeto.orcamento) ? [`O custo estimado dos serviços (R$ ${custo.toFixed(2)}) excede o orçamento.`] : [];
  }
  /**
   * Mantém o serviço principal coerente com a reavaliação: usa o enviado, converte
   * a lista legada de papéis ou recalcula o pacote gerado automaticamente quando
   * datas, orçamento ou tipo mudam. Pacotes personalizados nunca são recalculados.
   */
  private sincronizarServicos(estado: EstadoProjeto, anterior: ProjetoDados, alteracoes: Alteracoes): void {
    const projeto = this.prototipos.hidratar(estado);
    if (alteracoes.servicoPrincipal) { projeto.definirServicoPrincipal(servicoDeDados(alteracoes.servicoPrincipal)); return; }
    if (alteracoes.papeis) { projeto.definirServicoPrincipal(servicosDePapeis(estado.projeto)); return; }
    if (isDeepStrictEqual(anterior.servicoPrincipal, servicosDePapeis(anterior).paraDados())) {
      projeto.definirServicoPrincipal(servicosDePapeis(estado.projeto));
    } else if (isDeepStrictEqual(anterior.servicoPrincipal, this.fabricaPara(anterior.tipoCaptacao).criarServicoPrincipal(anterior).paraDados())) {
      projeto.definirServicoPrincipal(projeto.criarFabrica().criarServicoPrincipal(estado.projeto));
    }
  }
  /** Completa estados gravados antes da atividade 3, que não tinham serviços nem pagamentos. */
  private normalizar(estado: EstadoProjeto): EstadoProjeto {
    estado.pagamentos ??= [];
    if (!estado.projeto.servicoPrincipal) this.prototipos.hidratar(estado).definirServicoPrincipal(servicosDePapeis(estado.projeto));
    return estado;
  }
  private async gravarProfissional(profissional: ProfissionalDados, evento: EventoRecomendacao): Promise<void> {
    await this.profissionais.salvarProfissional(profissional, evento);
    if (this.profissionais !== this.repo) await this.repo.salvarEventos([evento]);
    this.catalogo.invalidar();
    void this.eventos.processar();
  }
  private exigirAdaptador<T>(adaptador: T | undefined, nome: string): T {
    exigir(adaptador, `Adaptador de ${nome} não configurado.`, 503);
    return adaptador;
  }
  private async salvar(estado: EstadoProjeto, eventos: EventoRecomendacao[]): Promise<EstadoProjeto> {
    const versao = estado.versao;
    estado.versao++;
    await this.repo.salvarProjeto(estado, versao, eventos);
    void this.eventos.processar();
    return estado;
  }
}

function pastaProjeto(projetoId: string): string { return `projetos/${projetoId}`; }
function arquivoProjeto(idArquivo: string): ArquivoProjeto { return { id: idArquivo, arquivo: idArquivo.slice(idArquivo.lastIndexOf('/') + 1) }; }
/** Ordena as listas cuja ordem a fonte ou o banco não preservam, para comparar cadastros. */
function normalizarProfissional(p: ProfissionalDados): ProfissionalDados {
  return { ...p, competencias: [...p.competencias].sort((a, b) => a.nome.localeCompare(b.nome)),
    avaliacoes: [...p.avaliacoes].sort((a, b) => a.produtorId.localeCompare(b.produtorId)) };
}
