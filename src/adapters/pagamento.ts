import { centavos, ErroDominio, exigir, type StatusPagamento } from '../domain/model.js';
import type { AdaptadorPagamento } from '../domain/ports.js';
import { ErroGatewayPagamento, PagSeguroSimulado, PayPalSimulado, StripeSimulado, type GatewayPagamento } from '../infrastructure/externos/pagamento.js';

/**
 * Base dos adaptadores de pagamento: valida o valor em reais, traduz o
 * vocabulário de status do gateway e converte "transação inexistente" em 404.
 * As subclasses só definem o formato da chamada ao gateway.
 */
abstract class AdaptadorGateway implements AdaptadorPagamento {
  abstract readonly provedor: string;
  /**
   * @param gateway Gateway adaptado.
   * @param status Tradução do status nativo para o status do domínio.
   * @param naoEncontrada Código que o gateway usa para transação inexistente.
   */
  protected constructor(protected readonly gateway: GatewayPagamento, private readonly status: Record<string, StatusPagamento>,
    private readonly naoEncontrada: string) {}
  async efetuarPagamento(valor: number, origem: string, destino: string): Promise<string> {
    exigir(Number.isFinite(valor) && valor > 0 && valor <= 100_000_000 && centavos(valor) / 100 === valor, 'Valor de pagamento inválido.');
    exigir(origem.trim() && destino.trim(), 'Informe a origem e o destino do pagamento.');
    return (await this.processar(valor, origem, destino)).id;
  }
  async cancelarPagamento(id: string): Promise<boolean> { return this.traduzir(() => this.gateway.estornarPagamento(id)); }
  async verificarPagamento(id: string): Promise<StatusPagamento> {
    const nativo = await this.traduzir(() => this.gateway.consultarStatus(id));
    // Status desconhecido é tratado como pendente até nova consulta.
    return this.status[nativo] ?? 'pendente';
  }
  protected abstract processar(valor: number, origem: string, destino: string): ReturnType<GatewayPagamento['processarPagamento']>;
  private async traduzir<T>(chamada: () => Promise<T>): Promise<T> {
    try { return await chamada(); }
    catch (erro) {
      if (erro instanceof ErroGatewayPagamento && erro.codigo === this.naoEncontrada) throw new ErroDominio('Transação não encontrada no provedor.', 404);
      throw erro;
    }
  }
}

/** Adapter para o Stripe: reais viram centavos inteiros; origem e destino viram customer e transfer_data. */
export class AdaptadorStripe extends AdaptadorGateway {
  readonly provedor = 'stripe';
  constructor(gateway: StripeSimulado = new StripeSimulado()) {
    super(gateway, { succeeded: 'aprovado', processing: 'pendente', requires_payment_method: 'recusado', canceled: 'cancelado', refunded: 'cancelado' }, 'resource_missing');
  }
  protected processar(valor: number, origem: string, destino: string) {
    return this.gateway.processarPagamento(centavos(valor), { currency: 'brl', customer: origem, transfer_data: { destination: destino } });
  }
}

/** Adapter para o PagSeguro: valor decimal em reais, referência de rastreio e recebedor. */
export class AdaptadorPagSeguro extends AdaptadorGateway {
  readonly provedor = 'pagseguro';
  constructor(gateway: PagSeguroSimulado = new PagSeguroSimulado()) {
    super(gateway, { PAID: 'aprovado', WAITING: 'pendente', IN_ANALYSIS: 'pendente', DECLINED: 'recusado', CANCELED: 'cancelado' }, '40400');
  }
  protected processar(valor: number, origem: string, destino: string) {
    return this.gateway.processarPagamento(valor, { reference_id: `cinebridge:${origem}:${destino}`, comprador: { id: origem }, recebedor: { id: destino } });
  }
}

/** Adapter para o PayPal: intent CAPTURE com payer e payee. */
export class AdaptadorPayPal extends AdaptadorGateway {
  readonly provedor = 'paypal';
  constructor(gateway: PayPalSimulado = new PayPalSimulado()) {
    super(gateway, { COMPLETED: 'aprovado', PENDING: 'pendente', DECLINED: 'recusado', VOIDED: 'cancelado', REFUNDED: 'cancelado' }, 'RESOURCE_NOT_FOUND');
  }
  protected processar(valor: number, origem: string, destino: string) {
    return this.gateway.processarPagamento(valor, { intent: 'CAPTURE', currency_code: 'BRL', payer: { payer_id: origem }, payee: { merchant_id: destino } });
  }
}
