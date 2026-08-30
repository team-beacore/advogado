export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const errors = {
  unauthorized: (msg = 'Autenticação necessária.') => new ApiError(401, 'UNAUTHORIZED', msg),
  forbidden: (msg = 'Acesso negado.') => new ApiError(403, 'FORBIDDEN', msg),
  notFound: (msg = 'Recurso não encontrado.') => new ApiError(404, 'NOT_FOUND', msg),
  conflict: (msg = 'Conflito.') => new ApiError(409, 'CONFLICT', msg),
  validation: (msg = 'Dados inválidos.', details?: unknown) => new ApiError(400, 'VALIDATION', msg, details),
  tooLarge: (msg = 'Arquivo excede o tamanho máximo permitido.') => new ApiError(413, 'PAYLOAD_TOO_LARGE', msg),
  unsupportedType: (msg = 'Tipo de arquivo não suportado.') => new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', msg),
  aiNotConfigured: (msg = 'Serviço de IA não configurado.') =>
    new ApiError(503, 'AI_NOT_CONFIGURED', msg),
  storageUnavailable: (msg = 'Armazenamento indisponível.') =>
    new ApiError(503, 'STORAGE_UNAVAILABLE', msg),
  externalUnavailable: (msg = 'Serviço externo indisponível.') =>
    new ApiError(502, 'EXTERNAL_UNAVAILABLE', msg),
  internal: (msg = 'Erro interno do servidor.') => new ApiError(500, 'INTERNAL', msg),
};
