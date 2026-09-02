/**
 * DJEN — Diário de Justiça Eletrônico Nacional (API do Comunica PJe).
 *
 * Base técnica: especificação oficial OpenAPI 3.0 publicada pelo CNJ em
 * https://comunicaapi.pje.jus.br/swagger/djen.yml (Res. CNJ 455/2022).
 *
 * Capacidade REAL e documentada: consulta pública (sem autenticação) por OAB
 * (`numeroOab` + `ufOab`), retornando comunicações processuais (intimações,
 * citações, editais, pautas) que mencionam o advogado — não o acervo completo.
 *
 * IMPORTANTE: este cliente é usado por um provider de DESCOBERTA (encontra
 * números de processo vinculados ao advogado via comunicações publicadas).
 * Nenhum dado sensível é registrado; nenhuma credencial é necessária na
 * consulta pública.
 */

export const DJEN_ERROR_CODES = {
  RATE_LIMITED: 'DJEN_RATE_LIMITED',
  UNAVAILABLE: 'DJEN_UNAVAILABLE',
  BAD_RESPONSE: 'DJEN_BAD_RESPONSE',
  INVALID_PARAMS: 'DJEN_INVALID_PARAMS',
} as const;

export type DJENErrorCode = (typeof DJEN_ERROR_CODES)[keyof typeof DJEN_ERROR_CODES];

const DJEN_MESSAGES: Record<DJENErrorCode, string> = {
  DJEN_RATE_LIMITED: 'Limite de requisições do DJEN excedido. Aguarde um minuto e tente novamente.',
  DJEN_UNAVAILABLE: 'Serviço DJEN indisponível no momento.',
  DJEN_BAD_RESPONSE: 'O DJEN retornou uma resposta inválida.',
  DJEN_INVALID_PARAMS: 'Parâmetros de consulta inválidos para o DJEN.',
};

export class DJENError extends Error {
  constructor(
    public code: DJENErrorCode,
    message?: string,
  ) {
    super(message ?? DJEN_MESSAGES[code]);
    this.name = 'DJENError';
  }
}

/** Transporte HTTP injetável (mock apenas em testes). */
export type DJENTransport = (url: string, init: { method: string; headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

const defaultTransport: DJENTransport = async (url, init) => {
  const res = await fetch(url, init as RequestInit);
  return {
    status: res.status,
    headers: { get: (n) => res.headers.get(n) },
    json: () => res.json(),
  };
};

export interface DJENClientOptions {
  baseUrl: string;
  timeoutMs: number;
  transport?: DJENTransport;
}

export interface DJENComunicacaoQuery {
  numeroOab?: string;
  ufOab?: string;
  nomeAdvogado?: string;
  numeroProcesso?: string;
  siglaTribunal?: string;
  dataDisponibilizacaoInicio?: string;
  dataDisponibilizacaoFim?: string;
  pagina?: number;
  itensPorPagina?: number;
  meio?: 'D' | 'E';
}

/** Item de comunicação retornado pelo DJEN (campos úteis — ignoramos texto completo desnecessário). */
export interface DJENComunicacaoItem {
  id: number;
  numero_processo?: string;
  numeroprocessocommascara?: string;
  siglaTribunal?: string;
  tipoComunicacao?: string;
  data_disponibilizacao?: string;
  nomeOrgao?: string;
  nomeClasse?: string;
  codigoClasse?: string;
  hash?: string;
  destinatarioadvogados?: Array<{
    advogado?: { nome?: string; numero_oab?: string; uf_oab?: string };
  }>;
}

export interface DJENComunicacaoResponse {
  status?: string;
  message?: string;
  count?: number;
  items?: DJENComunicacaoItem[];
}

export const DEFAULT_DJEN_BASE_URL = 'https://comunicaapi.pje.jus.br';

/**
 * Cliente HTTP da API pública do DJEN (Comunica PJe).
 * Consulta pública por OAB/UF: GET /api/v1/comunicacao?numeroOab=..&ufOab=..
 */
export class DJENClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly transport: DJENTransport;

  constructor(opts: DJENClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs;
    this.transport = opts.transport ?? defaultTransport;
  }

  /** Lista comunicações por OAB/UF (descoberta profissional real e documentada). */
  async findByOab(oab: string, uf: string, opts: { pagina?: number; siglaTribunal?: string } = {}): Promise<DJENComunicacaoResponse> {
    const q: DJENComunicacaoQuery = {
      numeroOab: oab,
      ufOab: uf,
      itensPorPagina: 100,
      ...(opts.pagina ? { pagina: opts.pagina } : {}),
      ...(opts.siglaTribunal ? { siglaTribunal: opts.siglaTribunal } : {}),
    };
    return this.get('/api/v1/comunicacao', q as unknown as Record<string, unknown>);
  }

  /** Consulta comunicações por número de processo (enriquecimento por CNJ). */
  async findByProcessNumber(numeroProcesso: string, opts: { pagina?: number } = {}): Promise<DJENComunicacaoResponse> {
    const q: DJENComunicacaoQuery = { numeroProcesso, itensPorPagina: 100, ...(opts.pagina ? { pagina: opts.pagina } : {}) };
    return this.get('/api/v1/comunicacao', q as unknown as Record<string, unknown>);
  }

  /** Lista tribunais disponíveis (valida conectividade real). */
  async listTribunals(): Promise<Array<{ sigla?: string; nome?: string; jurisdicao?: string }>> {
    const res = await this.rawGet('/api/v1/comunicacao/tribunal');
    this.assertStatus(res.status);
    const payload = (await res.json()) as unknown;
    if (!Array.isArray(payload)) throw new DJENError(DJEN_ERROR_CODES.BAD_RESPONSE);
    return payload as Array<{ sigla?: string; nome?: string; jurisdicao?: string }>;
  }

  private async get(path: string, query: Record<string, unknown>): Promise<DJENComunicacaoResponse> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    }
    const url = `${this.baseUrl}${path}?${qs.toString()}`;
    const res = await this.rawGet(url);
    this.assertStatus(res.status);
    const payload = (await res.json()) as DJENComunicacaoResponse;
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items)) {
      throw new DJENError(DJEN_ERROR_CODES.BAD_RESPONSE);
    }
    return payload;
  }

  private rawGet(url: string): Promise<Awaited<ReturnType<DJENTransport>>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    return this.transport(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal })
      .catch((err: unknown) => {
        if (err instanceof DJENError) throw err;
        if ((err as { name?: string }).name === 'AbortError') throw new DJENError(DJEN_ERROR_CODES.UNAVAILABLE, 'Tempo limite da consulta ao DJEN excedido.');
        throw new DJENError(DJEN_ERROR_CODES.UNAVAILABLE);
      })
      .finally(() => clearTimeout(timer));
  }

  private assertStatus(status: number): void {
    if (status >= 200 && status < 300) return;
    switch (status) {
      case 429: throw new DJENError(DJEN_ERROR_CODES.RATE_LIMITED);
      case 422: throw new DJENError(DJEN_ERROR_CODES.INVALID_PARAMS);
      default:
        if (status >= 500) throw new DJENError(DJEN_ERROR_CODES.UNAVAILABLE);
        throw new DJENError(DJEN_ERROR_CODES.UNAVAILABLE);
    }
  }
}
