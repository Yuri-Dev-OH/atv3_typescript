import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { gunzipSync, gzipSync } from 'node:zlib';
import { agora, DECORADORES, exigir, type Candidato, type Estrategia, type NomeDecorador, type Papel, type ProfissionalDados, type ProjetoDados, type TipoProjeto } from '../domain/model.js';
import type { Logger } from '../domain/ports.js';
import { DecoradorRecomendacao, descreverRecomendador, type RecomendacaoStrategy } from './strategies.js';

type Ranking = Map<Papel, Candidato[]>;

/**
 * Armazenamento compartilhado do CacheDecorator.
 *
 * Fica fora do decorador porque o orquestrador monta uma pilha nova a cada
 * solicitação; um cache interno ao decorador nunca seria reaproveitado.
 */
export class ArmazemCacheRecomendacao {
  private readonly entradas = new Map<string, { expiraEm: number; ranking: Ranking }>();
  private acertos = 0;
  private falhas = 0;

  /**
   * @param capacidade Número máximo de entradas; a menos usada recentemente sai primeiro.
   * @param ttlMs Validade de cada entrada, em milissegundos.
   * @param relogio Fonte de tempo, substituível em testes.
   */
  constructor(readonly capacidade = 200, readonly ttlMs = 60_000, private readonly relogio: () => number = Date.now) {}
  /** @returns Cópia do ranking guardado, ou indefinido quando ausente ou expirado. */
  obter(chave: string): Ranking | undefined {
    const entrada = this.entradas.get(chave);
    if (!entrada || entrada.expiraEm <= this.relogio()) {
      this.entradas.delete(chave);
      this.falhas++;
      return undefined;
    }
    // Reinsere para manter a ordem de uso (LRU).
    this.entradas.delete(chave);
    this.entradas.set(chave, entrada);
    this.acertos++;
    return copiarRanking(entrada.ranking);
  }
  /**
   * Guarda uma cópia das listas. Os candidatos são congelados em vez de copiados:
   * nenhum consumidor os altera, e copiar 10 mil objetos a cada falha custaria caro.
   */
  guardar(chave: string, ranking: Ranking): void {
    for (const candidatos of ranking.values()) for (const candidato of candidatos) Object.freeze(candidato);
    this.entradas.delete(chave);
    this.entradas.set(chave, { expiraEm: this.relogio() + this.ttlMs, ranking: copiarRanking(ranking) });
    while (this.entradas.size > this.capacidade) this.entradas.delete(this.entradas.keys().next().value!);
  }
  limpar(): void { this.entradas.clear(); }
  metricas() {
    return { entradas: this.entradas.size, acertos: this.acertos, falhas: this.falhas, capacidade: this.capacidade, ttlMs: this.ttlMs };
  }
}

/** Uma chamada ao recomendador, como registrada pelo AuditoriaDecorator. */
export interface ChamadaRecomendacao {
  projetoId: string;
  tipo: TipoProjeto;
  estrategia: Estrategia;
  /** Cadeia envolvida pelo auditor, por exemplo "CacheDecorator > SimilaridadeCosseno". */
  recomendador: string;
  profissionais: number;
  candidatos: number;
  duracaoMs: number;
  sucesso: boolean;
  erro?: string;
  data: string;
}
/** Registro em memória, de tamanho limitado, das chamadas auditadas. */
export class RegistroAuditoriaRecomendacao {
  private readonly chamadas: ChamadaRecomendacao[] = [];
  private totalChamadas = 0;

  /** @param capacidade Quantidade de chamadas mais recentes mantidas. */
  constructor(readonly capacidade = 1000) {}
  get total(): number { return this.totalChamadas; }
  registrar(chamada: ChamadaRecomendacao): void {
    this.totalChamadas++;
    this.chamadas.push(chamada);
    if (this.chamadas.length > this.capacidade) this.chamadas.shift();
  }
  listar(): ChamadaRecomendacao[] { return structuredClone(this.chamadas); }
}

/** Acumula o efeito do CompressaoDecorator. */
export class MedidorCompressao {
  private chamadas = 0;
  private bytesOriginais = 0;
  private bytesComprimidos = 0;
  private ultimaCarga?: { original: number; comprimido: number };

  registrar(original: number, comprimido: number): void {
    this.chamadas++;
    this.bytesOriginais += original;
    this.bytesComprimidos += comprimido;
    this.ultimaCarga = { original, comprimido };
  }
  get ultima(): { original: number; comprimido: number } | undefined { return this.ultimaCarga && { ...this.ultimaCarga }; }
  metricas() {
    return { chamadas: this.chamadas, bytesOriginais: this.bytesOriginais, bytesComprimidos: this.bytesComprimidos,
      reducao: this.bytesOriginais ? Number((1 - this.bytesComprimidos / this.bytesOriginais).toFixed(4)) : 0, ultima: this.ultima };
  }
}

