import { errors } from '../errors';
import type { CaptureAdapter, CaptureFetchResult, CaptureTestResult } from './types';
import { DemoCaptureAdapter } from './demo';
import { DataJudCaptureAdapter } from './datajud/adapter';

/**
 * Adapters de tribunais autenticados (PJe, e-SAJ, Projudi) e fonte pública (DataJud).
 *
 * DataJud: integração real implementada (consulta por número CNJ), chamadas HTTP reais.
 * PJe/e-SAJ/PROJUDI: ainda NÃO possuem implementação real validada contra os sistemas
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
    readonly source: 'PJE' | 'ESAJ' | 'PROJUDI',
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

const pjeAdapter = new NotImplementedAdapter('PJE', 'AUTHENTICATED', 'PJe');
const esajAdapter = new NotImplementedAdapter('ESAJ', 'AUTHENTICATED', 'e-SAJ');
const projudiAdapter = new NotImplementedAdapter('PROJUDI', 'AUTHENTICATED', 'Projudi');

export { dataJudAdapter, pjeAdapter, esajAdapter, projudiAdapter };
export const demoCaptureAdapter = new DemoCaptureAdapter();
