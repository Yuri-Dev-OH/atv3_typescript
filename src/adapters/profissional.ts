import { createHash } from 'node:crypto';
import { agora, ErroDominio, id, Profissional, validarProfissional, type Avaliacao, type Competencia, type Papel, type ProfissionalDados } from '../domain/model.js';
import type { AdaptadorProfissional, CriteriosProfissional, NovaAvaliacao, RepositorioProfissionais } from '../domain/ports.js';
import { ErroApiProfissional, IndeedSimulado, LinkedInSimulado, type ApiProfissionalExterna, type CurriculoIndeed, type PerfilLinkedIn } from '../infrastructure/externos/profissionais.js';

// Ordem importa: "diretora de fotografia" precisa casar antes de "diretor".
const PALAVRAS_PAPEL: [RegExp, Papel][] = [
  [/fotografia|cinematograf/, 'DIRETOR_FOTOGRAFIA'], [/vfx|efeitos|modelagem 3d/, 'EFEITOS_VISUAIS'],
  [/sonoplast|sound|audio|mixagem/, 'SONOPLASTA'], [/editor|editora|montador|montagem/, 'EDITOR'],
  [/roteir|screenwriter/, 'ROTEIRISTA'], [/diretor|diretora|director/, 'DIRETOR'],
];

/** Papel inferido do cargo declarado; indefinido quando o cargo não é técnico. */
export function inferirPapel(cargo: string): Papel | undefined {
  const texto = cargo.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return PALAVRAS_PAPEL.find(([padrao]) => padrao.test(texto))?.[1];
}
/**
 * UUID estável (formato da versão 5) para um perfil externo, de modo que
 * importações repetidas atualizem o mesmo cadastro em vez de duplicá-lo.
 */