/**
 * Decorator de cache: reaproveita o ranking de projetos com os mesmos requisitos
 * e a mesma lista de candidatos.
 *
 * A lista de candidatos entra na chave pela identidade de cada objeto, o que é
 * barato mesmo com 10 mil profissionais. O catálogo cria objetos novos a cada
 * recarga, então uma alteração de cadastro sempre gera chave nova.
 */
export class CacheDecorator extends DecoradorRecomendacao {
  constructor(interno: RecomendacaoStrategy, private readonly armazem = new ArmazemCacheRecomendacao()) { super(interno); }
  override recomendar(p: ProjetoDados, profissionais: ProfissionalDados[]): Ranking {
    const chave = this.chave(p, profissionais);
    const salvo = this.armazem.obter(chave);
    if (salvo) return salvo;
    const ranking = super.recomendar(p, profissionais);
    this.armazem.guardar(chave, ranking);
    return ranking;
  }
  private chave(p: ProjetoDados, profissionais: ProfissionalDados[]): string {
    // Identificação e preferências não alteram o ranking; o restante do projeto, sim.
    const { id: _id, titulo: _titulo, emailProdutor: _email, decoradores: _decoradores, ...requisitos } = p;
    const identidades = new Uint32Array(profissionais.length);
    for (let i = 0; i < profissionais.length; i++) identidades[i] = identidade(profissionais[i]!);
    return createHash('sha256').update(descreverRecomendador(this.interno)).update('\n').update(serializarOrdenado(requisitos)).update('\n')
      .update(new Uint8Array(identidades.buffer)).digest('base64url');
  }
}

/**
 * Decorator de auditoria: registra cada chamada, o resultado e o tempo de resposta
 * do recomendador envolvido. Falhas são registradas e propagadas.
 */
export class AuditoriaDecorator extends DecoradorRecomendacao {
  constructor(interno: RecomendacaoStrategy, private readonly registro = new RegistroAuditoriaRecomendacao(), private readonly logger?: Logger) {
    super(interno);
  }
  override recomendar(p: ProjetoDados, profissionais: ProfissionalDados[]): Ranking {
    const inicio = performance.now();
    const base = { projetoId: p.id, tipo: p.tipoCaptacao, estrategia: p.estrategia, recomendador: descreverRecomendador(this.interno),
      profissionais: profissionais.length, data: agora() };
    try {
      const ranking = super.recomendar(p, profissionais);
      const chamada: ChamadaRecomendacao = { ...base, candidatos: [...ranking.values()].reduce((total, lista) => total + lista.length, 0),
        duracaoMs: duracao(inicio), sucesso: true };
      this.registro.registrar(chamada);
      this.logger?.info(chamada, 'Recomendação auditada');
      return ranking;
    } catch (erro) {
      const chamada: ChamadaRecomendacao = { ...base, candidatos: 0, duracaoMs: duracao(inicio), sucesso: false,
        erro: erro instanceof Error ? erro.message : String(erro) };
      this.registro.registrar(chamada);
      this.logger?.error(chamada, 'Falha na recomendação');
      throw erro;
    }
  }
}

/**
 * Decorator de compressão: serializa o ranking e o comprime com gzip, como seria
 * transmitido pela rede, e devolve o conteúdo descomprimido. Assim, a interface
 * RecomendacaoStrategy não muda e o resultado comprova que não há perda.
 *
 * Dentro de um mesmo processo não há tráfego a economizar; o ganho medido vale
 * quando a carga atravessa a rede.
 */
export class CompressaoDecorator extends DecoradorRecomendacao {
  /** @param nivel Nível do gzip, de 1 (rápido) a 9 (menor carga). */
  constructor(interno: RecomendacaoStrategy, private readonly medidor = new MedidorCompressao(), private readonly nivel = 6) { super(interno); }
  override recomendar(p: ProjetoDados, profissionais: ProfissionalDados[]): Ranking {
    const json = JSON.stringify([...super.recomendar(p, profissionais)]);
    const carga = CompressaoDecorator.comprimir(json, this.nivel);
    this.medidor.registrar(Buffer.byteLength(json), carga.length);
    return CompressaoDecorator.descomprimir(carga);
  }
  static comprimir(json: string, nivel = 6): Buffer { return gzipSync(json, { level: nivel }); }
  static descomprimir(carga: Buffer): Ranking { return new Map(JSON.parse(gunzipSync(carga).toString('utf8')) as [Papel, Candidato[]][]); }
}

/** Política padrão quando nenhuma é configurada. A compressão fica opcional por custar CPU a cada chamada. */
export const POLITICA_PADRAO: readonly NomeDecorador[] = ['cache', 'auditoria'];

