import path from 'node:path';
import type { AdaptadorArmazenamento, AdaptadoresExternos, AdaptadorPagamento, AdaptadorProfissional, RepositorioProfissionais } from '../domain/ports.js';
import { AdaptadorGoogleCloud, AdaptadorLocal, AdaptadorS3 } from './armazenamento.js';
import { AdaptadorPagSeguro, AdaptadorPayPal, AdaptadorStripe } from './pagamento.js';
import { AdaptadorIndeed, AdaptadorInterno, AdaptadorLinkedIn } from './profissional.js';

export type { AdaptadoresExternos };
/** Nomes dos provedores escolhidos por configuração (variáveis de ambiente). */
export interface ProvedoresConfigurados {
  armazenamento?: string;
  pagamento?: string;
  profissional?: string;
  /** Diretório do AdaptadorLocal. */
  diretorioLocal?: string;
}

// Registros por nome: adicionar um provedor é incluir uma entrada, sem condicionais.
const ARMAZENAMENTO: Record<string, (c: ProvedoresConfigurados) => AdaptadorArmazenamento> = {
  local: c => new AdaptadorLocal(c.diretorioLocal ?? path.resolve('.armazenamento')),
  s3: () => new AdaptadorS3(),
  gcs: () => new AdaptadorGoogleCloud(),
};
const PAGAMENTO: Record<string, () => AdaptadorPagamento> = {
  stripe: () => new AdaptadorStripe(),
  pagseguro: () => new AdaptadorPagSeguro(),
  paypal: () => new AdaptadorPayPal(),
};
const PROFISSIONAL: Record<string, (repo: RepositorioProfissionais) => AdaptadorProfissional> = {
  interno: repo => new AdaptadorInterno(repo),
  linkedin: () => new AdaptadorLinkedIn(),
  indeed: () => new AdaptadorIndeed(),
};

/**
 * Ponto de composição dos adaptadores: o núcleo recebe apenas as interfaces.
 *
 * @param config Nomes dos provedores; os padrões são S3 simulado, Stripe simulado e cadastro interno.
 * @param profissionais Repositório usado pelo AdaptadorInterno.
 * @throws Error Quando um nome de provedor não está registrado.
 */
export function criarAdaptadores(config: ProvedoresConfigurados, profissionais: RepositorioProfissionais): AdaptadoresExternos {
  return {
    armazenamento: escolher(ARMAZENAMENTO, config.armazenamento ?? 's3', 'armazenamento')(config),
    pagamento: escolher(PAGAMENTO, config.pagamento ?? 'stripe', 'pagamento')(),
    profissional: escolher(PROFISSIONAL, config.profissional ?? 'interno', 'profissionais')(profissionais),
  };
}

function escolher<T>(registro: Record<string, T>, nome: string, categoria: string): T {
  const fabrica = Object.hasOwn(registro, nome) ? registro[nome] : undefined;
  if (!fabrica) throw new Error(`Provedor de ${categoria} desconhecido: "${nome}". Opções: ${Object.keys(registro).join(', ')}.`);
  return fabrica;
}
