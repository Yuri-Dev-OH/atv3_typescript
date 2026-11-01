import { centavos, exigir, PAPEIS, type Competencia, type Papel, type PapelExigido, type ProjetoDados } from './model.js';

/** Forma serializável (JSONB) de um serviço atômico. */
export interface ServicoAtomicoDados {
  tipo: 'atomico';
  nome: string;
  papel: Papel;
  /** Custo estimado, em reais. */
  custo: number;
  /** Prazo, em dias corridos. */
  prazo: number;
  /** Importância do papel na escolha da equipe; padrão 1. */
  peso?: number;
  /** Competências pedidas ao profissional; padrão: o próprio papel. */
  competencias?: Competencia[];
}
/** Forma serializável (JSONB) de um pacote de serviços. */
export interface PacoteServicoDados {
  tipo: 'pacote';
  nome: string;
  /** Itens executados ao mesmo tempo (prazo = maior prazo) ou em sequência (prazo = soma). */
  paralelo?: boolean;
  itens: ServicoDados[];
}
export type ServicoDados = ServicoAtomicoDados | PacoteServicoDados;
/** Etapa do pacote padrão de um tipo de projeto. */
export interface FaseServico {
  nome: string;
  papeis: Papel[];
  /** Fração da janela do projeto reservada à etapa. */
  fracaoPrazo: number;
}
/** Resumo recursivo de um nó, usado em relatórios e respostas da API. */
export interface ResumoServico {
  nome: string;
  papel?: Papel;
  custo: number;
  prazo: number;
  coberto: boolean;
  subservicos: ResumoServico[];
}

/** Limites contra árvores abusivas recebidas pela API. */
export const LIMITES_SERVICOS = { profundidade: 6, nos: 200 } as const;
const ROTULOS: Record<Papel, string> = {
  DIRETOR: 'Direção', DIRETOR_FOTOGRAFIA: 'Direção de fotografia', SONOPLASTA: 'Sonoplastia e mixagem de áudio',
  EDITOR: 'Edição e montagem', ROTEIRISTA: 'Roteiro', EFEITOS_VISUAIS: 'Efeitos visuais',
};

/**
 * Componente do padrão Composite: serviço atômico ou pacote de serviços.
 *
 * Cliente nenhum precisa distinguir folhas de compostos; toda operação se
 * propaga recursivamente pela hierarquia.
 */
export interface ServicoProjeto {
  readonly nome: string;
  /** Custo total, em reais, da subárvore. */
  calcularCusto(): number;
  /** Filhos diretos; vazio para serviços atômicos. */
  listarSubservicos(): ServicoProjeto[];
  /** Prazo total, em dias, da subárvore. */
  obterPrazo(): number;
  /** Violações de estrutura da subárvore; vazio quando válida. */
  validar(): string[];
  /** Papéis exigidos pela subárvore, consolidados por papel. */
  papeisExigidos(): PapelExigido[];
  /**
   * @param cobertos Papéis que já possuem profissional na equipe.
   * @returns Verdadeiro quando todos os serviços atômicos da subárvore estão cobertos.
   */
  avaliarCobertura(cobertos: ReadonlySet<Papel>): boolean;
  /** Forma serializável, para persistência em JSONB. */
  paraDados(): ServicoDados;
}

/** Folha do Composite: um serviço executado por um único papel técnico. */
export class ServicoAtomico implements ServicoProjeto {
  private readonly competencias: Competencia[];

  /**
   * @param nome Descrição do serviço, como "Mixagem de áudio".
   * @param papel Papel técnico responsável.
   * @param custo Custo estimado, em reais.
   * @param prazo Prazo, em dias corridos.
   * @param peso Importância do papel na escolha da equipe.
   * @param competencias Competências pedidas; padrão: o nome do papel.
   */
  constructor(readonly nome: string, readonly papel: Papel, private readonly custo: number, private readonly prazo: number,
    readonly peso = 1, competencias?: Competencia[]) {
    this.competencias = structuredClone(competencias ?? [{ nome: papel.toLowerCase(), nivel: 1 }]);
  }
  calcularCusto(): number { return this.custo; }
  listarSubservicos(): ServicoProjeto[] { return []; }
  obterPrazo(): number { return this.prazo; }
  validar(): string[] {
    const rotulo = `Serviço "${this.nome}"`;
    const erros: string[] = [];
    if (!this.nome.trim()) erros.push('Há serviço sem nome.');
    if (!(PAPEIS as readonly string[]).includes(this.papel)) erros.push(`${rotulo}: papel inválido (${String(this.papel)}).`);
    if (!Number.isFinite(this.custo) || this.custo < 0) erros.push(`${rotulo}: o custo deve ser um valor não negativo.`);
    if (!Number.isFinite(this.prazo) || this.prazo <= 0) erros.push(`${rotulo}: o prazo deve ser maior que zero.`);
    if (!Number.isFinite(this.peso) || this.peso <= 0) erros.push(`${rotulo}: o peso deve ser maior que zero.`);
    if (!this.competencias.length) erros.push(`${rotulo}: informe ao menos uma competência.`);
    if (this.competencias.some(c => !(c.nivel >= 0 && c.nivel <= 1))) erros.push(`${rotulo}: o nível das competências vai de 0 a 1.`);
    if (new Set(this.competencias.map(c => c.nome.trim().toLowerCase())).size !== this.competencias.length) erros.push(`${rotulo}: competências duplicadas.`);
    return erros;
  }
  papeisExigidos(): PapelExigido[] {
    return [{ papel: this.papel, peso: this.peso, competencias: structuredClone(this.competencias) }];
  }
  avaliarCobertura(cobertos: ReadonlySet<Papel>): boolean { return cobertos.has(this.papel); }
  paraDados(): ServicoAtomicoDados {
    return { tipo: 'atomico', nome: this.nome, papel: this.papel, custo: this.custo, prazo: this.prazo, peso: this.peso,
      competencias: structuredClone(this.competencias) };
  }
}

