import type { DiscoveredProcess, DiscoveredMovement, DiscoveredPublication } from './types';
import type { DiscoveryConfidence } from '@advogado/shared';

/**
 * ETAPA 6 — Agregação de descoberta multi-fonte.
 *
 * Quando mais de uma fonte encontra o mesmo processo, o resultado final deve
 * ser UM processo com a lista de fontes (ex.: [DJEN, DataJud]).
 * A chave de deduplicação é o número CNJ normalizado quando aplicável.
 */

const CONFIDENCE_ORDER: Record<DiscoveryConfidence, number> = { HIGH: 4, MEDIUM: 3, LOW: 2, UNKNOWN: 1 };

/** Normaliza o número CNJ para usar como chave de deduplicação. */
function normalizeKey(processNumber: string): string {
  const digits = processNumber.replace(/\D/g, '');
  if (digits.length === 20) return digits;
  return processNumber.trim().toLowerCase();
}

function pickConfidence(a: DiscoveryConfidence | undefined, b: DiscoveryConfidence | undefined): DiscoveryConfidence {
  if (!a) return b ?? 'UNKNOWN';
  if (!b) return a;
  return CONFIDENCE_ORDER[a] >= CONFIDENCE_ORDER[b] ? a : b;
}

function mergeMovements(a: DiscoveredMovement[] | undefined, b: DiscoveredMovement[] | undefined): DiscoveredMovement[] | undefined {
  const merged = new Map<string, DiscoveredMovement>();
  for (const m of [...(a ?? []), ...(b ?? [])]) {
    const key = m.sourceReference ?? `${m.description}-${m.date ?? ''}`;
    if (!merged.has(key)) merged.set(key, m);
  }
  return merged.size > 0 ? [...merged.values()] : undefined;
}

function mergePublications(a: DiscoveredPublication[] | undefined, b: DiscoveredPublication[] | undefined): DiscoveredPublication[] | undefined {
  const merged = new Map<string, DiscoveredPublication>();
  for (const p of [...(a ?? []), ...(b ?? [])]) {
    const key = p.externalReference ?? p.content;
    if (!merged.has(key)) merged.set(key, p);
  }
  return merged.size > 0 ? [...merged.values()] : undefined;
}

/**
 * Agrega processos de múltiplas fontes, deduplicando por número CNJ e
 * unificando sources/confidence/movimentos/publicações.
 * Nunca inventa resultados: apenas combina o que cada fonte retornou.
 */
export function aggregateProcesses(processes: DiscoveredProcess[]): DiscoveredProcess[] {
  const map = new Map<string, DiscoveredProcess>();

  for (const p of processes) {
    if (!p.processNumber) continue;
    const key = normalizeKey(p.processNumber);
    const existing = map.get(key);

    if (!existing) {
      map.set(key, { ...p, sources: [p.source], confidence: p.confidence ?? 'UNKNOWN' });
      continue;
    }

    const sources = [...new Set([...(existing.sources ?? []), p.source])];
    existing.sources = sources;
    existing.confidence = pickConfidence(existing.confidence, p.confidence);
    existing.movements = mergeMovements(existing.movements, p.movements);
    existing.publications = mergePublications(existing.publications, p.publications);
    if (!existing.title && p.title) existing.title = p.title;
    if (!existing.court && p.court) existing.court = p.court;
    if (!existing.courtCode && p.courtCode) existing.courtCode = p.courtCode;
    if (!existing.class && p.class) existing.class = p.class;
    if (!existing.lastMovementAt && p.lastMovementAt) existing.lastMovementAt = p.lastMovementAt;
    if (!existing.lastMovement && p.lastMovement) existing.lastMovement = p.lastMovement;
    existing.metadata = { ...(existing.metadata ?? {}), ...(p.metadata ?? {}), sources };
  }

  return [...map.values()];
}

export { normalizeKey, pickConfidence };
