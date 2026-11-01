import { centavos, exigir, validarProjeto, type Candidato, type MembroEquipe, type Papel, type ProfissionalDados, type ProjetoDados } from '../domain/model.js';
import type { FabricaProjeto } from '../domain/fabricas.js';
import type { RecomendacaoStrategy } from './strategies.js';

export interface Composicao { membros: MembroEquipe[]; ranking: Map<Papel, Candidato[]>; faltantes: Papel[] }
/** Ajustes do recomendador definidos em tempo de execução, sem alterar o orquestrador. */
export interface ConfiguracaoRecomendador {
  /** Estratégia fixada pelo sistema; ausente, vale a estratégia escolhida no projeto. */
  estrategia?(): RecomendacaoStrategy | undefined;
  /** Envolve o recomendador da fábrica com a pilha de decoradores (Decorator). */
  decorar?(recomendador: RecomendacaoStrategy, projeto: ProjetoDados): RecomendacaoStrategy;
}
export abstract class OrquestradorEquipe {
  // Propriedade não gravável: as subclasses implementam apenas as etapas do fluxo.
  readonly orquestrar: (p: ProjetoDados, profissionais: ProfissionalDados[], fixos?: MembroEquipe[], excluidos?: Partial<Record<Papel, string[]>>) => Composicao;
  /**
   * @param fabrica Fábrica do tipo de projeto. Fornece o validador e o recomendador,
   *     de modo que um novo tipo não exige alterações no orquestrador.
   * @param configuracao Estratégia fixa e pilha de decoradores, consultadas a cada orquestração.
   */
  constructor(protected readonly fabrica: FabricaProjeto, protected readonly configuracao: ConfiguracaoRecomendador = {}) {
    this.orquestrar = (p, profissionais, fixos = [], excluidos = {}) => {
      this.validarRestricoes(p, fixos);
      const normalizados = this.normalizarDados(p, profissionais);
      const base = this.fabrica.criarRecomendador(this.configuracao.estrategia?.() ?? p.estrategia);
      const recomendador = this.configuracao.decorar?.(base, p) ?? base;
      const ranking = recomendador.recomendar(p, normalizados);
      for (const [papel, candidatos] of ranking) ranking.set(papel, candidatos.filter(c => !excluidos[papel]?.includes(c.profissionalId)));
      return this.posProcessar(p, ranking, fixos);
    };
    Object.defineProperty(this, 'orquestrar', { writable: false, configurable: false });
  }
  protected abstract validarRestricoes(p: ProjetoDados, fixos: MembroEquipe[]): void;
  protected abstract normalizarDados(p: ProjetoDados, profissionais: ProfissionalDados[]): ProfissionalDados[];
  protected abstract posProcessar(p: ProjetoDados, ranking: Map<Papel, Candidato[]>, fixos: MembroEquipe[]): Composicao;
}
export class OrquestradorPadrao extends OrquestradorEquipe {
  protected validarRestricoes(p: ProjetoDados, fixos: MembroEquipe[]): void {
    validarProjeto(p);
    const violacoes = this.fabrica.criarValidador().validar(p);
    exigir(!violacoes.length, violacoes.join(' '));
    exigir(fixos.reduce((s, m) => s + centavos(m.preco), 0) <= centavos(p.orcamento), 'Os membros fixos excedem o orçamento.');
  }
  protected normalizarDados(p: ProjetoDados, profissionais: ProfissionalDados[]): ProfissionalDados[] {
    const localizacao = p.localizacao.trim().toLowerCase();
    const orcamento = centavos(p.orcamento);
    return profissionais.filter(prof => prof.disponibilidade.inicio <= p.inicio && prof.disponibilidade.fim >= p.prazo
      && (prof.remoto || prof.localizacao.trim().toLowerCase() === localizacao)
      && centavos(prof.preco) <= orcamento);
  }
  protected posProcessar(p: ProjetoDados, ranking: Map<Papel, Candidato[]>, fixos: MembroEquipe[]): Composicao {
    type Opcao = { membros: MembroEquipe[]; custo: number; nota: number };
    const pesos = new Map(p.papeis.map(x => [x.papel, x.peso]));
    let opcoes: Opcao[] = [{ membros: [...fixos], custo: fixos.reduce((s, m) => s + centavos(m.preco), 0), nota: 0 }];
    const livres = p.papeis.filter(x => !fixos.some(m => m.papel === x.papel));
    // Se os melhores candidatos independentes cabem e não se repetem, já temos
    // a maior pontuação possível. A busca combinatória não pode melhorar isso.
    const fixados = new Set(fixos.map(m => m.profissionalId));
    const melhores = livres.map(papel => {
      const c = ranking.get(papel.papel)?.find(c => !fixados.has(c.profissionalId));
      return c && { ...c, papel: papel.papel, confirmado: false, aceitoProdutor: false };
    });
    if (melhores.every((m): m is MembroEquipe => m !== undefined)
      && new Set(melhores.map(m => m.profissionalId)).size === melhores.length
      && custoTotal([...fixos, ...melhores]) <= centavos(p.orcamento)) {
      return { membros: [...fixos, ...melhores], ranking, faltantes: [] };
    }
    const custoFixo = opcoes[0]!.custo;
    // Com no máximo seis papéis, o matching de menor custo cabe em 2^6 estados.
    // Os k mais baratos de cada papel bastam: só k-1 podem estar em outros papéis.
    const baratosPorPapel = livres.map(papel => (ranking.get(papel.papel) ?? [])
      .filter(c => !fixos.some(m => m.profissionalId === c.profissionalId))
      .sort((a, b) => a.preco - b.preco).slice(0, livres.length));
    const idsBaratos = new Set(baratosPorPapel.flat().map(c => c.profissionalId));
    const minimos: (Opcao | undefined)[] = new Array(1 << livres.length);
    minimos[0] = { membros: [...fixos], custo: custoFixo, nota: 0 };
    for (const profissionalId of idsBaratos) {
      for (let mask = minimos.length - 1; mask >= 0; mask--) {
        const anterior = minimos[mask];
        if (!anterior) continue;
        for (let i = 0; i < livres.length; i++) {
          if (mask & (1 << i)) continue;
          const c = baratosPorPapel[i]!.find(candidato => candidato.profissionalId === profissionalId);
          if (!c) continue;
          const custo = anterior.custo + centavos(c.preco), proximo = mask | (1 << i);
          if (custo > centavos(p.orcamento) || custo >= (minimos[proximo]?.custo ?? Infinity)) continue;
          const papel = livres[i]!;
          minimos[proximo] = { membros: [...anterior.membros, { ...c, papel: papel.papel, confirmado: false, aceitoProdutor: false }], custo, nota: anterior.nota + c.pontuacao * papel.peso };
        }
      }
    }
    // Busca limitada mantém alternativas baratas e evita gastar todo o orçamento no primeiro papel.
    for (const papel of livres) {
      const lista = ranking.get(papel.papel) ?? [];
      const baratos = [...lista].sort((a, b) => a.preco - b.preco).slice(0, 12);
      const candidatos = [...new Map([...lista.slice(0, 12), ...baratos].map(c => [c.profissionalId, c])).values()];
      const proximas: Opcao[] = [];
      for (const opcao of opcoes) {
        proximas.push(opcao);
        for (const c of candidatos) {
          if (opcao.membros.some(m => m.profissionalId === c.profissionalId) || opcao.custo + centavos(c.preco) > centavos(p.orcamento)) continue;
          proximas.push({ membros: [...opcao.membros, { ...c, papel: papel.papel, confirmado: false, aceitoProdutor: false }], custo: opcao.custo + centavos(c.preco), nota: opcao.nota + c.pontuacao * (pesos.get(papel.papel) ?? 1) });
        }
      }
      const comparar = (a: Opcao, b: Opcao) => b.membros.length - a.membros.length || b.nota - a.nota || a.custo - b.custo;
      proximas.sort(comparar);
      const economicas = [...proximas].sort((a, b) => b.membros.length - a.membros.length || a.custo - b.custo).slice(0, 16);
      opcoes = [...proximas.slice(0, 48), ...economicas];
    }
    opcoes.push(...minimos.filter((opcao): opcao is Opcao => opcao !== undefined));
    opcoes.sort((a, b) => b.membros.length - a.membros.length || b.nota - a.nota || a.custo - b.custo);
    const membros = opcoes[0]!.membros;
    return { membros, ranking, faltantes: p.papeis.filter(x => !membros.some(m => m.papel === x.papel)).map(x => x.papel) };
  }
}

function custoTotal(membros: MembroEquipe[]): number {
  return membros.reduce((total, membro) => total + centavos(membro.preco), 0);
}
