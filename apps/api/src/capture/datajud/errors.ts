import { CAPTURE_ERROR_CODES } from '../types';
import type { CaptureErrorCode } from '../types';

/**
 * Códigos de erro específicos do DataJud.
 * Onde possível reutilizam os códigos genéricos de CAPTURE_ERROR_CODES.
 * Nenhum erro carrega credencial/segredo (a mensagem é sempre segura).
 */
export const DATAJUD_ERROR_CODES = {
  NOT_CONFIGURED: 'DATAJUD_NOT_CONFIGURED',
  UNAUTHORIZED: 'DATAJUD_UNAUTHORIZED',
  FORBIDDEN: 'DATAJUD_FORBIDDEN',
  NOT_FOUND: 'DATAJUD_NOT_FOUND',
  TIMEOUT: 'DATAJUD_TIMEOUT',
  RATE_LIMITED: 'DATAJUD_RATE_LIMITED',
  BAD_RESPONSE: 'DATAJUD_BAD_RESPONSE',
  UNAVAILABLE: 'DATAJUD_UNAVAILABLE',
  COURT_NOT_SUPPORTED: 'DATAJUD_COURT_NOT_SUPPORTED',
  INVALID_NUMBER: 'DATAJUD_INVALID_NUMBER',
} as const;

export type DataJudErrorCode = (typeof DATAJUD_ERROR_CODES)[keyof typeof DATAJUD_ERROR_CODES];

/** Mensagens seguras — jamais incluem headers, tokens ou credenciais. */
const MESSAGES: Record<DataJudErrorCode, string> = {
  DATAJUD_NOT_CONFIGURED: 'DataJud não configurado. Configure a chave de acesso antes de consultar.',
  DATAJUD_UNAUTHORIZED: 'Falha de autenticação com o DataJud. Verifique a chave de acesso.',
  DATAJUD_FORBIDDEN: 'Acesso negado pelo DataJud para esta consulta.',
  DATAJUD_NOT_FOUND: 'Processo não encontrado no DataJud.',
  DATAJUD_TIMEOUT: 'Tempo limite da consulta ao DataJud excedido.',
  DATAJUD_RATE_LIMITED: 'Limite de requisições do DataJud excedido. Aguarde e tente novamente.',
  DATAJUD_BAD_RESPONSE: 'O DataJud retornou uma resposta inválida.',
  DATAJUD_UNAVAILABLE: 'Serviço DataJud indisponível no momento.',
  DATAJUD_COURT_NOT_SUPPORTED: 'Tribunal não suportado pela consulta DataJud.',
  DATAJUD_INVALID_NUMBER: 'Número de processo CNJ inválido.',
};

/** Mapeia o erro DataJud para o código genérico de captura existente. */
export function toCaptureErrorCode(code: DataJudErrorCode): CaptureErrorCode {
  switch (code) {
    case DATAJUD_ERROR_CODES.NOT_CONFIGURED: return CAPTURE_ERROR_CODES.INVALID_CONFIGURATION;
    case DATAJUD_ERROR_CODES.UNAUTHORIZED:
    case DATAJUD_ERROR_CODES.FORBIDDEN: return CAPTURE_ERROR_CODES.AUTHENTICATION_FAILED;
    case DATAJUD_ERROR_CODES.TIMEOUT: return CAPTURE_ERROR_CODES.TIMEOUT;
    case DATAJUD_ERROR_CODES.RATE_LIMITED: return CAPTURE_ERROR_CODES.RATE_LIMITED;
    case DATAJUD_ERROR_CODES.BAD_RESPONSE: return CAPTURE_ERROR_CODES.NORMALIZATION_FAILED;
    case DATAJUD_ERROR_CODES.NOT_FOUND:
    case DATAJUD_ERROR_CODES.COURT_NOT_SUPPORTED:
    case DATAJUD_ERROR_CODES.INVALID_NUMBER: return CAPTURE_ERROR_CODES.INVALID_CONFIGURATION;
    case DATAJUD_ERROR_CODES.UNAVAILABLE: return CAPTURE_ERROR_CODES.SOURCE_UNAVAILABLE;
    default: return CAPTURE_ERROR_CODES.UNKNOWN_ERROR;
  }
}

export class DataJudError extends Error {
  constructor(
    public code: DataJudErrorCode,
    message?: string,
  ) {
    super(message ?? MESSAGES[code]);
    this.name = 'DataJudError';
  }
}