export function uuidExterno(provedor: string, idExterno: string): string {
  const bytes = createHash('sha1').update(`cinebridge:${provedor}:${idExterno}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Base dos adaptadores de fontes externas: mantém a correspondência entre o UUID
 * do domínio e o identificador da fonte, descarta perfis que não se convertem
 * em um profissional válido e traduz "não encontrado" em 404.
 */
abstract class AdaptadorFonteExterna<T> implements AdaptadorProfissional {
  abstract readonly provedor: string;
  private readonly idsExternos = new Map<string, string>();
  protected constructor(protected readonly api: ApiProfissionalExterna) {}
  async listarProfissionais(criterios: CriteriosProfissional = {}): Promise<Profissional[]> {
    const perfis = await this.api.buscarProfissionais(this.filtros(criterios)) as T[];
    return perfis.map(perfil => this.converter(perfil)).filter((p): p is Profissional => p !== undefined)
      // Filtra também por papel, pois a busca da fonte é textual.
      .filter(p => !criterios.papel || p.dados.papeis.includes(criterios.papel));
  }
  async detalharProfissional(idDominio: string): Promise<Profissional> {
    const perfil = await this.traduzir(async () => this.api.obterPerfil(await this.idExterno(idDominio))) as T;
    const profissional = this.converter(perfil);
    if (!profissional) throw new ErroDominio('Perfil externo sem dados suficientes para o cadastro.', 422);
    return profissional;
  }
  async registrarAvaliacao(idDominio: string, avaliacao: NovaAvaliacao): Promise<void> {
    const externo = await this.idExterno(idDominio);
    await this.traduzir(() => this.api.avaliarProfissional(externo, this.converterNota(avaliacao.nota)));
  }
  /** Filtros no formato da fonte. */
  protected abstract filtros(criterios: CriteriosProfissional): Record<string, unknown>;
  protected abstract idDoPerfil(perfil: T): string;
  /** Dados do domínio montados a partir do perfil; indefinido quando o perfil não tem papel técnico. */
  protected abstract dados(perfil: T, id: string): ProfissionalDados | undefined;
  /** Nota de 1 a 5 do domínio convertida para a escala da fonte. */
  protected abstract converterNota(nota: number): number;
  private converter(perfil: T): Profissional | undefined {
    const externo = this.idDoPerfil(perfil), idDominio = uuidExterno(this.provedor, externo);
    this.idsExternos.set(idDominio, externo);
    const dados = this.dados(perfil, idDominio);
    if (!dados) return undefined;
    try { validarProfissional(dados); } catch { return undefined; }
    return new Profissional(dados);
  }
  private async idExterno(idDominio: string): Promise<string> {
    if (!this.idsExternos.has(idDominio)) await this.listarProfissionais();
    const externo = this.idsExternos.get(idDominio);
    if (!externo) throw new ErroDominio(`Profissional não encontrado na fonte ${this.provedor}.`, 404);
    return externo;
  }
  private async traduzir<R>(chamada: () => Promise<R>): Promise<R> {
    try { return await chamada(); }
    catch (erro) {
      if (erro instanceof ErroApiProfissional && erro.status === 404) throw new ErroDominio(`Profissional não encontrado na fonte ${this.provedor}.`, 404);
      if (erro instanceof ErroApiProfissional && erro.status === 400) throw new ErroDominio(erro.message, 422);
      throw erro;
    }
  }
}

/** Adapter para o LinkedIn: endossos viram nível de competência e recomendações viram avaliações. */
export class AdaptadorLinkedIn extends AdaptadorFonteExterna<PerfilLinkedIn> {
  readonly provedor = 'linkedin';
  constructor(api: LinkedInSimulado = new LinkedInSimulado()) { super(api); }
  protected filtros(c: CriteriosProfissional) { return { title: undefined, city: c.localizacao, remote: c.remoto }; }
  protected idDoPerfil(perfil: PerfilLinkedIn): string { return perfil.id; }
  protected dados(perfil: PerfilLinkedIn, idDominio: string): ProfissionalDados | undefined {
    const papel = inferirPapel(perfil.headline);
    if (!papel) return undefined;
    return {
      id: idDominio, nome: `${perfil.firstName} ${perfil.lastName}`, email: perfil.emailAddress, papeis: [papel],
      competencias: unirCompetencias(papel, perfil.skills.map(s => ({ nome: s.name.toLowerCase(), nivel: Math.max(0.1, Math.min(1, s.endorsements / 50)) }))),
      preco: dinheiro(perfil.rate.amount), faixaPreco: { minimo: dinheiro(perfil.rate.minimum), maximo: dinheiro(perfil.rate.maximum) },
      disponibilidade: { inicio: perfil.availability.from, fim: perfil.availability.to }, localizacao: perfil.location.city, remoto: perfil.openToRemote,
      historico: [], avaliacoes: unicasPorProdutor(perfil.recommendations.map(r => ({ produtorId: `linkedin:${r.author}`, nota: r.rating, comentario: r.text, data: r.date }))),
    };
  }
  // A escala do LinkedIn também vai de 1 a 5, mas só aceita inteiros.
  protected converterNota(nota: number): number { return Math.round(nota); }
}

/** Adapter para o Indeed: habilidades viram competências e a média de 0 a 10 vira uma avaliação de 1 a 5. */
export class AdaptadorIndeed extends AdaptadorFonteExterna<CurriculoIndeed> {
  readonly provedor = 'indeed';
  constructor(api: IndeedSimulado = new IndeedSimulado()) { super(api); }
  protected filtros(c: CriteriosProfissional) { return { cargo: undefined, cidade: c.localizacao, remoto: c.remoto }; }
  protected idDoPerfil(curriculo: CurriculoIndeed): string { return curriculo.candidato_id; }
  protected dados(c: CurriculoIndeed, idDominio: string): ProfissionalDados | undefined {
    const papel = inferirPapel(c.cargo);
    if (!papel) return undefined;
    return {
      id: idDominio, nome: c.nome_completo, email: c.email, papeis: [papel],
      competencias: unirCompetencias(papel, c.habilidades.map(h => ({ nome: h.toLowerCase(), nivel: 0.8 }))),
      preco: dinheiro(c.pretensao), faixaPreco: { minimo: dinheiro(c.pretensao), maximo: dinheiro(c.pretensao) },
      disponibilidade: { inicio: c.disponivel_de, fim: c.disponivel_ate }, localizacao: c.cidade, remoto: c.aceita_remoto, historico: [],
      avaliacoes: c.total_avaliacoes ? [{ produtorId: 'indeed', nota: Math.min(5, Math.max(1, Math.round(c.nota_media / 2 * 10) / 10)),
        comentario: `Média de ${c.total_avaliacoes} avaliações no Indeed.`, data: c.atualizado_em }] : [],
    };
  }
  protected converterNota(nota: number): number { return nota * 2; }
}

/**
 * Adapter para o cadastro interno (PostgreSQL ou serviço de catálogo): expõe o
 * repositório existente pela mesma interface das fontes externas.
 */
export class AdaptadorInterno implements AdaptadorProfissional {
  readonly provedor = 'interno';
  constructor(private readonly repo: RepositorioProfissionais) {}
  async listarProfissionais(criterios: CriteriosProfissional = {}): Promise<Profissional[]> {
    const local = criterios.localizacao?.trim().toLowerCase();
    return (await this.repo.listarProfissionais())
      .filter(p => (!criterios.papel || p.papeis.includes(criterios.papel)) && (!local || p.localizacao.trim().toLowerCase() === local)
        && (criterios.remoto === undefined || p.remoto === criterios.remoto))
      .map(p => new Profissional(p));
  }
  async detalharProfissional(idProfissional: string): Promise<Profissional> {
    const dados = (await this.repo.listarProfissionais()).find(p => p.id === idProfissional);
    if (!dados) throw new ErroDominio('Profissional não encontrado.', 404);
    return new Profissional(dados);
  }
  async registrarAvaliacao(idProfissional: string, avaliacao: NovaAvaliacao): Promise<void> {
    const { dados } = await this.detalharProfissional(idProfissional);
    // Uma avaliação por produtor: a nova substitui a anterior do mesmo produtor.
    const atualizado: ProfissionalDados = { ...dados, avaliacoes: [...dados.avaliacoes.filter(a => a.produtorId !== avaliacao.produtorId),
      { produtorId: avaliacao.produtorId, nota: avaliacao.nota, comentario: avaliacao.comentario, data: agora().slice(0, 10) }] };
    validarProfissional(atualizado);
    await this.repo.salvarProfissional(atualizado, { id: id(), tipo: 'PROFISSIONAL_AVALIADO', projetoId: '', origem: avaliacao.produtorId, data: agora(),
      dados: { profissionalId: idProfissional, nota: avaliacao.nota }, destinatarios: [], entregues: [] });
  }
}

/** Garante a competência com o nome do papel, que é a usada pelos papéis exigidos nos projetos. */
function unirCompetencias(papel: Papel, competencias: Competencia[]): Competencia[] {
  const unicas = new Map<string, Competencia>([[papel.toLowerCase(), { nome: papel.toLowerCase(), nivel: 1 }]]);
  for (const c of competencias) if (!unicas.has(c.nome.trim())) unicas.set(c.nome.trim(), { nome: c.nome.trim(), nivel: c.nivel });
  return [...unicas.values()];
}
function unicasPorProdutor(avaliacoes: Avaliacao[]): Avaliacao[] {
  return [...new Map(avaliacoes.map(a => [a.produtorId, a])).values()];
}
function dinheiro(valor: number): number { return Math.round(valor * 100) / 100; }