/** Composto do Composite: agrupa serviços atômicos e outros pacotes. */
export class PacoteServico implements ServicoProjeto {
  private readonly itens: ServicoProjeto[] = [];

  /**
   * @param nome Descrição do pacote, como "Pós-produção".
   * @param itens Serviços contidos, atômicos ou compostos.
   * @param paralelo Verdadeiro quando os itens correm ao mesmo tempo.
   */
  constructor(readonly nome: string, itens: ServicoProjeto[] = [], readonly paralelo = false) {
    for (const item of itens) this.adicionar(item);
  }
  /**
   * @throws ErroDominio Quando a inclusão criaria um ciclo na hierarquia.
   */
  adicionar(servico: ServicoProjeto): this {
    exigir(!contem(servico, this), `O pacote "${this.nome}" não pode conter a si mesmo.`);
    this.itens.push(servico);
    return this;
  }
  /** @returns Verdadeiro quando o serviço era um filho direto. */
  remover(servico: ServicoProjeto): boolean {
    const indice = this.itens.indexOf(servico);
    if (indice >= 0) this.itens.splice(indice, 1);
    return indice >= 0;
  }
  calcularCusto(): number {
    // Soma em centavos para não acumular erro de ponto flutuante.
    return this.itens.reduce((total, item) => total + centavos(item.calcularCusto()), 0) / 100;
  }
  listarSubservicos(): ServicoProjeto[] { return [...this.itens]; }
  obterPrazo(): number {
    const prazos = this.itens.map(item => item.obterPrazo());
    if (!prazos.length) return 0;
    return arredondar(this.paralelo ? Math.max(...prazos) : prazos.reduce((total, prazo) => total + prazo, 0));
  }
  validar(): string[] {
    const erros: string[] = [];
    if (!this.nome.trim()) erros.push('Há pacote sem nome.');
    if (!this.itens.length) erros.push(`Pacote "${this.nome}": informe ao menos um serviço.`);
    return [...erros, ...this.itens.flatMap(item => item.validar())];
  }
  papeisExigidos(): PapelExigido[] { return consolidarPapeis(this.itens.flatMap(item => item.papeisExigidos())); }
  avaliarCobertura(cobertos: ReadonlySet<Papel>): boolean { return this.itens.every(item => item.avaliarCobertura(cobertos)); }
  paraDados(): PacoteServicoDados {
    return { tipo: 'pacote', nome: this.nome, paralelo: this.paralelo, itens: this.itens.map(item => item.paraDados()) };
  }
}

/**
 * Reconstrói a hierarquia a partir da forma persistida.
 *
 * @throws ErroDominio Quando a árvore excede os limites de profundidade ou de nós.
 */
export function servicoDeDados(dados: ServicoDados): ServicoProjeto {
  let nos = 0;
  const montar = (d: ServicoDados, nivel: number): ServicoProjeto => {
    exigir(nivel <= LIMITES_SERVICOS.profundidade, `A árvore de serviços excede ${LIMITES_SERVICOS.profundidade} níveis.`);
    exigir(++nos <= LIMITES_SERVICOS.nos, `A árvore de serviços excede ${LIMITES_SERVICOS.nos} serviços.`);
    return d.tipo === 'pacote'
      ? new PacoteServico(d.nome, d.itens.map(item => montar(item, nivel + 1)), d.paralelo ?? false)
      : new ServicoAtomico(d.nome, d.papel, d.custo, d.prazo, d.peso, d.competencias);
  };
  return montar(dados, 1);
}
/**
 * Converte uma lista simples de papéis (contrato das atividades anteriores) em um
 * pacote paralelo, com o orçamento rateado pelos pesos e o prazo igual à janela.
 */
export function servicosDePapeis(p: Pick<ProjetoDados, 'papeis' | 'orcamento' | 'inicio' | 'prazo'>): PacoteServico {
  const custos = ratear(p.orcamento, p.papeis.map(x => x.peso));
  const janela = janelaDias(p.inicio, p.prazo);
  return new PacoteServico('Serviços do projeto', p.papeis.map((x, i) =>
    new ServicoAtomico(ROTULOS[x.papel], x.papel, custos[i]!, janela, x.peso, x.competencias)), true);
}
/**
 * Monta o pacote padrão de um tipo: etapas em sequência, papéis da etapa em paralelo.
 *
 * @param p Projeto com papéis, orçamento e datas definitivos.
 * @param fases Etapas do tipo; papéis sem etapa entram em "Serviços complementares".
 * @param nome Nome do pacote principal.
 */
