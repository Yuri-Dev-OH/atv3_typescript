import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ErroDominio, exigir } from '../domain/model.js';
import type { AdaptadorArmazenamento, MetadadosArquivo } from '../domain/ports.js';
import { ErroArmazenamentoExterno, GoogleCloudStorageSimulado, S3Simulado } from '../infrastructure/externos/armazenamento.js';

// Segmentos começam com letra ou dígito, o que exclui "." e "..".
const SEGMENTO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/;

/**
 * Valida um identificador lógico (segmentos separados por "/").
 *
 * @throws ErroDominio 400 para identificadores com segmentos vazios, "..", barras invertidas ou caracteres fora do padrão.
 */
export function validarIdentificador(id: string): string {
  const partes = id.split('/');
  exigir(id.length <= 512 && partes.length <= 8 && partes.every(parte => SEGMENTO.test(parte)), 'Identificador de arquivo inválido.', 400);
  return id;
}
/** Prefixo de listagem: mesmas regras do identificador, com barra final opcional. */
function validarPrefixo(prefixo: string): string {
  validarIdentificador(prefixo.replace(/\/$/, ''));
  return prefixo;
}
/** Identificador novo dentro da pasta: pasta/uuid-nome, com o nome reduzido a caracteres seguros. */
function novoIdentificador(metadados: MetadadosArquivo): string {
  const pasta = validarPrefixo(metadados.pasta).replace(/\/$/, '');
  const nome = metadados.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._-]+/, '').slice(-120) || 'arquivo';
  return validarIdentificador(`${pasta}/${randomUUID()}-${nome}`);
}
async function paraBuffer(arquivo: File): Promise<Buffer> { return Buffer.from(await arquivo.arrayBuffer()); }
function naoEncontrado(): ErroDominio { return new ErroDominio('Arquivo não encontrado.', 404); }

/** Adapter para o Amazon S3: traduz identificadores lógicos em URIs s3:// e o erro NoSuchKey em 404. */
export class AdaptadorS3 implements AdaptadorArmazenamento {
  readonly provedor = 's3';
  constructor(private readonly s3: S3Simulado = new S3Simulado()) {}
  async salvarArquivo(conteudo: Buffer, metadados: MetadadosArquivo): Promise<string> {
    const id = novoIdentificador(metadados);
    await this.s3.upload(new File([new Uint8Array(conteudo)], id, { type: metadados.tipoConteudo }));
    return id;
  }
  async recuperarArquivo(id: string): Promise<Buffer> {
    try { return await paraBuffer(await this.s3.download(`s3://${this.s3.bucket}/${validarIdentificador(id)}`)); }
    catch (erro) { throw erro instanceof ErroArmazenamentoExterno && erro.codigo === 'NoSuchKey' ? naoEncontrado() : erro; }
  }
  async listarArquivos(prefixo: string): Promise<string[]> {
    const raiz = `s3://${this.s3.bucket}/`;
    return (await this.s3.listar(validarPrefixo(prefixo))).map(uri => uri.slice(raiz.length));
  }
}

/** Adapter para o Google Cloud Storage: descarta a geração devolvida e traduz o código 404. */
export class AdaptadorGoogleCloud implements AdaptadorArmazenamento {
  readonly provedor = 'gcs';
  constructor(private readonly gcs: GoogleCloudStorageSimulado = new GoogleCloudStorageSimulado()) {}
  async salvarArquivo(conteudo: Buffer, metadados: MetadadosArquivo): Promise<string> {
    const id = novoIdentificador(metadados);
    await this.gcs.upload(new File([new Uint8Array(conteudo)], id, { type: metadados.tipoConteudo }));
    return id;
  }
  async recuperarArquivo(id: string): Promise<Buffer> {
    try { return await paraBuffer(await this.gcs.download(`gs://${this.gcs.bucket}/${validarIdentificador(id)}`)); }
    catch (erro) { throw erro instanceof ErroArmazenamentoExterno && erro.codigo === '404' ? naoEncontrado() : erro; }
  }
  async listarArquivos(prefixo: string): Promise<string[]> { return this.gcs.listar(validarPrefixo(prefixo)); }
}

/**
 * Adapter para o disco local (node:fs), útil em desenvolvimento e em contêineres
 * com volume. Converte "/" no separador do sistema, então funciona igual no
 * Windows e no Linux, e nunca sai do diretório raiz.
 */
export class AdaptadorLocal implements AdaptadorArmazenamento {
  readonly provedor = 'local';
  private readonly raiz: string;
  /** @param raiz Diretório base; criado na primeira gravação. */
  constructor(raiz: string) { this.raiz = path.resolve(raiz); }
  async salvarArquivo(conteudo: Buffer, metadados: MetadadosArquivo): Promise<string> {
    const id = novoIdentificador(metadados);
    const caminho = this.caminho(id);
    await mkdir(path.dirname(caminho), { recursive: true });
    await writeFile(caminho, conteudo, { flag: 'wx' });
    return id;
  }
  async recuperarArquivo(id: string): Promise<Buffer> {
    try { return await readFile(this.caminho(validarIdentificador(id))); }
    catch (erro) { throw codigo(erro) === 'ENOENT' || codigo(erro) === 'EISDIR' ? naoEncontrado() : erro; }
  }
  async listarArquivos(prefixo: string): Promise<string[]> {
    validarPrefixo(prefixo);
    // Começa pela pasta mais profunda conhecida do prefixo para não varrer o disco inteiro.
    const pasta = prefixo.includes('/') ? prefixo.slice(0, prefixo.lastIndexOf('/')) : '';
    const base = pasta ? this.caminho(pasta) : this.raiz;
    try {
      const entradas = await readdir(base, { recursive: true, withFileTypes: true });
      return entradas.filter(entrada => entrada.isFile())
        .map(entrada => path.relative(this.raiz, path.join(entrada.parentPath, entrada.name)).split(path.sep).join('/'))
        .filter(id => id.startsWith(prefixo)).sort();
    } catch (erro) {
      if (codigo(erro) === 'ENOENT') return [];
      throw erro;
    }
  }
  private caminho(id: string): string {
    const destino = path.resolve(this.raiz, ...id.split('/'));
    exigir(destino.startsWith(this.raiz + path.sep), 'Identificador de arquivo inválido.', 400);
    return destino;
  }
}

function codigo(erro: unknown): string | undefined {
  return erro && typeof erro === 'object' && 'code' in erro ? String(erro.code) : undefined;
}
