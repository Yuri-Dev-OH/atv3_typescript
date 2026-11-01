import type { ProjetoDados, RestricoesProjeto } from './model.js';
import { validarEstruturaServicos } from './servicos.js';
import type { RestricoesAnimacao, RestricoesDocumentario, RestricoesPublicitario } from './projetos.js';

/** Produto da fábrica: regras de consistência de um tipo de projeto. */
export interface ValidadorProjeto {
  /**
   * @param projeto Projeto cujos dados básicos (datas, papéis únicos) já foram validados.
   * @returns Violações encontradas; vazio quando o projeto atende ao tipo.
   */
  validar(projeto: ProjetoDados): string[];
}

/**
 * Verifica as restrições comuns, a estrutura recursiva dos serviços (Composite) e
 * delega às subclasses as regras específicas do tipo.
 */
export class ValidadorRestricoes<R extends RestricoesProjeto = RestricoesProjeto> implements ValidadorProjeto {
  constructor(protected readonly restricoes: R, private readonly rotulo: string) {}
  validar(p: ProjetoDados): string[] {
    const erros: string[] = [];
    const ausentes = this.restricoes.papeisObrigatorios.filter(papel => !p.papeis.some(x => x.papel === papel));
    if (ausentes.length) erros.push(`${this.rotulo}: papéis obrigatórios ausentes (${ausentes.join(', ')}).`);
    const { duracaoMaxima } = this.restricoes;
    if (duracaoMaxima !== undefined && p.duracao > duracaoMaxima) erros.push(`${this.rotulo}: a duração máxima é de ${duracaoMaxima} min.`);
    return [...erros, ...validarEstruturaServicos(p), ...this.validarEspecificas(p)];
  }
  protected validarEspecificas(_p: ProjetoDados): string[] { return []; }
}
export class ValidadorFiccao extends ValidadorRestricoes {
  constructor(restricoes: RestricoesProjeto) { super(restricoes, 'Ficção'); }
}
export class ValidadorDocumentario extends ValidadorRestricoes<RestricoesDocumentario> {
  constructor(restricoes: RestricoesDocumentario) { super(restricoes, 'Documentário'); }
  protected override validarEspecificas(p: ProjetoDados): string[] {
    const minimo = this.restricoes.diasMinimosCaptacao;
    return diasEntre(p.inicio, p.prazo) < minimo ? [`Documentário: a captação em campo exige ao menos ${minimo} dias.`] : [];
  }
}
export class ValidadorAnimacao extends ValidadorRestricoes<RestricoesAnimacao> {
  constructor(restricoes: RestricoesAnimacao) { super(restricoes, 'Animação'); }
  protected override validarEspecificas(p: ProjetoDados): string[] {
    const necessarias = horasRender(p.duracao, this.restricoes), disponiveis = diasEntre(p.inicio, p.prazo) * 24;
    return necessarias > disponiveis ? [`Animação: o render estimado (${necessarias} h) excede a janela do projeto (${disponiveis} h).`] : [];
  }
}
export class ValidadorPublicitario extends ValidadorRestricoes<RestricoesPublicitario> {
  constructor(restricoes: RestricoesPublicitario) { super(restricoes, 'Publicidade'); }
  protected override validarEspecificas(p: ProjetoDados): string[] {
    const maximo = this.restricoes.prazoMaximoDias;
    return diasEntre(p.inicio, p.prazo) > maximo ? [`Publicidade: a entrega deve ocorrer em até ${maximo} dias.`] : [];
  }
}

/** Dias corridos entre duas datas AAAA-MM-DD. */
export function diasEntre(inicio: string, prazo: string): number {
  return Math.round((Date.parse(prazo) - Date.parse(inicio)) / 86_400_000);
}
/** Horas de máquina necessárias para renderizar a obra. */
export function horasRender(duracao: number, restricoes: Pick<RestricoesAnimacao, 'minutosRenderPorMinuto'>): number {
  return Math.ceil(duracao * restricoes.minutosRenderPorMinuto / 60);
}
