import type { CaptureMode, CaptureSource } from '@advogado/shared';

/**
 * Processo no formato da fonte externa (pré-normalização).
 */
export interface ExternalProcess {
  processNumber: string;
  title?: string | null;
  court?: string | null;
  area?: string | null;
  parties?: string[] | null;
}

/**
 * Movimentação no formato da fonte externa.
 */
export interface ExternalMovement {
  processNumber: string;
  date?: string | null;
  description: string;
  sourceReference?: string | null;
}

/**
 * Publicação/intimação no formato da fonte externa.
 */
export interface ExternalPublication {
  processNumber: string;
  content: string;
  publicationDate?: string | null;
  availabilityDate?: string | null;
  externalReference?: string | null;
  possibleDueDate?: string | null;
  notes?: string | null;
}

/**
 * Resultado bruto de uma captura (ainda não normalizado para o domínio interno).
 */
export interface CaptureFetchResult {
  processes: ExternalProcess[];
  movements: ExternalMovement[];
  publications: ExternalPublication[];
}

/**
 * Resultado de um teste de conexão (real) com a fonte.
 */
export interface CaptureTestResult {
  ok: boolean;
  message: string;
  details?: string[];
}

/**
 * Contrato de um adapter de captura.
 * Cada fonte implementa apenas as operações que fazem sentido para a arquitetura.
 */
export interface CaptureAdapter {
  readonly source: CaptureSource;
  readonly mode: CaptureMode;
  readonly label: string;
  /** true se existe implementação real da integração (não é placeholder). */
  readonly implemented: boolean;
  isConfigured(config: Record<string, unknown> | null): boolean;
  testConnection(config: Record<string, unknown>): Promise<CaptureTestResult>;
  fetch(config: Record<string, unknown>): Promise<CaptureFetchResult>;
}

export type { CaptureMode, CaptureSource };
