import { getEnv } from '../../config';
import type { CaptureAdapter, CaptureFetchResult, CaptureTestResult } from '../types';
import type { DiscoveryCapabilities, DiscoveryResult, DiscoveryTestConnectionResult, ProcessDiscoveryProvider, ProfessionalIdentityInput } from '../discovery/types';
import { PJeClient, type PJeTransport } from './client';
import { PJeError, PJE_ERROR_CODES } from './errors';
import { normalizePJeProcess } from './normalize';
import type { ResolvedPJeConfig } from './types';
export type { ResolvedPJeConfig };

/**
 * Integração real com a API do PJe (PDPJ-Br).
 *
 * Capacidades reais (comprovadas via documentação oficial do CNJ):
 *  - Consulta por número CNJ (supportsProcessLookup = true).
 *  - Movimentações (supportsMovements = true).
 *  - Documentos (supportsDocuments = true).
 *  - Descoberta por OAB (supportsProfessionalDiscovery = false) — a API do PJe
 *    requer autenticação OAuth2 e cliente registrado; não há endpoint público
 *    de descoberta por advogado.
 *
 * A autenticação é OAuth2 via Keycloak (realm pje). Exige:
 *   - client_id + client_secret (cadastro junto ao CNJ via integracaopdpj@cnj.jus.br)
 *   - username + password (credenciais de usuário do PJe)
 *
 * Fonte: http://docs.pje.jus.br, https://docs.pdpj.jus.br
 */

export const DEFAULT_PJE_SSO_URL = 'https://sso.cloud.pje.jus.br/auth/realms/pje/protocol/openid-connect/token';
export const DEFAULT_PJE_GATEWAY_URL = 'https://gateway.cloud.pje.jus.br';
export const DEFAULT_PJE_TIMEOUT_MS = 30000;

function resolvePJeConfig(config: Record<string, unknown> | null): ResolvedPJeConfig {
  const env = getEnv();
  const c = config ?? {};
  const clientId = (typeof c.clientId === 'string' && c.clientId) || env.PJE_CLIENT_ID || '';
  const clientSecret = (typeof c.clientSecret === 'string' && c.clientSecret) || env.PJE_CLIENT_SECRET || '';
  const username = (typeof c.username === 'string' && c.username) || env.PJE_USERNAME || '';
  const password = (typeof c.password === 'string' && c.password) || env.PJE_PASSWORD || '';
  const tokenUrl = (typeof c.tokenUrl === 'string' && c.tokenUrl) || env.PJE_SSO_URL || DEFAULT_PJE_SSO_URL;
  const baseUrl = (typeof c.baseUrl === 'string' && c.baseUrl) || env.PJE_GATEWAY_URL || DEFAULT_PJE_GATEWAY_URL;
  const timeoutMs = (typeof c.timeoutMs === 'number' && c.timeoutMs > 0) ? c.timeoutMs : env.PJE_TIMEOUT_MS || DEFAULT_PJE_TIMEOUT_MS;
  const processNumbers = Array.isArray(c.processNumbers)
    ? c.processNumbers.filter((n): n is string => typeof n === 'string' && n.length > 0)
    : [];
  const enabled = c.enabled !== false;
  return { clientId, clientSecret, username, password, tokenUrl, baseUrl, timeoutMs, processNumbers, enabled };
}

function buildClient(config: ResolvedPJeConfig, transport?: PJeTransport): PJeClient {
  if (!config.clientId || !config.clientSecret || !config.username || !config.password) {
    throw new PJeError(PJE_ERROR_CODES.NOT_CONFIGURED);
  }
  return new PJeClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    username: config.username,
    password: config.password,
    tokenUrl: config.tokenUrl,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    transport,
  });
}

function safeMessage(err: unknown): string {
  if (err instanceof PJeError) return err.message;
  return 'Falha ao consultar o PJe.';
}

/**
 * Consulta um único processo por número CNJ via API PJe.
 * Retorna o processo normalizado ou null quando não encontrado.
 * `transport` é usado somente em testes (mock do transporte HTTP).
 */
export async function lookupPJeProcess(
  processNumber: string,
  config: Record<string, unknown> | null,
  transport?: PJeTransport,
): Promise<ReturnType<typeof normalizePJeProcess> | null> {
  if (!processNumber) throw new PJeError(PJE_ERROR_CODES.INVALID_NUMBER);
  const resolved = resolvePJeConfig(config);
  if (!resolved.clientId) throw new PJeError(PJE_ERROR_CODES.NOT_CONFIGURED);
  const client = buildClient(resolved, transport);
  const header = await client.lookupByProcessNumber(processNumber);
  if (!header) return null;
  const movements = await client.fetchMovements(header.id!);
  const enriched = { ...header, movimentos: movements };
  return normalizePJeProcess(enriched as Parameters<typeof normalizePJeProcess>[0]);
}

