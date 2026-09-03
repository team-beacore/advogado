import { CAPTURE_ERROR_CODES } from '../types';
import type { CaptureErrorCode } from '../types';

/**
 * Erros específicos da integração PJe (PDPJ-Br).
 * Todas as mensagens são seguras: NUNCA contêm credenciais, tokens,
 * Authorization headers ou certificados.
 */
export const PJE_ERROR_CODES = {
  NOT_CONFIGURED: 'PJE_NOT_CONFIGURED',
  AUTH_FAILED: 'PJE_AUTH_FAILED',
  AUTH_EXPIRED: 'PJE_AUTH_EXPIRED',
  FORBIDDEN: 'PJE_FORBIDDEN',
  PROCESS_NOT_FOUND: 'PJE_PROCESS_NOT_FOUND',
  INVALID_NUMBER: 'PJE_INVALID_NUMBER',
  TIMEOUT: 'PJE_TIMEOUT',
  RATE_LIMITED: 'PJE_RATE_LIMITED',
  INVALID_RESPONSE: 'PJE_INVALID_RESPONSE',
  UNAVAILABLE: 'PJE_UNAVAILABLE',
  UNSUPPORTED_OPERATION: 'PJE_UNSUPPORTED_OPERATION',
  NETWORK_ERROR: 'PJE_NETWORK_ERROR',
} as const;

export type PJeErrorCode = (typeof PJE_ERROR_CODES)[keyof typeof PJE_ERROR_CODES];

/** Mensagens seguras — jamais incluem headers, tokens ou credenciais. */
const MESSAGES: Record<PJeErrorCode, string> = {
  PJE_NOT_CONFIGURED: 'PJe não configurado. Configure cliente OAuth2 (client_id/client_secret) e credenciais no ambiente.',
  PJE_AUTH_FAILED: 'Falha de autenticação com o PJe. Verifique as credenciais OAuth2.',
  PJE_AUTH_EXPIRED: 'Sessão PJe expirada. Reautenticando automaticamente.',
  PJE_FORBIDDEN: 'Acesso negado pelo PJe para esta consulta.',
  PJE_PROCESS_NOT_FOUND: 'Processo não encontrado no PJe.',
  PJE_INVALID_NUMBER: 'Número de processo CNJ inválido.',
  PJE_TIMEOUT: 'Tempo limite da consulta ao PJe excedido.',
  PJE_RATE_LIMITED: 'Limite de requisições do PJe excedido. Aguarde e tente novamente.',
  PJE_INVALID_RESPONSE: 'O PJe retornou uma resposta inválida.',
  PJE_UNAVAILABLE: 'Serviço PJe indisponível no momento.',
  PJE_UNSUPPORTED_OPERATION: 'Operação não suportada pela integração PJe.',
  PJE_NETWORK_ERROR: 'Falha de rede ao consultar o PJe.',
};

/** Mapeia o erro PJe para o código genérico de captura existente. */
export function toCaptureErrorCode(code: PJeErrorCode): CaptureErrorCode {
  switch (code) {
    case PJE_ERROR_CODES.NOT_CONFIGURED: return CAPTURE_ERROR_CODES.INVALID_CONFIGURATION;
    case PJE_ERROR_CODES.AUTH_FAILED:
    case PJE_ERROR_CODES.AUTH_EXPIRED:
    case PJE_ERROR_CODES.FORBIDDEN: return CAPTURE_ERROR_CODES.AUTHENTICATION_FAILED;
    case PJE_ERROR_CODES.TIMEOUT: return CAPTURE_ERROR_CODES.TIMEOUT;
    case PJE_ERROR_CODES.RATE_LIMITED: return CAPTURE_ERROR_CODES.RATE_LIMITED;
    case PJE_ERROR_CODES.INVALID_RESPONSE: return CAPTURE_ERROR_CODES.NORMALIZATION_FAILED;
    case PJE_ERROR_CODES.PROCESS_NOT_FOUND:
    case PJE_ERROR_CODES.INVALID_NUMBER: return CAPTURE_ERROR_CODES.INVALID_CONFIGURATION;
    case PJE_ERROR_CODES.UNAVAILABLE:
    case PJE_ERROR_CODES.NETWORK_ERROR: return CAPTURE_ERROR_CODES.SOURCE_UNAVAILABLE;
    case PJE_ERROR_CODES.UNSUPPORTED_OPERATION: return CAPTURE_ERROR_CODES.SOURCE_UNAVAILABLE;
    default: return CAPTURE_ERROR_CODES.UNKNOWN_ERROR;
  }
}

export class PJeError extends Error {
  constructor(
    public code: PJeErrorCode,
    message?: string,
  ) {
    super(message ?? MESSAGES[code]);
    this.name = 'PJeError';
  }
}
