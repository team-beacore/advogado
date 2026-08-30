export interface GatewayCharge {
  amount: number;
  description: string;
  externalReference?: string | null;
  customer?: { name?: string; email?: string; taxId?: string } | null;
}

export interface PaymentGateway {
  readonly name: 'mercadopago' | 'stripe';
  isConfigured(config: Record<string, unknown> | null): boolean;
  createCharge(charge: GatewayCharge, config: Record<string, unknown>): Promise<{ gatewayChargeId: string; checkoutUrl?: string | null; status: string; raw?: Record<string, unknown> }>;
  checkStatus(gatewayChargeId: string, config: Record<string, unknown>): Promise<{ status: string; paid: boolean }>;
}