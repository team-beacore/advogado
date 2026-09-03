import { errors } from '../errors';
import type { CaptureAdapter, CaptureFetchResult, CaptureTestResult } from './types';
import { DemoCaptureAdapter } from './demo';
import { DataJudCaptureAdapter } from './datajud/adapter';
import { PJeCaptureAdapter } from './pje/adapter';

/**
 * Adapters de tribunais autenticados (PJe, e-SAJ, Projudi) e fonte pública (DataJud).
 *
 * DataJud: integração real implementada (consulta por número CNJ), chamadas HTTP reais.
 * PJe: integração real implementada (API PDPJ-Br, OAuth2, REST), chamadas HTTP reais
 *      para a API oficial do PJe/PDPJ. Exige cliente OAuth2 registrado no CNJ.
 * e-SAJ/PROJUDI: ainda NÃO possuem implementação real validada contra os sistemas
 * oficiais. São declaradas na arquitetura (contrato + status honesto), mas
 * `implemented = false` — NUNCA fingem conexão ou retornam dados fictícios como reais.
 */

function externalUnavailable(message: string): never {
  throw errors.externalUnavailable(message);
}

/** Placeholder para fonte ainda não implementada de verdade. Nunca conecta. */
class NotImplementedAdapter implements CaptureAdapter {
  readonly implemented = false;

  constructor(
    readonly source: 'ESAJ' | 'PROJUDI',
    readonly mode: 'AUTHENTICATED',
    readonly label: string,
  ) {}

  isConfigured(_config: Record<string, unknown> | null): boolean {
    return false;
  }

  async testConnection(_config: Record<string, unknown>): Promise<CaptureTestResult> {
    return {
      ok: false,
      message: `Fonte ${this.label} ainda não implementada. Nenhuma conexão real foi estabelecida.`,
      details: ['Implementação de produção exige credenciais reais e validação contra o sistema oficial.'],
    };
  }

  async fetch(_config: Record<string, unknown>): Promise<CaptureFetchResult> {
    externalUnavailable(`Fonte ${this.label} ainda não implementada.`);
  }
}

/**
 * DataJud — fonte pública do CNJ.
 * Integração real: consulta por número CNJ com chamadas HTTP reais à API Pública.
 */
const dataJudAdapter = new DataJudCaptureAdapter();

/**
 * PJe — fonte autenticada (PDPJ-Br).
 * Integração real: API REST oficial do PJe com OAuth2 (Keycloak).
 * Exige client_id/client_secret cadastrados no CNJ + credenciais de usuário.
 */
const pjeAdapter = new PJeCaptureAdapter();

const esajAdapter = new NotImplementedAdapter('ESAJ', 'AUTHENTICATED', 'e-SAJ');
const projudiAdapter = new NotImplementedAdapter('PROJUDI', 'AUTHENTICATED', 'Projudi');

export { dataJudAdapter, pjeAdapter, esajAdapter, projudiAdapter };
export const demoCaptureAdapter = new DemoCaptureAdapter();
