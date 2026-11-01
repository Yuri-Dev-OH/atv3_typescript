import { randomBytes, randomUUID } from 'node:crypto';

/**
 * Simulações de gateways de pagamento. Cada uma tem sua unidade monetária,
 * formato de dados, prefixo de identificador e vocabulário de status.
 */

/** Transação no formato do gateway. */
export interface Transacao {
  id: string;
  status: string;
  /** Valor na unidade do gateway (centavos no Stripe, reais nos demais). */
  valor: number;
  moeda: string;
  criadaEm: string;
  dados: Record<string, unknown>;
}
/** Erro no formato do gateway, com o código que a API real devolveria. */
export class ErroGatewayPagamento extends Error {
  constructor(message: string, readonly codigo: string) { super(message); }
}

/** Interface comum dos gateways simulados (classe adaptada). */
export abstract class GatewayPagamento {
  protected readonly transacoes = new Map<string, Transacao>();
  private indisponivel = false;
  abstract processarPagamento(valor: number, dados: Record<string, unknown>): Promise<Transacao>;
  /** @returns Verdadeiro quando o estorno foi aceito. */
  abstract estornarPagamento(id: string): Promise<boolean>;
  abstract consultarStatus(id: string): Promise<string>;
  /** Simula queda do gateway, para testar falhas parciais. */
  simularIndisponibilidade(ativo = true): void { this.indisponivel = ativo; }
  protected verificarDisponibilidade(): void {
    if (this.indisponivel) throw new ErroGatewayPagamento('Gateway indisponível.', 'unavailable');
  }
  protected obter(id: string, codigo: string): Transacao {
    const transacao = this.transacoes.get(id);
    if (!transacao) throw new ErroGatewayPagamento(`Transação não encontrada: ${id}.`, codigo);
    return transacao;
  }
  protected registrar(transacao: Omit<Transacao, 'criadaEm'>): Transacao {
    const completa = { ...transacao, criadaEm: new Date().toISOString() };
    this.transacoes.set(completa.id, completa);
    return structuredClone(completa);
  }
}

/** Imita o Stripe: valor inteiro em centavos, moeda "brl", ids pi_… e status succeeded/refunded. */
export class StripeSimulado extends GatewayPagamento {
  async processarPagamento(valor: number, dados: Record<string, unknown>): Promise<Transacao> {
    this.verificarDisponibilidade();
    if (!Number.isInteger(valor) || valor < 50) throw new ErroGatewayPagamento('Amount must be an integer of at least 50 cents.', 'amount_invalid');
    if (dados.currency !== 'brl' || typeof dados.customer !== 'string') throw new ErroGatewayPagamento('Missing currency or customer.', 'parameter_missing');
    return this.registrar({ id: `pi_${randomBytes(12).toString('hex')}`, status: 'succeeded', valor, moeda: 'brl', dados });
  }
  async estornarPagamento(id: string): Promise<boolean> {
    this.verificarDisponibilidade();
    const transacao = this.obter(id, 'resource_missing');
    if (transacao.status !== 'succeeded') return false;
    transacao.status = 'refunded';
    return true;
  }
  async consultarStatus(id: string): Promise<string> { return this.obter(id, 'resource_missing').status; }
}

/** Imita o PagSeguro: valor decimal em reais, referência obrigatória, ids ORDE_… e status PAID/CANCELED. */
export class PagSeguroSimulado extends GatewayPagamento {
  async processarPagamento(valor: number, dados: Record<string, unknown>): Promise<Transacao> {
    this.verificarDisponibilidade();
    if (!(valor > 0) || Math.round(valor * 100) / 100 !== valor) throw new ErroGatewayPagamento('Valor deve ter no máximo duas casas decimais.', '40002');
    if (typeof dados.reference_id !== 'string' || !dados.recebedor) throw new ErroGatewayPagamento('reference_id e recebedor são obrigatórios.', '40001');
    return this.registrar({ id: `ORDE_${randomUUID().toUpperCase()}`, status: 'PAID', valor, moeda: 'BRL', dados });
  }
  async estornarPagamento(id: string): Promise<boolean> {
    this.verificarDisponibilidade();
    const transacao = this.obter(id, '40400');
    if (transacao.status !== 'PAID') return false;
    transacao.status = 'CANCELED';
    return true;
  }
  async consultarStatus(id: string): Promise<string> { return this.obter(id, '40400').status; }
}

/** Imita o PayPal: intent CAPTURE, payer/payee, ids de 17 caracteres e status COMPLETED/REFUNDED. */
export class PayPalSimulado extends GatewayPagamento {
  async processarPagamento(valor: number, dados: Record<string, unknown>): Promise<Transacao> {
    this.verificarDisponibilidade();
    if (dados.intent !== 'CAPTURE' || !dados.payer || !dados.payee) throw new ErroGatewayPagamento('INVALID_REQUEST', 'INVALID_REQUEST');
    if (!(valor > 0)) throw new ErroGatewayPagamento('AMOUNT_MISMATCH', 'AMOUNT_MISMATCH');
    return this.registrar({ id: randomBytes(9).toString('hex').toUpperCase().slice(0, 17), status: 'COMPLETED', valor, moeda: 'BRL', dados });
  }
  async estornarPagamento(id: string): Promise<boolean> {
    this.verificarDisponibilidade();
    const transacao = this.obter(id, 'RESOURCE_NOT_FOUND');
    if (transacao.status !== 'COMPLETED') return false;
    transacao.status = 'REFUNDED';
    return true;
  }
  async consultarStatus(id: string): Promise<string> { return this.obter(id, 'RESOURCE_NOT_FOUND').status; }
}
