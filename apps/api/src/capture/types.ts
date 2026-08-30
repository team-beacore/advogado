export interface CapturedPublication {
  processNumber: string;
  source: string; // 'PJE' | 'ESAJ' | 'PROJUDI'
  content: string;
  publicationDate?: string | null;
  availabilityDate?: string | null;
  externalReference?: string | null;
  possibleDueDate?: string | null;
  notes?: string | null;
}

export interface CaptureAdapter {
  readonly name: 'PJE' | 'ESAJ' | 'PROJUDI';
  isConfigured(config: Record<string, unknown> | null): boolean;
  fetch(config: Record<string, unknown>): Promise<CapturedPublication[]>;
}
