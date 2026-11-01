import { NotificadorAnimacao, NotificadorDocumentario, NotificadorFiccao, NotificadorPublicitario, type NotificadorProjeto } from '../events/notificadores-projeto.js';
import { estrategias, RecomendadorPriorizado, type RecomendacaoStrategy } from '../recommendation/strategies.js';
import { exigir, type AjustesProjeto, type Estrategia, type Projeto, type ProjetoDados, type RestricoesProjeto, type TipoProjeto, type VisitanteProjeto } from './model.js';
import { servicoDeDados, servicosDePapeis, servicosPorFases, type ServicoProjeto } from './servicos.js';
import { GeradorRelatorio, GeradorRelatorioAnimacao } from './visitors.js';
import type { ProjetoAnimacao, ProjetoDocumentario, ProjetoFiccao, ProjetoPublicitario, RestricoesAnimacao, RestricoesDocumentario, RestricoesPublicitario } from './projetos.js';
import { ValidadorAnimacao, ValidadorDocumentario, ValidadorFiccao, ValidadorPublicitario, type ValidadorProjeto } from './validadores.js';

/**
 * Abstract Factory: cria, de forma coerente, a família de objetos de um tipo de projeto.
 *
 * Trocar a fábrica troca todo o ecossistema (projeto, validador, recomendador,
 * notificador e pacote de serviços) sem condicionais no orquestrador ou no serviço.
 */
export interface FabricaProjeto {
  readonly tipo: TipoProjeto;
  /**
   * Cria um projeto do tipo, por clonagem do protótipo, aplicando os dados informados.
   * O serviço principal vem de `dados.servicoPrincipal`, da lista legada `dados.papeis`
   * ou, sem nenhum dos dois, do pacote padrão do tipo.
   *
   * @throws ErroDominio Quando `servicoPrincipal` e `papeis` são informados juntos.
   */
  criarProjeto(dados: AjustesProjeto): Projeto;
  criarValidador(): ValidadorProjeto;
  /**
   * @param estrategia Nome da estratégia escolhida pelo produtor (Strategy da atividade 1)
   *     ou uma instância definida em tempo de execução.
   */
  criarRecomendador(estrategia: Estrategia | RecomendacaoStrategy): RecomendacaoStrategy;
  /** Pacote de serviços padrão do tipo (Composite), com etapas próprias. */
  criarServicoPrincipal(projeto: ProjetoDados): ServicoProjeto;
  criarNotificador(): NotificadorProjeto;
  /** Visitante que gera o relatório do produtor no formato do tipo. */
  criarRelatorio(): VisitanteProjeto<string>;
}

/**
 * Base das fábricas concretas. O projeto nasce do clone do protótipo recebido;
 * validador e notificador são Factory Methods implementados por cada subclasse.
 */
export abstract class FabricaBase<R extends RestricoesProjeto> implements FabricaProjeto {
  protected constructor(private readonly prototipo: Projeto<R>) {}
  get tipo(): TipoProjeto { return this.prototipo.tipo; }
  criarProjeto(dados: AjustesProjeto): Projeto<R> {
    exigir(!(dados.servicoPrincipal && dados.papeis), 'Informe servicoPrincipal ou papeis, não ambos.');
    const projeto = this.prototipo.instanciar(dados);
    const p = projeto.estado.projeto;
    return projeto.definirServicoPrincipal(dados.servicoPrincipal ? servicoDeDados(p.servicoPrincipal)
      : dados.papeis ? servicosDePapeis(p) : this.criarServicoPrincipal(p));
  }
  criarRecomendador(estrategia: Estrategia | RecomendacaoStrategy): RecomendacaoStrategy {
    return new RecomendadorPriorizado(this.estrategia(estrategia), this.restricoes().competenciasPrioritarias);
  }
  criarServicoPrincipal(projeto: ProjetoDados): ServicoProjeto {
    return servicosPorFases(projeto, this.restricoes().fases, `Pacote padrão de ${this.tipo}`);
  }
  abstract criarValidador(): ValidadorProjeto;
  abstract criarNotificador(): NotificadorProjeto;
  criarRelatorio(): VisitanteProjeto<string> { return new GeradorRelatorio(); }
  /** Converte o nome da estratégia em instância; instâncias recebidas seguem como estão. */
  protected estrategia(estrategia: Estrategia | RecomendacaoStrategy): RecomendacaoStrategy {
    return typeof estrategia === 'string' ? estrategias[estrategia] : estrategia;
  }
  /** Cópia das restrições do protótipo, para que os produtos não as compartilhem. */
  protected restricoes(): R { return structuredClone(this.prototipo.restricoes); }
}
export class FabricaFiccao extends FabricaBase<RestricoesProjeto> {
  constructor(prototipo: ProjetoFiccao) { super(prototipo); }
  // Ficção conserva a estratégia pura da atividade 1, sem priorização de competências.
  override criarRecomendador(estrategia: Estrategia | RecomendacaoStrategy): RecomendacaoStrategy { return this.estrategia(estrategia); }
  criarValidador(): ValidadorProjeto { return new ValidadorFiccao(this.restricoes()); }
  criarNotificador(): NotificadorProjeto { return new NotificadorFiccao(); }
}
export class FabricaDocumentario extends FabricaBase<RestricoesDocumentario> {
  constructor(prototipo: ProjetoDocumentario) { super(prototipo); }
  criarValidador(): ValidadorProjeto { return new ValidadorDocumentario(this.restricoes()); }
  criarNotificador(): NotificadorProjeto { return new NotificadorDocumentario(this.restricoes()); }
}
export class FabricaAnimacao extends FabricaBase<RestricoesAnimacao> {
  constructor(prototipo: ProjetoAnimacao) { super(prototipo); }
  criarValidador(): ValidadorProjeto { return new ValidadorAnimacao(this.restricoes()); }
  criarNotificador(): NotificadorProjeto { return new NotificadorAnimacao(this.restricoes()); }
  override criarRelatorio(): VisitanteProjeto<string> { return new GeradorRelatorioAnimacao(this.restricoes()); }
}
export class FabricaPublicitario extends FabricaBase<RestricoesPublicitario> {
  constructor(prototipo: ProjetoPublicitario) { super(prototipo); }
  criarValidador(): ValidadorProjeto { return new ValidadorPublicitario(this.restricoes()); }
  criarNotificador(): NotificadorProjeto { return new NotificadorPublicitario(this.restricoes()); }
}
