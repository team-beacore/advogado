import type { CaptureMode, CaptureSource } from './types';

/**
 * Forma normalizada de um processo que o domínio interno consome.
 * O restante da aplicação nunca depende do formato original da fonte.
 */
export interface NormalizedProcess {
  processNumber: string;
  title: string;
  court?: string | null;
  area?: string | null;
  parties?: string[] | null;
  source: CaptureSource;
  mode: CaptureMode;
}

export interface NormalizedMovement {
  processNumber: string;
  date?: string | null;
  description: string;
  source: CaptureSource;
  sourceReference?: string | null;
}

export interface NormalizedPublication {
  processNumber: string;
  content: string;
  publicationDate?: string | null;
  availabilityDate?: string | null;
  externalReference?: string | null;
  possibleDueDate?: string | null;
  notes?: string | null;
  source: CaptureSource;
  mode: CaptureMode;
}

/**
 * Camada de normalização: converte o formato externo de uma fonte
 * em um formato canônico independente da origem.
 */
export class ProcessNormalizer {
  constructor(private readonly source: CaptureSource, private readonly mode: CaptureMode) {}

  process(input: { processNumber: string; title?: string | null; court?: string | null; area?: string | null; parties?: string[] | null }): NormalizedProcess {
    return {
      processNumber: input.processNumber.trim(),
      title: input.title?.trim() || `Processo ${input.processNumber}`,
      court: input.court ?? null,
      area: input.area ?? null,
      parties: input.parties ?? null,
      source: this.source,
      mode: this.mode,
    };
  }

  movement(input: { processNumber: string; date?: string | null; description: string; sourceReference?: string | null }): NormalizedMovement {
    return {
      processNumber: input.processNumber.trim(),
      date: input.date ?? null,
      description: input.description,
      source: this.source,
      sourceReference: input.sourceReference ?? null,
    };
  }

  publication(input: {
    processNumber: string;
    content: string;
    publicationDate?: string | null;
    availabilityDate?: string | null;
    externalReference?: string | null;
    possibleDueDate?: string | null;
    notes?: string | null;
  }): NormalizedPublication {
    return {
      processNumber: input.processNumber.trim(),
      content: input.content,
      publicationDate: input.publicationDate ?? null,
      availabilityDate: input.availabilityDate ?? null,
      externalReference: input.externalReference ?? null,
      possibleDueDate: input.possibleDueDate ?? null,
      notes: input.notes ?? null,
      source: this.source,
      mode: this.mode,
    };
  }
}
