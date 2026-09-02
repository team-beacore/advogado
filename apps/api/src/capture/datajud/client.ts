import { DATAJUD_ERROR_CODES, DataJudError, toCaptureErrorCode } from './errors';

/**
 * Transporte HTTP injetável (usado nos testes para simular a API real).
 * Em produção usa `fetch` global do Node (>= 18).
 */
export type DataJudTransport = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  status: number;
  json(): Promise<unknown>;
}>;

const defaultTransport: DataJudTransport = async (url, init) => {
  const res = await fetch(url, init as RequestInit);
  return {
    status: res.status,
    json: () => res.json(),
  };
};

export interface DataJudClientOptions {
  /** URL base, ex.: https://api-publica.datajud.cnj.jus.br */
  baseUrl: string;
  /** Chave pública/API Key (nunca logada nem exposta). */
  apiKey: string;
  /** Timeout em ms para cada chamada. */
  timeoutMs: number;
  /** Transporte injetável (somente testes). */
  transport?: DataJudTransport;
}

/** Envelope de busca Elasticsearch retornado pelo endpoint /_search. */
export interface DataJudSearchResponse {
  took?: number;
  timed_out?: boolean;
  _shards?: { total?: number; successful?: number; failed?: number };
  hits?: {
    total?: { value?: number; relation?: string };
    hits?: Array<{ _id?: string; _source?: Record<string, unknown> }>;
  };
}

/**
 * Cliente HTTP da API Pública do DataJud.
 *
 * Responsabilidades:
 *  - montar a URL por tribunal (api_publica_{sigla}/_search);
 *  - adicionar o cabeçalho de autenticação sem nunca expor a chave;
 *  - aplicar timeout em toda chamada;
 *  - interpretar status HTTP e resposta JSON;
 *  - mapear erros para DataJudError (mensagens sempre seguras).
 *
 * NÃO registra a chave, o cabeçalho Authorization nem payload sensível em logs.
 */
export class DataJudClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly transport: DataJudTransport;

  constructor(opts: DataJudClientOptions) {
    if (!opts.apiKey) throw new DataJudError(DATAJUD_ERROR_CODES.NOT_CONFIGURED);
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs;
    this.transport = opts.transport ?? defaultTransport;
  }

  endpointUrl(sigla: string): string {
    return `${this.baseUrl}/api_publica_${sigla}/_search`;
  }

  /**
   * Executa uma busca no índice do tribunal.
   * `body` deve ser um Query DSL Elasticsearch válido.
   */
  async search(sigla: string, body: Record<string, unknown>): Promise<DataJudSearchResponse> {
    const url = this.endpointUrl(sigla);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let status = 0;
    try {
      const res = await this.transport(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `APIKey ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      status = res.status;
      this.assertHttpStatus(status);
      const payload = await res.json();
      return this.parseEnvelope(payload);
    } catch (err) {
      if (err instanceof DataJudError) throw err;
      if ((err as { name?: string }).name === 'AbortError' || (err as { code?: string }).code === 'ABORT_ERR') {
        throw new DataJudError(DATAJUD_ERROR_CODES.TIMEOUT);
      }
      // Sem segredo: apenas código/status seguros.
      if (status === 0) throw new DataJudError(DATAJUD_ERROR_CODES.UNAVAILABLE);
      throw new DataJudError(DATAJUD_ERROR_CODES.UNAVAILABLE);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Mapeia status HTTP para erros seguros. */
  private assertHttpStatus(status: number): void {
    if (status >= 200 && status < 300) return;
    switch (status) {
      case 401: throw new DataJudError(DATAJUD_ERROR_CODES.UNAUTHORIZED);
      case 403: throw new DataJudError(DATAJUD_ERROR_CODES.FORBIDDEN);
      case 404: throw new DataJudError(DATAJUD_ERROR_CODES.COURT_NOT_SUPPORTED);
      case 429: throw new DataJudError(DATAJUD_ERROR_CODES.RATE_LIMITED);
      case 408:
      case 504: throw new DataJudError(DATAJUD_ERROR_CODES.TIMEOUT);
      default:
        if (status >= 500) throw new DataJudError(DATAJUD_ERROR_CODES.UNAVAILABLE);
        throw new DataJudError(DATAJUD_ERROR_CODES.BAD_RESPONSE);
    }
  }

  /** Valida o envelope Elasticsearch. `_shards.failed > 0` invalida "não encontrado". */
  private parseEnvelope(payload: unknown): DataJudSearchResponse {
    if (!payload || typeof payload !== 'object') throw new DataJudError(DATAJUD_ERROR_CODES.BAD_RESPONSE);
    const envelope = payload as DataJudSearchResponse;
    const shards = envelope._shards;
    if (shards && typeof shards.failed === 'number' && shards.failed > 0) {
      throw new DataJudError(DATAJUD_ERROR_CODES.UNAVAILABLE);
    }
    if (!envelope.hits || !Array.isArray(envelope.hits.hits)) {
      throw new DataJudError(DATAJUD_ERROR_CODES.BAD_RESPONSE);
    }
    return envelope;
  }

  /** Primeiro documento (hit) ou null quando o processo não existe no índice. */
  static firstSource(envelope: DataJudSearchResponse): Record<string, unknown> | null {
    const hit = envelope.hits?.hits?.[0];
    return hit?._source ?? null;
  }

  /** Expõe o mapeamento para capture_runs sem vazar o segredo. */
  static captureErrorCode(code: string): ReturnType<typeof toCaptureErrorCode> {
    return toCaptureErrorCode(code as Parameters<typeof toCaptureErrorCode>[0]);
  }
}
