import { randomUUID } from 'node:crypto';
import type { FabricaProjeto } from './fabricas.js';
import { servicoDeDados, validarEstruturaServicos, type FaseServico, type ServicoDados, type ServicoProjeto } from './servicos.js';

export const PAPEIS = ['DIRETOR', 'DIRETOR_FOTOGRAFIA', 'SONOPLASTA', 'EDITOR', 'ROTEIRISTA', 'EFEITOS_VISUAIS'] as const;
export type Papel = typeof PAPEIS[number];
export const TIPOS_PROJETO = ['documentario', 'ficcao', 'animacao', 'publicitario'] as const;
export type TipoProjeto = typeof TIPOS_PROJETO[number];
export type Estrategia = 'cosseno' | 'colaborativa' | 'orcamento';
/** Funcionalidades transversais que podem envolver o recomendador (Decorator). */
export const DECORADORES = ['cache', 'auditoria', 'compressao'] as const;
export type NomeDecorador = typeof DECORADORES[number];
export type StatusPagamento = 'pendente' | 'aprovado' | 'cancelado' | 'recusado';
export interface Competencia { nome: string; nivel: number }
export interface Avaliacao { produtorId: string; nota: number; comentario: string; data: string }
export interface Trabalho { projetoId: string; genero: string; papel: Papel }
export interface ProfissionalDados {
  id: string;
  nome: string;
  email: string;
  papeis: Papel[];
  competencias: Competencia[];
  preco: number;
  faixaPreco: { minimo: number; maximo: number };
  disponibilidade: { inicio: string; fim: string };
  localizacao: string;
  remoto: boolean;
  historico: Trabalho[];
  avaliacoes: Avaliacao[];
}
export interface PapelExigido { papel: Papel; peso: number; competencias: Competencia[] }
export interface Parametros { pesoTecnico: number; pesoHistorico: number; notaMinima: number }
export interface ProjetoDados {
  id: string;
  produtorId: string;
  emailProdutor: string;
  titulo: string;
  genero: string;
  duracao: number;
  orcamento: number;
  inicio: string;
  prazo: string;
  tipoCaptacao: TipoProjeto;
  localizacao: string;
  /** Hierarquia de serviços (Composite); é a fonte da verdade sobre o que o projeto exige. */
  servicoPrincipal: ServicoDados;
  /**
   * Projeção derivada de `servicoPrincipal`, mantida porque o contrato de
   * RecomendacaoStrategy (inalterado) recebe a lista de papéis.
   */
  papeis: PapelExigido[];
  estrategia: Estrategia;
  parametros: Parametros;
  /** Pilha de decoradores preferida pelo produtor; ausente, vale a política do sistema. */
  decoradores?: NomeDecorador[];
}
/**
 * Dados de entrada de um novo projeto; o protótipo do tipo completa os campos opcionais.
 * Informe `servicoPrincipal` ou a lista legada `papeis`, nunca ambos.
 */
export type NovoProjeto = Omit<ProjetoDados, 'id' | 'papeis' | 'estrategia' | 'parametros' | 'servicoPrincipal'>
  & Partial<Pick<ProjetoDados, 'papeis' | 'estrategia' | 'parametros' | 'servicoPrincipal'>>;
