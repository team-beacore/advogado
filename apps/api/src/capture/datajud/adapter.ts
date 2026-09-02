import { getEnv } from '../../config';
import type { CaptureAdapter, CaptureFetchResult, CaptureTestResult } from '../types';
import type {
  DiscoveryCapabilities,
  DiscoveryResult,
  DiscoveryTestConnectionResult,
  ProcessDiscoveryProvider,
  ProfessionalIdentityInput,
} from '../discovery/types';
import { DataJudClient } from './client';
import type { DataJudTransport } from './client';
import { resolveCourtFromProcessNumber, parseCNJ } from './cnj';
import { normalizeDataJudSource } from './normalize';
import { DATAJUD_ERROR_CODES, DataJudError } from './errors';

/**
 * Integração real com a API Pública do DataJud (CNJ).
 *
 * Capacidade real: consulta de processos por número CNJ (supportsProcessLookup).
 * O DataJud NÃO permite descoberta por advogado/OAB — isso nunca é prometido.
 *
 * A chave de acesso é resolvida de forma segura (settings ou env) e nunca é
 * exposta em respostas, logs, audit_logs ou captura_runs.
 */

export const DEFAULT_DATAJUD_BASE_URL = 'https://api-publica.datajud.cnj.jus.br';
export const DEFAULT_DATAJUD_TIMEOUT_MS = 35000;

export interface ResolvedDataJudConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  processNumbers: string[];
  enabled: boolean;
}

/**
 * Resolve a configuração efetiva do DataJud.
 * Prioridade: settings (config) → env.
 * Suporta `apiKey` (novo) e `password` (compatível com saveSourceConfig existente).
 */
export function resolveDataJudConfig(config: Record<string, unknown> | null): ResolvedDataJudConfig {
  const env = getEnv();
  const c = config ?? {};
  const apiKey = (typeof c.apiKey === 'string' && c.apiKey)
    || (typeof c.password === 'string' && c.password)
    || env.DATAJUD_API_KEY
    || '';
  const baseUrl = (typeof c.baseUrl === 'string' && c.baseUrl) || env.DATAJUD_BASE_URL || DEFAULT_DATAJUD_BASE_URL;
  const timeoutMs = (typeof c.timeoutMs === 'number' && c.timeoutMs > 0)
    ? c.timeoutMs
    : env.DATAJUD_TIMEOUT_MS || DEFAULT_DATAJUD_TIMEOUT_MS;
  const processNumbers = Array.isArray(c.processNumbers)
    ? c.processNumbers.filter((n): n is string => typeof n === 'string' && n.length > 0)
    : [];
  const enabled = c.enabled !== false;
  return { apiKey, baseUrl, timeoutMs, processNumbers, enabled };
}

function buildClient(config: ResolvedDataJudConfig, transport?: DataJudTransport): DataJudClient {
  if (!config.apiKey) throw new DataJudError(DATAJUD_ERROR_CODES.NOT_CONFIGURED);
  return new DataJudClient({ baseUrl: config.baseUrl, apiKey: config.apiKey, timeoutMs: config.timeoutMs, transport });
}

function safeMessage(err: unknown): string {
  if (err instanceof DataJudError) return err.message;
  return 'Falha ao consultar o DataJud.';
}

/**
 * Consulta um único processo por número CNJ (chamada HTTP real).
 * Retorna o documento normalizado ou null quando não encontrado.
 * `transport` é usado somente em testes (mock do transporte HTTP).
 */
export async function lookupDataJudProcess(
  processNumber: string,
  config: Record<string, unknown> | null,
  transport?: DataJudTransport,
): Promise<ReturnType<typeof normalizeDataJudSource> | null> {
  const parsed = parseCNJ(processNumber);
  if (!parsed) throw new DataJudError(DATAJUD_ERROR_CODES.INVALID_NUMBER);
  const court = resolveCourtFromProcessNumber(parsed.digits);
  if (!court) throw new DataJudError(DATAJUD_ERROR_CODES.COURT_NOT_SUPPORTED);

  const resolved = resolveDataJudConfig(config);
  const client = buildClient(resolved, transport);
  const envelope = await client.search(court.sigla, { query: { match: { numeroProcesso: parsed.digits } } });
  const source = DataJudClient.firstSource(envelope);
  if (!source) return null;
  return normalizeDataJudSource(source);
}

/**
 * Adapter de captura REAL do DataJud.
 * Substitui o placeholder NotImplementedAdapter. Executa chamadas HTTP reais.
 */
