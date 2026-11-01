import { FabricaAnimacao, FabricaDocumentario, FabricaFiccao, FabricaPublicitario } from './fabricas.js';
import { Projeto, type EstadoProjeto, type Profissional, type RestricoesProjeto } from './model.js';
import type { FaseServico } from './servicos.js';

export interface RestricoesDocumentario extends RestricoesProjeto {
  /** Exige termo de cessão de direito de imagem dos entrevistados. */
  exigeDireitoImagem: boolean;
  /** Captação em locações reais, sem estúdio. */
  locacoesReais: boolean;
  /** Janela mínima, em dias, entre início e entrega para a captação em campo. */
  diasMinimosCaptacao: number;
}
export interface RestricoesAnimacao extends RestricoesProjeto {
  /** Softwares de modelagem 3D aceitos no pipeline. */
  softwares3D: string[];
  /** Orçamento de render, em minutos de máquina por minuto de obra. */
  minutosRenderPorMinuto: number;
}
export interface RestricoesPublicitario extends RestricoesProjeto {
  /** Janela máxima, em dias, entre início e entrega. */
  prazoMaximoDias: number;
  /** Cada corte precisa de aprovação da agência ou do cliente. */
  aprovacaoCliente: boolean;
}

// Etapas do pacote padrão: em sequência; os papéis de cada etapa trabalham em paralelo.
const fasesFiccao = (): FaseServico[] => [
  { nome: 'Pré-produção', papeis: ['ROTEIRISTA'], fracaoPrazo: 0.2 },
  { nome: 'Produção', papeis: ['DIRETOR', 'DIRETOR_FOTOGRAFIA', 'SONOPLASTA'], fracaoPrazo: 0.4 },
  { nome: 'Pós-produção', papeis: ['EDITOR', 'EFEITOS_VISUAIS'], fracaoPrazo: 0.4 },
];
const fasesDocumentario = (): FaseServico[] => [
  { nome: 'Pesquisa e roteiro', papeis: ['ROTEIRISTA'], fracaoPrazo: 0.2 },
  { nome: 'Captação em campo', papeis: ['DIRETOR', 'DIRETOR_FOTOGRAFIA', 'SONOPLASTA'], fracaoPrazo: 0.5 },
  { nome: 'Pós-produção', papeis: ['EDITOR', 'EFEITOS_VISUAIS'], fracaoPrazo: 0.3 },
];
const fasesAnimacao = (): FaseServico[] => [
  { nome: 'Roteiro e direção de arte', papeis: ['ROTEIRISTA', 'DIRETOR'], fracaoPrazo: 0.15 },
  { nome: 'Modelagem, animação e render', papeis: ['EFEITOS_VISUAIS', 'DIRETOR_FOTOGRAFIA'], fracaoPrazo: 0.6 },
  { nome: 'Finalização', papeis: ['EDITOR', 'SONOPLASTA'], fracaoPrazo: 0.25 },
];
const fasesPublicitario = (): FaseServico[] => [
  { nome: 'Criação', papeis: ['ROTEIRISTA'], fracaoPrazo: 0.2 },
  { nome: 'Filmagem', papeis: ['DIRETOR', 'DIRETOR_FOTOGRAFIA'], fracaoPrazo: 0.3 },
  { nome: 'Finalização', papeis: ['EDITOR', 'SONOPLASTA', 'EFEITOS_VISUAIS'], fracaoPrazo: 0.5 },
];

export const restricoesFiccao = (): RestricoesProjeto => ({
  papeisObrigatorios: ['DIRETOR'], competenciasPrioritarias: [{ nome: 'roteirista', nivel: 1 }], fases: fasesFiccao(),
});
export const restricoesDocumentario = (): RestricoesDocumentario => ({
  papeisObrigatorios: ['DIRETOR', 'DIRETOR_FOTOGRAFIA', 'SONOPLASTA', 'EDITOR'],
  competenciasPrioritarias: [{ nome: 'captacao em campo', nivel: 1 }], exigeDireitoImagem: true, locacoesReais: true, diasMinimosCaptacao: 14, fases: fasesDocumentario(),
});
export const restricoesAnimacao = (): RestricoesAnimacao => ({
  papeisObrigatorios: ['DIRETOR', 'EFEITOS_VISUAIS', 'EDITOR'],
  competenciasPrioritarias: [{ nome: 'modelagem 3d', nivel: 1 }], softwares3D: ['Blender', 'Maya'], minutosRenderPorMinuto: 120, fases: fasesAnimacao(),
});
export const restricoesPublicitario = (): RestricoesPublicitario => ({
  papeisObrigatorios: ['DIRETOR', 'DIRETOR_FOTOGRAFIA', 'EDITOR'],
  competenciasPrioritarias: [{ nome: 'publicidade', nivel: 1 }], duracaoMaxima: 3, prazoMaximoDias: 30, aprovacaoCliente: true, fases: fasesPublicitario(),
});

export class ProjetoFiccao extends Projeto {
  readonly tipo = 'ficcao';
  constructor(estado: EstadoProjeto, profissionais: Profissional[] = [], restricoes = restricoesFiccao()) {
    super(estado, profissionais, restricoes);
  }
  override clonar(): ProjetoFiccao { return new ProjetoFiccao(...this.copiarAgregados()); }
  override criarFabrica(): FabricaFiccao { return new FabricaFiccao(this); }
}
export class ProjetoDocumentario extends Projeto<RestricoesDocumentario> {
  readonly tipo = 'documentario';
  constructor(estado: EstadoProjeto, profissionais: Profissional[] = [], restricoes = restricoesDocumentario()) {
    super(estado, profissionais, restricoes);
  }
  override clonar(): ProjetoDocumentario { return new ProjetoDocumentario(...this.copiarAgregados()); }
  override criarFabrica(): FabricaDocumentario { return new FabricaDocumentario(this); }
}
export class ProjetoAnimacao extends Projeto<RestricoesAnimacao> {
  readonly tipo = 'animacao';
  constructor(estado: EstadoProjeto, profissionais: Profissional[] = [], restricoes = restricoesAnimacao()) {
    super(estado, profissionais, restricoes);
  }
  override clonar(): ProjetoAnimacao { return new ProjetoAnimacao(...this.copiarAgregados()); }
  override criarFabrica(): FabricaAnimacao { return new FabricaAnimacao(this); }
}
export class ProjetoPublicitario extends Projeto<RestricoesPublicitario> {
  readonly tipo = 'publicitario';
  constructor(estado: EstadoProjeto, profissionais: Profissional[] = [], restricoes = restricoesPublicitario()) {
    super(estado, profissionais, restricoes);
  }
  override clonar(): ProjetoPublicitario { return new ProjetoPublicitario(...this.copiarAgregados()); }
  override criarFabrica(): FabricaPublicitario { return new FabricaPublicitario(this); }
}
