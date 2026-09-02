import type { CaptureMode, CaptureSource } from '@advogado/shared';
import type { DiscoveryConfidence } from '@advogado/shared';

/**
 * ETAPA 3+6 — Abstrações de descoberta de processos.
 *
 * A descoberta é separada em três conceitos (que não devem ser misturados):
 *   A) DESCOBERTA  — encontrar processos vinculados a um advogado;
 *   B) IMPORTAÇÃO  — transformar processo descoberto em Case da Plataforma;
 *   C) MONITORAMENTO — continuar verificando alterações em processos importados.
 *
 * Nenhuma capacidade declarada aqui é "inventada": cada provider declara somente
 * o que a fonte realmente oferece, comprovado por documentação oficial e/ou
 * chamada real.
 */

/** Identidade profissional usada como critério de consulta em fontes judiciais. */
export interface ProfessionalIdentityInput {
  id: string;
  professionalName: string;
  oabNumber: string;
  oabState: string;
  identifiers?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Capacidades reais de uma fonte para descoberta.
 * IMPORTANTE: nunca declarar `true` sem implementação real e validada.
 */
export interface DiscoveryCapabilities {
  /** A fonte permite encontrar processos pelo profissional (OAB/advogado)? */
  supportsProfessionalDiscovery: boolean;
  /** A fonte permite consultar um processo específico (por número)? */
  supportsProcessLookup: boolean;
  supportsMovements: boolean;
  supportsPublications: boolean;
  supportsDocuments: boolean;
  requiresAuthentication: boolean;
  /** Tribunais efetivamente suportados pela integração real (vazio = nenhum validado). */
  supportedCourts: string[];
  /** Sistemas processuais efetivamente suportados (PJe, e-SAJ, PROJUDI, eproc...). */
  supportedSystems: string[];
}

/** Movimentação descoberta em uma fonte. */
export interface DiscoveredMovement {
  date?: string | null;
  description: string;
  sourceReference?: string | null;
}

/** Publicação/intimação descoberta em uma fonte. */
export interface DiscoveredPublication {
  content: string;
  publicationDate?: string | null;
  availabilityDate?: string | null;
  externalReference?: string | null;
  possibleDueDate?: string | null;
  notes?: string | null;
}

/** Processo descoberto (ainda não importado). */
export interface DiscoveredProcess {
  source: CaptureSource;
  processNumber: string;
  court?: string | null;
  courtCode?: string | null;
  judicialSystem?: string | null;
  externalProcessId?: string | null;
  title?: string | null;
  area?: string | null;
  class?: string | null;
  subjects?: string[] | null;
  lastMovement?: string | null;
  lastMovementAt?: string | null;
  parties?: string[] | null;
  movements?: DiscoveredMovement[];
  publications?: DiscoveredPublication[];
  /** Confiança explicável do resultado. */
  confidence?: DiscoveryConfidence;
  /** Fontes que encontraram o mesmo processo (agregação multi-fonte). */
  sources?: CaptureSource[];
  metadata?: Record<string, unknown>;
}

/** Resultado de uma consulta de descoberta em uma fonte. */
export interface DiscoveryResult {
  source: CaptureSource;
  processes: DiscoveredProcess[];
  error?: { code: string; message: string } | null;
}

/** Resultado de um teste de conexão real (não considera config salva como conectado). */
export interface DiscoveryTestConnectionResult {
  ok: boolean;
  message: string;
  details?: string[];
}

/** Modo (público/autenticado/demo) de uma fonte de descoberta. */
export type { CaptureMode, CaptureSource };

/**
 * Contrato de um provider de descoberta de processos.
 * Cada fonte implementa apenas as operações que realmente oferece.
 */
export interface ProcessDiscoveryProvider {
  readonly source: CaptureSource;
  readonly mode: CaptureMode;
  readonly label: string;
  /** true se existe implementação real (não é placeholder). */
  readonly implemented: boolean;
  isConfigured(config: Record<string, unknown> | null): boolean;
  capabilities(): DiscoveryCapabilities;
  /** Descobre processos vinculados à identidade profissional do advogado. */
  discoverByProfessional(identity: ProfessionalIdentityInput, config: Record<string, unknown> | null): Promise<DiscoveryResult>;
  testConnection(config: Record<string, unknown>): Promise<DiscoveryTestConnectionResult>;
}

/**
 * Resultado de uma etapa de descoberta em um provider, usado pelo DiscoveryRouter.
 */
export interface DiscoveryProviderStep {
  provider: ProcessDiscoveryProvider;
  status: 'OK' | 'SKIPPED' | 'FAILED';
  reason?: string;
  processes?: DiscoveredProcess[];
  error?: { code: string; message: string } | null;
}

export type { DiscoveryConfidence };