/** Ajustes finos aplicados sobre um clone; o tipo do projeto é definido pela subclasse. */
export type AjustesProjeto = Partial<Omit<ProjetoDados, 'id' | 'tipoCaptacao'>>;
/** Restrições comuns a todos os tipos de projeto; cada subclasse acrescenta as suas. */
export interface RestricoesProjeto {
  papeisObrigatorios: Papel[];
  competenciasPrioritarias: Competencia[];
  duracaoMaxima?: number;
  /** Etapas do pacote de serviços padrão do tipo. */
  fases: FaseServico[];
}
export interface Candidato { profissionalId: string; nome: string; preco: number; pontuacao: number }
export interface MembroEquipe extends Candidato { papel: Papel; confirmado: boolean; aceitoProdutor: boolean }
export interface Equipe {
  id: string;
  membros: MembroEquipe[];
  status: 'sugerida' | 'aguardando' | 'formada' | 'parcial';
  custo: number;
  dataFormacao?: string;
}
export interface Recomendacao {
  id: string;
  criadaEm: string;
  estrategia: Estrategia;
  ranking: Partial<Record<Papel, Candidato[]>>;
  faltantes: Papel[];
  avisos: string[];
  degradada: boolean;
}
export interface Convite {
  id: string;
  papel: Papel;
  profissionalId: string;
  status: 'pendente' | 'aceito' | 'recusado' | 'cancelado';
  respostaProcessada?: boolean;
}
/** Pagamento de um membro da equipe, processado pelo AdaptadorPagamento configurado. */
export interface Pagamento {
  id: string;
  /** Identificador da transação no provedor. */
  transacaoId: string;
  provedor: string;
  profissionalId: string;
  papel: Papel;
  valor: number;
  status: StatusPagamento;
  criadoEm: string;
}
export interface EstadoProjeto {
  projeto: ProjetoDados;
  equipe: Equipe;
  recomendacao: Recomendacao;
  convites: Convite[];
  excluidos: Partial<Record<Papel, string[]>>;
  pagamentos: Pagamento[];
  versao: number;
}
export interface Destinatario { id: string; email: string }
export interface EventoRecomendacao {
  id: string;
  tipo: string;
  projetoId: string;
  origem: string;
  data: string;
  dados: Record<string, unknown>;
  destinatarios: Destinatario[];
  entregues: string[];
  /** Assunto e corpo no formato do tipo de projeto; ausentes em eventos sem projeto. */
  assunto?: string;
  mensagem?: string;
}
export interface Notificacao {
  id: string;
  eventoId: string;
  destinatarioId: string;
  canal: 'email' | 'interno';
  destino: string;
  mensagem: string;
  status: 'registrada' | 'enviada';
}
export interface VisitanteProjeto<T> {
  visitarProjeto(projeto: Projeto): T;
  visitarProfissional(profissional: Profissional): T;
}
/** Contrato do padrão Prototype. */
export interface Prototipo<T> {
  /** Retorna uma cópia profunda, sem referências compartilhadas com o original. */
  clonar(): T;
}
/**
 * Raiz da hierarquia de projetos (Prototype) e elemento do Visitor.
 *
 * O estado continua sendo um objeto de dados puro, pois é serializado em JSONB e
 * copiado com structuredClone pelos repositórios; a instância rica é montada sob
 * demanda pelo RegistroPrototipos a partir de `tipoCaptacao`.
 */
export abstract class Projeto<R extends RestricoesProjeto = RestricoesProjeto> implements Prototipo<Projeto<R>> {
  abstract readonly tipo: TipoProjeto;
  private estadoAtual: EstadoProjeto;
  private profissionaisAtuais: Profissional[];
  protected constructor(estado: EstadoProjeto, profissionais: Profissional[], readonly restricoes: R) {
    this.estadoAtual = estado;
    this.profissionaisAtuais = profissionais;
  }
  get estado(): EstadoProjeto { return this.estadoAtual; }
  get profissionais(): Profissional[] { return this.profissionaisAtuais; }
  /** Raiz da hierarquia de serviços do projeto (Composite), no lugar da lista de papéis. */
  get servicoPrincipal(): ServicoProjeto { return servicoDeDados(this.estadoAtual.projeto.servicoPrincipal); }
  /**
   * Substitui a hierarquia de serviços e sincroniza a projeção de papéis.
   *
   * @param servico Novo serviço principal, atômico ou pacote.
   * @returns A própria instância, para encadeamento.
   */
  definirServicoPrincipal(servico: ServicoProjeto): this {
    const projeto = this.estadoAtual.projeto;
    projeto.servicoPrincipal = servico.paraDados();
    projeto.papeis = servico.papeisExigidos();
    return this;
  }
  /** Custo estimado do projeto: delega ao serviço principal, que percorre a hierarquia. */
  calcularCustoTotal(): number { return this.servicoPrincipal.calcularCusto(); }
  /** Prazo total, em dias, calculado recursivamente pelo serviço principal. */
  obterPrazoTotal(): number { return this.servicoPrincipal.obterPrazo(); }
  /** Validação recursiva: papéis dos serviços atômicos e prazos dentro da janela do projeto. */
  validarEstrutura(): string[] { return validarEstruturaServicos(this.estadoAtual.projeto); }
  aceitar<T>(visitante: VisitanteProjeto<T>): T { return visitante.visitarProjeto(this); }
  /** Cada subclasse devolve uma cópia profunda do próprio tipo. */
  abstract clonar(): Projeto<R>;
  /**
   * Aplica ajustes finos sobre esta instância. Use somente em clones, nunca no protótipo registrado.
   *
   * @param ajustes Campos do projeto a sobrescrever; valores indefinidos são ignorados.
   * @param restricoes Restrições específicas a sobrescrever.
   * @returns A própria instância, para encadeamento.
   */
  ajustar(ajustes: AjustesProjeto, restricoes: Partial<R> = {}): this {
    const projeto = this.estadoAtual.projeto;
    // Ajustes são copiados para que o clone não compartilhe referências com quem os enviou.
    this.estadoAtual.projeto = { ...projeto, ...structuredClone(definidos(ajustes)), id: projeto.id, tipoCaptacao: this.tipo };
    Object.assign(this.restricoes, structuredClone(definidos(restricoes)));
    return this;
  }
  /**
   * Retorna um clone deste projeto vinculado a outro estado, sem copiá-lo.
   *
   * @param estado Estado que passa a pertencer ao clone (por referência).
   * @param profissionais Profissionais visitados junto com o projeto.
   * @returns Instância do mesmo tipo concreto, com restrições próprias.
   */
  comEstado(estado: EstadoProjeto, profissionais: Profissional[] = []): Projeto<R> {
    const copia = this.clonar();
    copia.estadoAtual = estado;
    copia.profissionaisAtuais = profissionais;
    return copia;
  }
  /**
   * Cria um novo projeto usando este como protótipo.
   *
   * @param ajustes Dados que sobrescrevem os valores do protótipo.
   * @returns Clone ajustado, com identidade própria, sem equipe e na versão 0.
   */
  instanciar(ajustes: AjustesProjeto): Projeto<R> {
    const modelo = this.clonar().ajustar(ajustes);
    return modelo.comEstado(estadoInicial({ ...modelo.estado.projeto, id: id() }));
  }
  /**
   * Factory Method: cada tipo de projeto define a fábrica concreta da sua família
   * de objetos (projeto, validador, recomendador e notificador).
   */
  abstract criarFabrica(): FabricaProjeto;
  /** Agregados copiados em profundidade, na ordem dos construtores das subclasses. */
  protected copiarAgregados(): [EstadoProjeto, Profissional[], R] {
    return [structuredClone(this.estadoAtual), this.profissionaisAtuais.map(p => p.clonar()), structuredClone(this.restricoes)];
  }
}
export class Profissional implements Prototipo<Profissional> {
  constructor(readonly dados: ProfissionalDados) {}
  aceitar<T>(visitante: VisitanteProjeto<T>): T { return visitante.visitarProfissional(this); }
  clonar(): Profissional { return new Profissional(structuredClone(this.dados)); }
}
/**
 * Estado de um projeto recém-criado, ainda sem equipe nem convites.
 *
 * @param projeto Dados completos do projeto.
 */
