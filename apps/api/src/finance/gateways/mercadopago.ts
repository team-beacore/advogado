import { errors } from '../../errors';
import type { GatewayCharge, PaymentGateway } from '../gateway';

const API_BASE = 'https://api.mercadopago.com';

interface MercadoPagoConfig {
  accessToken?: string;
}

function readConfig(config: Record<string, unknown>): MercadoPagoConfig {
  return config as unknown as MercadoPagoConfig;
}

export class MercadoPagoGateway implements PaymentGateway {
  readonly name = 'mercadopago' as const;

  isConfigured(config: Record<string, unknown> | null): boolean {
    const { accessToken } = readConfig(config ?? {});
    return typeof accessToken === 'string' && accessToken.trim().length > 0;
  }

  async createCharge(charge: GatewayCharge, config: Record<string, unknown>) {
    if (!this.isConfigured(config)) throw errors.validation('Gateway não configurado.');
    const { accessToken } = readConfig(config);
    const payer: Record<string, unknown> = {};
    if (charge.customer?.name) payer.name = charge.customer.name;
    if (charge.customer?.email) payer.email = charge.customer.email;
    if (charge.customer?.taxId) {
      payer.identification = {
        type: charge.customer.taxId.length <= 11 ? 'CPF' : 'CNPJ',
        number: charge.customer.taxId,
      };
    }
    const body = {
      transaction_amount: Number((charge.amount / 100).toFixed(2)),
      description: charge.description,
      external_reference: charge.externalReference ?? undefined,
      payment_method_id: 'pix',
      payer,
    };
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/v1/payments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw errors.externalUnavailable('Gateway Mercado Pago indisponível.');
    }
    if (!res.ok) {
      throw errors.externalUnavailable('Erro ao criar cobrança no Mercado Pago.');
    }
    const data = (await res.json()) as Record<string, unknown>;
    const raw = data as unknown as Record<string, unknown>;
    const poi = raw.point_of_interaction as Record<string, unknown> | undefined;
    const txData = poi?.transaction_data as Record<string, unknown> | undefined;
    const checkoutUrl = typeof txData?.ticket_url === 'string' ? txData.ticket_url : null;
    const id = typeof raw.id === 'string' || typeof raw.id === 'number' ? String(raw.id) : '';
    const status = typeof raw.status === 'string' ? raw.status : 'pending';
    return { gatewayChargeId: id, checkoutUrl, status, raw };
  }

  async checkStatus(gatewayChargeId: string, config: Record<string, unknown>) {
    if (!this.isConfigured(config)) throw errors.validation('Gateway não configurado.');
    const { accessToken } = readConfig(config);
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/v1/payments/${encodeURIComponent(gatewayChargeId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      throw errors.externalUnavailable('Gateway Mercado Pago indisponível.');
    }
    if (!res.ok) {
      throw errors.externalUnavailable('Erro ao consultar pagamento no Mercado Pago.');
    }
    const data = (await res.json()) as Record<string, unknown>;
    const status = typeof data.status === 'string' ? data.status : 'pending';
    return { status, paid: status === 'approved' };
  }
}