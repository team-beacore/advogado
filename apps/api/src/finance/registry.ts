import type { PaymentGateway } from './gateway';
import { MercadoPagoGateway } from './gateways/mercadopago';
import { StripeGateway } from './gateways/stripe';
import { errors } from '../errors';

let gateways: PaymentGateway[] | null = null;

export function getPaymentGateways(): PaymentGateway[] {
  if (!gateways) {
    gateways = [new MercadoPagoGateway(), new StripeGateway()];
  }
  return gateways;
}

export function setPaymentGatewaysForTests(g: PaymentGateway[] | null): void {
  gateways = g;
}

export function getPaymentGateway(name: 'mercadopago' | 'stripe'): PaymentGateway {
  const gw = getPaymentGateways().find((g) => g.name === name);
  if (!gw) throw errors.validation('Gateway de pagamento não suportado.');
  return gw;
}