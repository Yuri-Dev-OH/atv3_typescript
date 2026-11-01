import type { EstadoProjeto, EventoRecomendacao, Notificacao, Papel, Profissional, ProfissionalDados, StatusPagamento } from './model.js';

export const OBSERVADORES = ['auditoria', 'interno', 'email', 'integracao', 'composicao'];
export interface ProcessadorEventos { processar(): Promise<void> }
export interface PublicadorIntegracao { publicar(destino: string, evento: EventoRecomendacao): Promise<void> }
export interface RepositorioProfissionais {
  listarProfissionais(): Promise<ProfissionalDados[]>;
  salvarProfissional(p: ProfissionalDados, evento: EventoRecomendacao): Promise<void>;
}
export interface Repositorio extends RepositorioProfissionais {
  obterProjeto(id: string): Promise<EstadoProjeto | undefined>;
  salvarProjeto(estado: EstadoProjeto, versaoEsperada: number, eventos: EventoRecomendacao[]): Promise<void>;
  salvarEventos(eventos: EventoRecomendacao[]): Promise<void>;
  eventos(pendentes?: boolean, observadores?: string[]): Promise<EventoRecomendacao[]>;
  confirmarEntrega(eventoId: string, observador: string): Promise<void>;
  registrarAuditoria(evento: EventoRecomendacao): Promise<void>;
  auditoria(projetoId?: string): Promise<EventoRecomendacao[]>;
  salvarNotificacao(n: Notificacao): Promise<void>;
  notificacoes(destinatarioId?: string): Promise<Notificacao[]>;
  registrarIntegracao(evento: EventoRecomendacao, destino: string): Promise<void>;
  integracoes(): Promise<{ eventoId: string; destino: string; dados: Record<string, unknown> }[]>;
  saudavel(): Promise<boolean>;
}
export interface Logger {
  info(obj: unknown, mensagem?: string): void;
  error(obj: unknown, mensagem?: string): void;
}

/** Metadados de um arquivo de mídia do projeto (roteiro, storyboard, amostra de vídeo). */
export interface MetadadosArquivo {
  /** Nome original do arquivo. */
  nome: string;
  /** Tipo MIME, como application/pdf. */
  tipoConteudo: string;
  /** Pasta lógica, como projetos/<id>; o adaptador cria o identificador dentro dela. */
  pasta: string;
}
/**
 * Adapter: contrato único do núcleo para provedores de armazenamento em nuvem.
 *
 * Identificadores são caminhos lógicos (pasta/uuid-nome), iguais em qualquer
 * provedor; cada adaptador os traduz para o formato nativo.
 */
export interface AdaptadorArmazenamento {
  readonly provedor: string;
  /** @returns Identificador do arquivo salvo. */
  salvarArquivo(conteudo: Buffer, metadados: MetadadosArquivo): Promise<string>;
  /** @throws ErroDominio 404 quando o arquivo não existe. */
  recuperarArquivo(id: string): Promise<Buffer>;
  /** @returns Identificadores que começam com o prefixo. */
  listarArquivos(prefixo: string): Promise<string[]>;
}
/** Adapter: contrato único do núcleo para gateways de pagamento. */
export interface AdaptadorPagamento {
  readonly provedor: string;
  /**
   * @param valor Valor em reais, com até duas casas decimais.
   * @param origem Quem paga (produtor).
   * @param destino Quem recebe (profissional).
   * @returns Identificador da transação no provedor.
   */
  efetuarPagamento(valor: number, origem: string, destino: string): Promise<string>;
  /** @returns Verdadeiro quando o provedor cancelou ou estornou a transação. */
  cancelarPagamento(id: string): Promise<boolean>;
  /** @returns Situação normalizada, independente do vocabulário do provedor. */
  verificarPagamento(id: string): Promise<StatusPagamento>;
}
export interface CriteriosProfissional { papel?: Papel; localizacao?: string; remoto?: boolean }
export interface NovaAvaliacao { produtorId: string; nota: number; comentario: string }
/** Adapter: contrato único do núcleo para fontes de cadastro de profissionais. */
export interface AdaptadorProfissional {
  readonly provedor: string;
  /** @returns Profissionais da fonte já no formato do domínio. */
  listarProfissionais(criterios?: CriteriosProfissional): Promise<Profissional[]>;
  /** @throws ErroDominio 404 quando a fonte não conhece o profissional. */
  detalharProfissional(id: string): Promise<Profissional>;
  /** @param avaliacao Nota de 1 a 5 dada por um produtor. */
  registrarAvaliacao(id: string, avaliacao: NovaAvaliacao): Promise<void>;
}
/** Conjunto de adaptadores injetado no SistemaRecomendacao. */
export interface AdaptadoresExternos {
  armazenamento: AdaptadorArmazenamento;
  pagamento: AdaptadorPagamento;
  profissional: AdaptadorProfissional;
}
