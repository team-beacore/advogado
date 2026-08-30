import { errors } from '../../errors';
import type { GatewayCharge, PaymentGateway } from '../gateway';

const API_BASE = 'https://api.stripe.com';

interface StripeConfig {
  secretKey?: string;
}

function readConfig(config: Record<string, unknown>): StripeConfig {
  return config as unknown as StripeConfig;
}

function basicAuth(secretKey: string): string {
  return `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`;
}

export class StripeGateway implements PaymentGateway {
  readonly name = 'stripe' as const;

  isConfigured(config: Record<string, unknown> | null): boolean {
    const { secretKey } = readConfig(config ?? {});
    return typeof secretKey === 'string' && secretKey.trim().length > 0;
  }

  async createCharge(charge: GatewayCharge, config: Record<string, unknown>) {
    if (!this.isConfigured(config)) throw errors.validation('Gateway não configurado.');
    const { secretKey } = readConfig(config);
    const body = new URLSearchParams({
      amount: String(Math.round(charge.amount)),
      currency: 'brl',
      description: charge.description,
      ...(charge.externalReference ? { metadata: JSON.stringify({ external_reference: charge.externalReference }) } : {}),
    });
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/v1/payment_intents`, {
        method: 'POST',
        headers: {
          Authorization: basicAuth(secretKey!),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });
    } catch {
      throw errors.externalUnavailable('Gateway Stripe indisponível.');
    }
    if (!res.ok) {
      throw errors.externalUnavailable('Erro ao criar cobrança no Stripe.');
    }
    const data = (await res.json()) as Record<string, unknown>;
    const raw = data as unknown as Record<string, unknown>;
    const id = typeof raw.id === 'string' || typeof raw.id === 'number' ? String(raw.id) : '';
    const status = typeof raw.status === 'string' ? raw.status : 'requires_payment_method';
    return { gatewayChargeId: id, checkoutUrl: null, status, raw };
  }

  async checkStatus(gatewayChargeId: string, config: Record<string, unknown>) {
    if (!this.isConfigured(config)) throw errors.validation('Gateway não configurado.');
    const { secretKey } = readConfig(config);
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/v1/payment_intents/${encodeURIComponent(gatewayChargeId)}`, {
        headers: { Authorization: basicAuth(secretKey!) },
      });
    } catch {
      throw errors.externalUnavailable('Gateway Stripe indisponível.');
    }
    if (!res.ok) {
      throw errors.externalUnavailable('Erro ao consultar pagamento no Stripe.');
    }
    const data = (await res.json()) as Record<string, unknown>;
    const status = typeof data.status === 'string' ? data.status : 'unknown';
    return { status, paid: status === 'succeeded' };
  }
}