/**
 * Adapter de captura REAL do PJe.
 * Substitui o placeholder NotImplementedAdapter. Executa chamadas HTTP reais
 * (OAuth2 + REST) para a API oficial do PJe.
 */
export class PJeCaptureAdapter implements CaptureAdapter {
  readonly source = 'PJE' as const;
  readonly mode = 'AUTHENTICATED' as const;
  readonly label = 'PJe (PDPJ-Br)';
  readonly implemented = true;

  constructor(private readonly transport?: PJeTransport) {}

  isConfigured(config: Record<string, unknown> | null): boolean {
    const r = resolvePJeConfig(config);
    return Boolean(r.clientId && r.clientSecret && r.username && r.password);
  }

  async testConnection(config: Record<string, unknown>): Promise<CaptureTestResult> {
    const resolved = resolvePJeConfig(config);
    if (!resolved.clientId) {
      return { ok: false, message: 'PJe não configurado. Informe client_id, client_secret, username e password (env PJE_CLIENT_ID, PJE_CLIENT_SECRET, PJE_USERNAME, PJE_PASSWORD ou configuração da fonte).' };
    }
    try {
      const client = buildClient(resolved, this.transport);
      // Autentica e faz uma consulta mínima (lista processos com filtro vazio).
      await client.lookupByProcessNumber('');
      return { ok: true, message: 'PJe conectado e autenticado.', details: ['Autenticação OAuth2 validada.', 'Gateway PDPJ-Br respondendo.'] };
    } catch (err) {
      return { ok: false, message: safeMessage(err) };
    }
  }

  async fetch(config: Record<string, unknown>): Promise<CaptureFetchResult> {
    const resolved = resolvePJeConfig(config);
    const client = buildClient(resolved, this.transport);
    const processes: CaptureFetchResult['processes'] = [];
    const movements: CaptureFetchResult['movements'] = [];

    for (const number of resolved.processNumbers) {
      try {
        const header = await client.lookupByProcessNumber(number);
        if (!header) continue;
        const movs = await client.fetchMovements(header.id!);
        const enriched = { ...header, movimentos: movs };
        const normalized = normalizePJeProcess(enriched as Parameters<typeof normalizePJeProcess>[0]);
        processes.push(normalized.process);
        movements.push(...normalized.movements);
      } catch (err) {
        if (err instanceof PJeError) {
          if (err.code === PJE_ERROR_CODES.PROCESS_NOT_FOUND || err.code === PJE_ERROR_CODES.INVALID_NUMBER) continue;
          throw err;
        }
        throw err;
      }
    }
    return { processes, movements, publications: [] };
  }
}

/** Provider de descoberta do PJe — descoberta profissional NÃO suportada oficialmente. */
export class PJeDiscoveryProvider implements ProcessDiscoveryProvider {
  readonly source = 'PJE' as const;
  readonly mode = 'AUTHENTICATED' as const;
  readonly label = 'PJe (PDPJ-Br)';
  readonly implemented = true;
  private readonly adapter = new PJeCaptureAdapter();

  isConfigured(config: Record<string, unknown> | null): boolean {
    return this.adapter.isConfigured(config);
  }

  capabilities(): DiscoveryCapabilities {
    return {
      supportsProfessionalDiscovery: false,
      supportsProcessLookup: true,
      supportsMovements: true,
      supportsPublications: false,
      supportsDocuments: true,
      requiresAuthentication: true,
      supportedCourts: [],
      supportedSystems: ['PJe'],
    };
  }

  async discoverByProfessional(_identity: ProfessionalIdentityInput, _config: Record<string, unknown> | null): Promise<DiscoveryResult> {
    return {
      source: this.source,
      processes: [],
      error: {
        code: 'NO_PROFESSIONAL_DISCOVERY',
        message: 'O PJe não oferece descoberta de processos por advogado/OAB via API oficial. A associação deve usar consulta por número CNJ e confirmação humana.',
      },
    };
  }

  async testConnection(config: Record<string, unknown>): Promise<DiscoveryTestConnectionResult> {
    const r = await this.adapter.testConnection(config);
    return { ok: r.ok, message: r.message, details: r.details };
  }
}