export function servicosPorFases(p: Pick<ProjetoDados, 'papeis' | 'orcamento' | 'inicio' | 'prazo'>, fases: FaseServico[], nome: string): PacoteServico {
  const presentes = fases.map(f => ({ ...f, papeis: f.papeis.filter(papel => p.papeis.some(x => x.papel === papel)) })).filter(f => f.papeis.length);
  const semFase = p.papeis.filter(x => !fases.some(f => f.papeis.includes(x.papel))).map(x => x.papel);
  if (semFase.length) presentes.push({ nome: 'Serviços complementares', papeis: semFase, fracaoPrazo: 0.1 });
  // O rateio segue a ordem das etapas, e não a da lista recebida, para que o mesmo
  // projeto gere sempre o mesmo pacote (a reavaliação depende disso).
  const ordem = presentes.flatMap(f => f.papeis).map(papel => p.papeis.find(x => x.papel === papel)!);
  const custos = new Map(ordem.map((x, i) => [x.papel, ratear(p.orcamento, ordem.map(y => y.peso))[i]!]));
  const janela = janelaDias(p.inicio, p.prazo);
  const soma = presentes.reduce((total, f) => total + f.fracaoPrazo, 0);
  const raiz = new PacoteServico(nome);
  for (const fase of presentes) {
    const prazo = Math.floor(janela * fase.fracaoPrazo / soma * 100) / 100;
    raiz.adicionar(new PacoteServico(fase.nome, fase.papeis.map(papel => {
      const exigido = ordem.find(x => x.papel === papel)!;
      return new ServicoAtomico(ROTULOS[papel], papel, custos.get(papel)!, prazo, exigido.peso, exigido.competencias);
    }), true));
  }
  return raiz;
}
/** Violações da árvore de serviços do projeto, incluindo prazo maior que a janela. */
export function validarEstruturaServicos(p: ProjetoDados): string[] {
  if (!p.servicoPrincipal) return ['O projeto não possui serviço principal.'];
  const servico = servicoDeDados(p.servicoPrincipal);
  const erros = servico.validar();
  const janela = janelaDias(p.inicio, p.prazo), prazo = servico.obterPrazo();
  if (prazo > janela) erros.push(`Os serviços exigem ${prazo} dias, mas a janela do projeto tem ${janela} dias.`);
  return erros;
}
/** Resumo recursivo do nó e dos seus filhos. */
export function resumirServico(servico: ServicoProjeto, cobertos: ReadonlySet<Papel>): ResumoServico {
  const papel = servico.listarSubservicos().length ? undefined : servico.papeisExigidos()[0]?.papel;
  return { nome: servico.nome, ...(papel ? { papel } : {}), custo: servico.calcularCusto(), prazo: servico.obterPrazo(),
    coberto: servico.avaliarCobertura(cobertos), subservicos: servico.listarSubservicos().map(s => resumirServico(s, cobertos)) };
}
/** Dias corridos do projeto, contando o dia de início; no mínimo 1. */
export function janelaDias(inicio: string, prazo: string): number {
  const dias = Math.round((Date.parse(prazo) - Date.parse(inicio)) / 86_400_000) + 1;
  return Number.isFinite(dias) ? Math.max(1, dias) : 1;
}

function contem(raiz: ServicoProjeto, alvo: ServicoProjeto): boolean {
  return raiz === alvo || raiz.listarSubservicos().some(filho => contem(filho, alvo));
}
/** Une papéis repetidos: maior peso e maior nível de cada competência. */
function consolidarPapeis(lista: PapelExigido[]): PapelExigido[] {
  const porPapel = new Map<Papel, PapelExigido>();
  for (const atual of lista) {
    const anterior = porPapel.get(atual.papel);
    if (!anterior) { porPapel.set(atual.papel, structuredClone(atual)); continue; }
    anterior.peso = Math.max(anterior.peso, atual.peso);
    for (const c of atual.competencias) {
      const igual = anterior.competencias.find(x => x.nome.trim().toLowerCase() === c.nome.trim().toLowerCase());
      if (igual) igual.nivel = Math.max(igual.nivel, c.nivel);
      else anterior.competencias.push({ ...c });
    }
  }
  return [...porPapel.values()];
}
/** Divide o total pelos pesos, em centavos; os centavos restantes vão para os primeiros itens. */
function ratear(total: number, pesos: number[]): number[] {
  const soma = pesos.reduce((s, peso) => s + peso, 0);
  if (!(soma > 0)) return pesos.map(() => 0);
  const partes = pesos.map(peso => Math.floor(centavos(total) * peso / soma));
  const resto = centavos(total) - partes.reduce((s, parte) => s + parte, 0);
  for (let i = 0; i < resto; i++) partes[i % partes.length]!++;
  return partes.map(parte => parte / 100);
}
function arredondar(valor: number): number { return Math.round(valor * 100) / 100; }