export class DataJudCaptureAdapter implements CaptureAdapter {
  readonly source = 'DATAJUD' as const;
  readonly mode = 'PUBLIC' as const;
  readonly label = 'DataJud';
  readonly implemented = true;

  constructor(private readonly transport?: DataJudTransport) {}

  isConfigured(config: Record<string, unknown> | null): boolean {
    return Boolean(resolveDataJudConfig(config).apiKey);
  }

  async testConnection(config: Record<string, unknown>): Promise<CaptureTestResult> {
    const resolved = resolveDataJudConfig(config);
    if (!resolved.apiKey) {
      return { ok: false, message: 'DataJud não configurado. Informe a chave de acesso (env DATAJUD_API_KEY ou configuração da fonte).' };
    }
    try {
      const client = buildClient(resolved, this.transport);
      // Chamada real mínima: valida endpoint, autenticação e formato de resposta.
      await client.search('trf1', { size: 1, query: { match_all: {} } });
      return { ok: true, message: 'DataJud conectado e autenticado.', details: ['Chamada real validada no endpoint público'] };
    } catch (err) {
      return { ok: false, message: safeMessage(err) };
    }
  }

  /**
   * Consulta os números de processo fornecidos em config.processNumbers.
   * Retorna processos + movimentações normalizados (não cria Case aqui).
   * Erros por processo (não encontrado / tribunal não suportado) são ignorados;
   * erros sistêmicos (auth/timeout/indisponível) são propagados.
   */
  async fetch(config: Record<string, unknown>): Promise<CaptureFetchResult> {
    const resolved = resolveDataJudConfig(config);
    const client = buildClient(resolved, this.transport);

    const processes: CaptureFetchResult['processes'] = [];
    const movements: CaptureFetchResult['movements'] = [];

    for (const number of resolved.processNumbers) {
      let parsed: ReturnType<typeof parseCNJ>;
      try {
        parsed = parseCNJ(number);
        if (!parsed) continue;
      } catch {
        continue;
      }
      const court = resolveCourtFromProcessNumber(parsed.digits);
      if (!court) continue; // tribunal não suportado — não tenta endpoints aleatórios
      try {
        const envelope = await client.search(court.sigla, { query: { match: { numeroProcesso: parsed.digits } } });
        const source = DataJudClient.firstSource(envelope);
        if (!source) continue; // processo não encontrado — resultado legítimo
        const normalized = normalizeDataJudSource(source);
        processes.push(normalized.process);
        movements.push(...normalized.movements);
      } catch (err) {
        if (err instanceof DataJudError) {
          const code = err.code;
          if (code === DATAJUD_ERROR_CODES.COURT_NOT_SUPPORTED || code === DATAJUD_ERROR_CODES.NOT_FOUND) continue;
          throw err;
        }
        throw err;
      }
    }

    return { processes, movements, publications: [] };
  }
}

/** Provider de descoberta do DataJud (implementado, mas sem descoberta por profissional). */
export class DataJudDiscoveryProvider implements ProcessDiscoveryProvider {
  readonly source = 'DATAJUD' as const;
  readonly mode = 'PUBLIC' as const;
  readonly label = 'DataJud';
  readonly implemented = true;
  private readonly adapter = new DataJudCaptureAdapter();

  isConfigured(config: Record<string, unknown> | null): boolean {
    return this.adapter.isConfigured(config);
  }

  capabilities(): DiscoveryCapabilities {
    return {
      supportsProfessionalDiscovery: false,
      supportsProcessLookup: true,
      supportsMovements: true,
      supportsPublications: false,
      supportsDocuments: false,
      requiresAuthentication: true,
      supportedCourts: [],
      supportedSystems: [],
    };
  }

  async discoverByProfessional(_identity: ProfessionalIdentityInput, _config: Record<string, unknown> | null): Promise<DiscoveryResult> {
    return {
      source: this.source,
      processes: [],
      error: {
        code: 'NO_PROFESSIONAL_DISCOVERY',
        message: 'O DataJud não oferece descoberta de processos por advogado/OAB. A associação deve usar consulta por número CNJ e confirmação humana.',
      },
    };
  }

  async testConnection(config: Record<string, unknown>): Promise<DiscoveryTestConnectionResult> {
    const r = await this.adapter.testConnection(config);
    return { ok: r.ok, message: r.message, details: r.details };
  }
}
