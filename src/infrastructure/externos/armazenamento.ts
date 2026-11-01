/**
 * Simulações de provedores de armazenamento em nuvem. Cada uma imita as
 * convenções do serviço real (URIs, versões, erros), que o núcleo não conhece:
 * quem as traduz são os adaptadores em src/adapters.
 */

/** Erro no formato do provedor, com o código que a API real devolveria. */
export class ErroArmazenamentoExterno extends Error {
  constructor(message: string, readonly codigo: string) { super(message); }
}

/** Interface comum das APIs de armazenamento simuladas (classe adaptada). */
export abstract class ArmazenamentoExterno {
  protected readonly objetos = new Map<string, File>();
  /** @returns Identificador nativo do objeto enviado. */
  abstract upload(arquivo: File): Promise<string>;
  abstract download(id: string): Promise<File>;
  /** @returns Identificadores nativos dos objetos da pasta. */
  abstract listar(pasta: string): Promise<string[]>;
}

/** Imita o Amazon S3: identificadores no formato s3://bucket/chave e erro NoSuchKey. */
export class S3Simulado extends ArmazenamentoExterno {
  constructor(readonly bucket = 'cinebridge-midia') { super(); }
  async upload(arquivo: File): Promise<string> {
    if (!arquivo.name || arquivo.name.startsWith('/') || arquivo.name.length > 1024) throw new ErroArmazenamentoExterno('Chave inválida.', 'InvalidKey');
    this.objetos.set(arquivo.name, arquivo);
    return `s3://${this.bucket}/${arquivo.name}`;
  }
  async download(uri: string): Promise<File> {
    const prefixo = `s3://${this.bucket}/`;
    const arquivo = uri.startsWith(prefixo) ? this.objetos.get(uri.slice(prefixo.length)) : undefined;
    if (!arquivo) throw new ErroArmazenamentoExterno('The specified key does not exist.', 'NoSuchKey');
    return arquivo;
  }
  async listar(pasta: string): Promise<string[]> {
    return [...this.objetos.keys()].filter(chave => chave.startsWith(pasta)).sort().map(chave => `s3://${this.bucket}/${chave}`);
  }
}

/**
 * Imita o Google Cloud Storage: o upload devolve gs://bucket/objeto#geração, o
 * download aceita a URI com ou sem geração e a listagem devolve só os nomes.
 */
export class GoogleCloudStorageSimulado extends ArmazenamentoExterno {
  private geracao = 1_700_000_000_000;
  constructor(readonly bucket = 'cinebridge-midia') { super(); }
  async upload(arquivo: File): Promise<string> {
    if (!arquivo.name) throw new ErroArmazenamentoExterno('Object name is required.', '400');
    this.objetos.set(arquivo.name, arquivo);
    return `gs://${this.bucket}/${arquivo.name}#${++this.geracao}`;
  }
  async download(uri: string): Promise<File> {
    const prefixo = `gs://${this.bucket}/`;
    const nome = uri.startsWith(prefixo) ? uri.slice(prefixo.length).replace(/#\d+$/, '') : '';
    const arquivo = this.objetos.get(nome);
    if (!arquivo) throw new ErroArmazenamentoExterno(`No such object: ${this.bucket}/${nome}`, '404');
    return arquivo;
  }
  async listar(pasta: string): Promise<string[]> {
    return [...this.objetos.keys()].filter(nome => nome.startsWith(pasta)).sort();
  }
}
