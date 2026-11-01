import type { Candidato, Competencia, Papel, ProfissionalDados, ProjetoDados } from '../domain/model.js';

export interface RecomendacaoStrategy {
  recomendar(projeto: ProjetoDados, profissionais: ProfissionalDados[]): Map<Papel, Candidato[]>;
}
export function cosseno(a: Competencia[], b: Competencia[]): number {
  let produto = 0, normaA = 0, normaB = 0;
  // Vetores pequenos dispensam a alocação de um Map para cada candidato.
  if (a.length * b.length <= 64) {
    for (const c of a) {
      normaA += c.nivel ** 2;
      const nome = c.nome.trim().toLowerCase();
      for (const outro of b) {
        if (outro.nome.trim().toLowerCase() === nome) { produto += c.nivel * outro.nivel; break; }
      }
    }
    for (const c of b) normaB += c.nivel ** 2;
  } else {
    const vetor = new Map<string, number>();
    for (const c of b) { vetor.set(c.nome.trim().toLowerCase(), c.nivel); normaB += c.nivel ** 2; }
    for (const c of a) { normaA += c.nivel ** 2; produto += c.nivel * (vetor.get(c.nome.trim().toLowerCase()) ?? 0); }
  }
  const norma = Math.sqrt(normaA * normaB);
  return norma ? produto / norma : 0;
}
export function mediaAvaliacoes(p: ProfissionalDados): number {
  return p.avaliacoes.length ? p.avaliacoes.reduce((s, a) => s + a.nota, 0) / p.avaliacoes.length / 5 : 0.5;
}
/** Pontuação, entre 0 e 1, de um profissional para as competências de um papel. */
export type Pontuador = (prof: ProfissionalDados, competencias: Competencia[]) => number;
/**
 * Lógica principal de recomendação da atividade 1 (Template Method): filtra por
 * papel, pontua, aplica a nota mínima e ordena. As estratégias concretas só
 * definem como pontuar.
 */
export abstract class RecomendadorBase implements RecomendacaoStrategy {
  recomendar(p: ProjetoDados, profissionais: ProfissionalDados[]): Map<Papel, Candidato[]> {
    const pontuar = this.criarPontuador(p, profissionais);
    return new Map(p.papeis.map(papel => [papel.papel, profissionais
      .filter(prof => prof.papeis.includes(papel.papel))
      .map(prof => ({ profissionalId: prof.id, nome: prof.nome, preco: prof.preco, pontuacao: Math.max(0, Math.min(1, pontuar(prof, papel.competencias))) }))
      .filter(c => c.pontuacao >= p.parametros.notaMinima)
      .sort(compararCandidatos)]));
  }
  /**
   * @param p Projeto avaliado.
   * @param profissionais Candidatos já normalizados pelo orquestrador.
   * @returns Função de pontuação, que pode reaproveitar cálculos prévios sobre a lista.
   */
  protected abstract criarPontuador(p: ProjetoDados, profissionais: ProfissionalDados[]): Pontuador;
}
/**
 * Base do padrão Decorator: implementa a mesma interface e delega ao recomendador
 * envolvido. Subclasses acrescentam uma única preocupação antes ou depois da delegação.
 */
export abstract class DecoradorRecomendacao implements RecomendacaoStrategy {
  /** @param interno Recomendador envolvido, que pode ser outro decorador. */
  constructor(protected readonly interno: RecomendacaoStrategy) {}
  recomendar(p: ProjetoDados, profissionais: ProfissionalDados[]): Map<Papel, Candidato[]> {
    return this.interno.recomendar(p, profissionais);
  }
  /** Cadeia de classes até o recomendador base, por exemplo "CacheDecorator > SimilaridadeCosseno". */
  descrever(): string { return `${this.constructor.name} > ${descreverRecomendador(this.interno)}`; }
}
/** Nome do recomendador e, quando decorado, de toda a cadeia de decoradores. */
export function descreverRecomendador(recomendador: RecomendacaoStrategy): string {
  return recomendador instanceof DecoradorRecomendacao ? recomendador.descrever() : recomendador.constructor.name;
}
/** Maior pontuação primeiro; empates pelo menor preço e, por fim, pelo id. */
export function compararCandidatos(a: Candidato, b: Candidato): number {
  return b.pontuacao - a.pontuacao || a.preco - b.preco || (a.profissionalId < b.profissionalId ? -1 : a.profissionalId > b.profissionalId ? 1 : 0);
}
/**
 * Decorador de estratégia usado pelas fábricas: combina a pontuação da estratégia
 * escolhida com a afinidade às competências prioritárias do tipo de projeto.
 */
