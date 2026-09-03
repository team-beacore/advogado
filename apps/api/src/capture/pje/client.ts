import { PJeError, PJE_ERROR_CODES } from './errors';
import type { PJeTokenResponse, PJeProcessoListResponse, PJeMovimentosResponse, PJeProcessoHeader, PJeMovimento } from './types';

export interface PJeClientOptions {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  tokenUrl: string;
  baseUrl: string;
  timeoutMs: number;
  transport?: PJeTransport;
}

export type PJeTransport = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

const defaultTransport: PJeTransport = async (url, init) => {
  const res = await fetch(url, init as RequestInit);
  return {
    status: res.status,
    json: () => res.json(),
    text: () => res.text(),
  };
};

/**
 * Cliente HTTP da API do PJe (PDPJ-Br).
 *
 * Autenticação: OAuth2/OpenID Connect via Keycloak (realm pje).
 * Fluxo: grant_type=password com client_id + client_secret + username + password.
 * O token JWT é enviado como Authorization: Bearer nas chamadas de API.
 *
 * NUNCA registra o token, client_secret, password ou Authorization header em logs.
 * Fonte: http://docs.pje.jus.br, https://docs.pdpj.jus.br
 */
export class PJeClient {
  private tokenUrl: string;
  private baseUrl: string;
  private clientId: string;
  private clientSecret: string;
  private username: string;
  private password: string;
  private timeoutMs: number;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private transport: PJeTransport;

  constructor(opts: PJeClientOptions) {
    if (!opts.clientId || !opts.clientSecret || !opts.username || !opts.password) {
      throw new PJeError(PJE_ERROR_CODES.NOT_CONFIGURED);
    }
    this.tokenUrl = opts.tokenUrl;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.username = opts.username;
    this.password = opts.password;
    this.timeoutMs = opts.timeoutMs;
    this.transport = opts.transport ?? defaultTransport;
  }

  private isTokenExpired(): boolean {
    return !this.accessToken || Date.now() >= this.tokenExpiresAt - 60000;
  }

  private async authenticate(): Promise<void> {
    if (!this.clientId || !this.clientSecret || !this.username || !this.password) {
      throw new PJeError(PJE_ERROR_CODES.NOT_CONFIGURED);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const body = new URLSearchParams({
        grant_type: 'password',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        username: this.username,
        password: this.password,
      });
      const res = await this.transport(this.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: controller.signal,
      });
      if (res.status !== 200) {
        await res.text().catch(() => '');
        throw new PJeError(PJE_ERROR_CODES.AUTH_FAILED);
      }
      const json = (await res.json()) as PJeTokenResponse;
      if (json.error) throw new PJeError(PJE_ERROR_CODES.AUTH_FAILED);
      if (!json.access_token) throw new PJeError(PJE_ERROR_CODES.AUTH_FAILED);
      this.accessToken = json.access_token;
      this.tokenExpiresAt = Date.now() + (json.expires_in ?? 3600) * 1000;
    } catch (err) {
      if (err instanceof PJeError) throw err;
      if ((err as { name?: string }).name === 'AbortError') throw new PJeError(PJE_ERROR_CODES.TIMEOUT);
      throw new PJeError(PJE_ERROR_CODES.NETWORK_ERROR);
    } finally {
      clearTimeout(timer);
    }
  }

  private async ensureAuth(): Promise<void> {
    if (this.isTokenExpired()) {
      await this.authenticate();
    }
  }

  private async request(path: string): Promise<{ status: number; body: unknown }> {
    await this.ensureAuth();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const url = `${this.baseUrl}${path}`;
      const res = await this.transport(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: 'application/json',
        },
        body: '',
        signal: controller.signal,
      });
      if (res.status === 401 || res.status === 403) {
        this.accessToken = null;
        throw new PJeError(PJE_ERROR_CODES.AUTH_FAILED);
      }
      if (res.status === 429) throw new PJeError(PJE_ERROR_CODES.RATE_LIMITED);
      if (res.status === 404) throw new PJeError(PJE_ERROR_CODES.PROCESS_NOT_FOUND);
      if (res.status === 408 || res.status === 504) throw new PJeError(PJE_ERROR_CODES.TIMEOUT);
      if (res.status >= 500) throw new PJeError(PJE_ERROR_CODES.UNAVAILABLE);
      if (res.status !== 200) throw new PJeError(PJE_ERROR_CODES.INVALID_RESPONSE);
      const body = await res.json();
      return { status: res.status, body };
    } catch (err) {
      if (err instanceof PJeError) throw err;
      if ((err as { name?: string }).name === 'AbortError') throw new PJeError(PJE_ERROR_CODES.TIMEOUT);
      throw new PJeError(PJE_ERROR_CODES.NETWORK_ERROR);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Busca processo por número CNJ (20 dígitos numeração única). */
  async lookupByProcessNumber(processNumber: string): Promise<PJeProcessoHeader | null> {
    const { body } = await this.request(`/processos?filter=${encodeURIComponent(JSON.stringify({ numero: { eq: processNumber.replace(/\D/g, '') } }))}`);
    const list = body as PJeProcessoListResponse;
    const processos = list._embedded?.processos ?? list.content ?? [];
    return processos[0] ?? null;
  }

  /** Busca movimentos de um processo pelo ID do PJe. */
  async fetchMovements(processId: string | number): Promise<PJeMovimento[]> {
    try {
      const { body } = await this.request(`/processos/${processId}/movimentos`);
      const resp = body as PJeMovimentosResponse;
      return resp._embedded?.movimentos ?? resp.content ?? [];
    } catch (err) {
      if (err instanceof PJeError && err.code === PJE_ERROR_CODES.PROCESS_NOT_FOUND) return [];
      throw err;
    }
  }
}