export function estadoInicial(projeto: ProjetoDados): EstadoProjeto {
  return {
    projeto, equipe: { id: id(), membros: [], custo: 0, status: 'parcial' },
    recomendacao: { id: id(), criadaEm: agora(), estrategia: projeto.estrategia, ranking: {}, faltantes: [], avisos: [], degradada: false },
    convites: [], excluidos: {}, pagamentos: [], versao: 0,
  };
}
function definidos<T extends object>(valores: T): Partial<T> {
  return Object.fromEntries(Object.entries(valores).filter(([, valor]) => valor !== undefined)) as Partial<T>;
}
export class ErroDominio extends Error {
  constructor(message: string, readonly statusCode = 422) { super(message); }
}
export const id = () => randomUUID();
export const centavos = (valor: number) => Math.round(valor * 100);
export const agora = () => new Date().toISOString();
export function exigir(condicao: unknown, mensagem: string, status = 422): asserts condicao {
  if (!condicao) throw new ErroDominio(mensagem, status);
}
export function validarProjeto(p: ProjetoDados): void {
  validarData(p.inicio);
  validarData(p.prazo);
  exigir(p.inicio <= p.prazo, 'O início deve ser anterior ou igual ao prazo.');
  exigir(p.papeis.length > 0 && new Set(p.papeis.map(x => x.papel)).size === p.papeis.length, 'Os papéis devem ser únicos e não vazios.');
  exigir(p.parametros.pesoTecnico + p.parametros.pesoHistorico > 0, 'Informe ao menos um peso maior que zero.');
  for (const papel of p.papeis) validarCompetencias(papel.competencias);
}
export function validarCompetencias(lista: Competencia[]): void {
  exigir(new Set(lista.map(c => c.nome.trim().toLowerCase())).size === lista.length, 'Competências duplicadas.');
}
export function validarProfissional(p: ProfissionalDados): void {
  exigir(p.faixaPreco.minimo <= p.faixaPreco.maximo, 'Faixa de preço inválida.');
  exigir(p.preco >= p.faixaPreco.minimo && p.preco <= p.faixaPreco.maximo, 'O preço deve pertencer à faixa informada.');
  validarData(p.disponibilidade.inicio);
  validarData(p.disponibilidade.fim);
  for (const avaliacao of p.avaliacoes) validarData(avaliacao.data);
  exigir(p.disponibilidade.inicio <= p.disponibilidade.fim, 'Disponibilidade inválida.');
  validarCompetencias(p.competencias);
  exigir(new Set(p.avaliacoes.map(a => a.produtorId)).size === p.avaliacoes.length, 'Informe uma avaliação por produtor.');
}
export function validarData(valor: string): void {
  const data = new Date(`${valor}T00:00:00.000Z`);
  exigir(!Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === valor, `Data inválida: ${valor}.`);
}