export class RecomendadorPriorizado extends DecoradorRecomendacao {
  /**
   * @param base Estratégia escolhida pelo produtor.
   * @param prioridades Competências valorizadas pelo tipo (por exemplo, modelagem 3D).
   * @param peso Fração da pontuação final dada à afinidade, entre 0 e 1.
   */
  constructor(base: RecomendacaoStrategy, private readonly prioridades: Competencia[], private readonly peso = 0.3) { super(base); }
  override recomendar(p: ProjetoDados, profissionais: ProfissionalDados[]): Map<Papel, Candidato[]> {
    const ranking = super.recomendar(p, profissionais);
    const competencias = new Map(profissionais.map(prof => [prof.id, prof.competencias]));
    for (const [papel, candidatos] of ranking) {
      ranking.set(papel, candidatos.map(c => ({ ...c,
        pontuacao: (1 - this.peso) * c.pontuacao + this.peso * cosseno(this.prioridades, competencias.get(c.profissionalId) ?? []) }))
        .sort(compararCandidatos));
    }
    return ranking;
  }
}
export class SimilaridadeCosseno extends RecomendadorBase {
  protected criarPontuador(p: ProjetoDados): Pontuador {
    const { pesoTecnico: t, pesoHistorico: h } = p.parametros;
    return (prof, competencias) => {
      const experiencia = prof.historico.some(trabalho => trabalho.genero === p.genero) ? 1 : 0;
      return (t * cosseno(competencias, prof.competencias) + h * (mediaAvaliacoes(prof) * 0.8 + experiencia * 0.2)) / (t + h);
    };
  }
}
export class FiltragemColaborativa extends RecomendadorBase {
  protected criarPontuador(p: ProjetoDados, profissionais: ProfissionalDados[]): Pontuador {
    // Correlação por cosseno entre produtores que avaliaram os mesmos profissionais.
    const sobreposicao = new Map<string, { produto: number; a: number; b: number; n: number }>();
    for (const prof of profissionais) {
      const nota = prof.avaliacoes.find(a => a.produtorId === p.produtorId)?.nota;
      if (nota === undefined) continue;
      for (const a of prof.avaliacoes) {
        if (a.produtorId === p.produtorId) continue;
        const s = sobreposicao.get(a.produtorId) ?? { produto: 0, a: 0, b: 0, n: 0 };
        s.produto += nota * a.nota; s.a += nota ** 2; s.b += a.nota ** 2; s.n++;
        sobreposicao.set(a.produtorId, s);
      }
    }
    const similaridades = new Map([...sobreposicao].map(([usuario, s]) => [usuario, s.produto / Math.sqrt(s.a * s.b) * Math.min(1, s.n / 3)]));
    return prof => {
      let soma = 0, pesos = 0;
      for (const a of prof.avaliacoes) {
        const peso = similaridades.get(a.produtorId) ?? 0;
        soma += peso * a.nota / 5; pesos += peso;
      }
      return pesos ? soma / pesos : mediaAvaliacoes(prof);
    };
  }
}
export class RegrasOrcamento extends RecomendadorBase {
  protected criarPontuador(p: ProjetoDados): Pontuador {
    const { pesoTecnico: t, pesoHistorico: h } = p.parametros;
    return (prof, competencias) => {
      const qualidade = (t * cosseno(competencias, prof.competencias) + h * mediaAvaliacoes(prof)) / (t + h);
      const economia = 1 / (1 + prof.preco / Math.max(0.01, p.orcamento / p.papeis.length));
      return qualidade * 0.3 + economia * 0.7;
    };
  }
}
export const estrategias: Record<ProjetoDados['estrategia'], RecomendacaoStrategy> = {
  cosseno: new SimilaridadeCosseno(), colaborativa: new FiltragemColaborativa(), orcamento: new RegrasOrcamento(),
};