/**
 * Monta a pilha de decoradores em tempo de execução.
 *
 * A ordem da lista é a ordem de aplicação, de dentro para fora: em
 * ["cache", "auditoria", "compressao"], o cache envolve o recomendador base, a
 * auditoria envolve o cache e a compressão envolve a auditoria.
 */
export class MontadorPilhaRecomendacao {
  readonly cache: ArmazemCacheRecomendacao;
  readonly auditoria: RegistroAuditoriaRecomendacao;
  readonly compressao: MedidorCompressao;
  private politicaAtual: NomeDecorador[];
  private readonly construtores: Record<NomeDecorador, (interno: RecomendacaoStrategy) => RecomendacaoStrategy>;

  /**
   * @param opcoes.politica Pilha usada quando o produtor não declara preferência.
   * @param opcoes.logger Destino dos registros de auditoria.
   */
  constructor(opcoes: { politica?: readonly NomeDecorador[]; cache?: ArmazemCacheRecomendacao; auditoria?: RegistroAuditoriaRecomendacao;
    compressao?: MedidorCompressao; logger?: Logger } = {}) {
    this.politicaAtual = validarPilha(opcoes.politica ?? []);
    this.cache = opcoes.cache ?? new ArmazemCacheRecomendacao();
    this.auditoria = opcoes.auditoria ?? new RegistroAuditoriaRecomendacao();
    this.compressao = opcoes.compressao ?? new MedidorCompressao();
    this.construtores = {
      cache: interno => new CacheDecorator(interno, this.cache),
      auditoria: interno => new AuditoriaDecorator(interno, this.auditoria, opcoes.logger),
      compressao: interno => new CompressaoDecorator(interno, this.compressao),
    };
  }
  get politica(): NomeDecorador[] { return [...this.politicaAtual]; }
  /** Troca a política do sistema sem reiniciar o serviço. */
  definirPolitica(politica: readonly NomeDecorador[]): void { this.politicaAtual = validarPilha(politica); }
  /**
   * @param base Recomendador a decorar.
   * @param preferencia Pilha preferida pelo produtor; ausente, vale a política do sistema.
   * @throws ErroDominio Quando a pilha tem decorador desconhecido ou repetido.
   */
  montar(base: RecomendacaoStrategy, preferencia?: readonly NomeDecorador[]): RecomendacaoStrategy {
    return validarPilha(preferencia ?? this.politicaAtual).reduce((recomendador, nome) => this.construtores[nome](recomendador), base);
  }
  metricas() {
    return { politica: this.politica, cache: this.cache.metricas(),
      auditoria: { total: this.auditoria.total, ultimas: this.auditoria.listar().slice(-20) }, compressao: this.compressao.metricas() };
  }
  /**
   * Lê a política de uma variável de ambiente, como "cache,auditoria,compressao".
   *
   * @param texto Valor da variável; indefinido usa POLITICA_PADRAO e vazio desliga os decoradores.
   */
  static lerPolitica(texto: string | undefined): NomeDecorador[] {
    if (texto === undefined) return [...POLITICA_PADRAO];
    return validarPilha(texto.split(',').map(nome => nome.trim()).filter(Boolean) as NomeDecorador[]);
  }
}

function validarPilha(pilha: readonly NomeDecorador[]): NomeDecorador[] {
  const desconhecidos = pilha.filter(nome => !(DECORADORES as readonly string[]).includes(nome));
  exigir(!desconhecidos.length, `Decorador desconhecido: ${desconhecidos.join(', ')}. Use ${DECORADORES.join(', ')}.`, 400);
  exigir(new Set(pilha).size === pilha.length, 'Cada decorador pode aparecer uma única vez na pilha.', 400);
  return [...pilha];
}
/** Cópia do mapa e das listas; os candidatos, imutáveis, são compartilhados. */
function copiarRanking(ranking: Ranking): Ranking {
  return new Map([...ranking].map(([papel, candidatos]) => [papel, candidatos.slice()]));
}
function duracao(inicio: number): number { return Math.round((performance.now() - inicio) * 1000) / 1000; }

const identidades = new WeakMap<object, number>();
let ultimaIdentidade = 0;
function identidade(objeto: object): number {
  let valor = identidades.get(objeto);
  if (valor === undefined) { valor = ++ultimaIdentidade; identidades.set(objeto, valor); }
  return valor;
}
/** JSON com chaves ordenadas, para que a ordem dos campos não altere a chave do cache. */
function serializarOrdenado(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(serializarOrdenado).join(',')}]`;
  if (valor && typeof valor === 'object') {
    return `{${Object.keys(valor).sort().filter(k => (valor as Record<string, unknown>)[k] !== undefined)
      .map(k => `${JSON.stringify(k)}:${serializarOrdenado((valor as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(valor);
}
