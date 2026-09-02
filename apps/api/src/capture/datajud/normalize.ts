import { formatCNJ } from './cnj';
import type { ExternalMovement, ExternalProcess } from '../types';
import type { DataJudSource } from './types';

/**
 * Normaliza o documento `_source` do DataJud para o formato interno
 * (ExternalProcess / ExternalMovement) consumido pelo engine de captura.
 *
 * O payload original NÃO é armazenado integralmente: apenas campos úteis e
 * controlados são preservados em metadados.
 */

/** Converte datas do DataJud para Date (aceita os 3 formatos existentes). */
export function parseDataJudDate(value: unknown): Date | null {
  if (value == null) return null;
  if (typeof value === 'number') {
    if (value > 1e12) return new Date(value); // epoch ms
    return null;
  }
  if (typeof value !== 'string') return null;
  const str = value.trim();
  if (!str) return null;
  // 14 dígitos no formato YYYYMMDDHHmmss (horário de Brasília, UTC-3, sem DST).
  if (/^\d{14}$/.test(str)) {
    const y = Number(str.slice(0, 4));
    const m = Number(str.slice(4, 6));
    const d = Number(str.slice(6, 8));
    const h = Number(str.slice(8, 10));
    const min = Number(str.slice(10, 12));
    const s = Number(str.slice(12, 14));
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      // O instante corresponde ao horário local de Brasília (UTC-3):
      // UTC = local + 3h.
      return new Date(Date.UTC(y, m - 1, d, h, min, s) + 3 * 3600 * 1000);
    }
    return null;
  }
  const iso = new Date(str);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

function toIso(value: unknown): string | null {
  const d = parseDataJudDate(value);
  return d ? d.toISOString() : null;
}

interface DataJudMovementLike {
  codigo?: unknown;
  nome?: string | null;
  descricao?: string | null;
  dataHora?: unknown;
  complementosTabelados?: Array<{ codigo?: unknown; descricao?: string | null; nome?: string | null; valor?: unknown }> | null;
  movimentoNacional?: { codigo?: unknown; nome?: string | null } | null;
}

function movementDescription(mov: DataJudMovementLike): string {
  const base = (typeof mov.movimentoNacional?.nome === 'string' ? mov.movimentoNacional.nome : mov.nome) ?? 'Movimento';
  const extras = (mov.complementosTabelados ?? [])
    .map((c) => (typeof c.descricao === 'string' && c.descricao ? c.descricao : typeof c.nome === 'string' && c.nome ? c.nome : ''))
    .filter(Boolean);
  return extras.length > 0 ? `${base} — ${extras.join('; ')}` : base;
}

function movementReference(mov: DataJudMovementLike): string {
  const codigo = mov.movimentoNacional?.codigo ?? mov.codigo;
  const stamp = mov.dataHora != null ? String(mov.dataHora) : '';
  return `datajud-mov-${String(codigo ?? '?')}-${stamp}`;
}

export interface NormalizedDataJudResult {
  process: ExternalProcess;
  movements: ExternalMovement[];
  metadata: Record<string, unknown>;
}

/** Converte um documento DataJud em ExternalProcess + movimentações. */
export function normalizeDataJudSource(raw: DataJudSource | Record<string, unknown>): NormalizedDataJudResult {
  const source = (raw ?? {}) as DataJudSource;
  const digits = typeof source.numeroProcesso === 'string' ? source.numeroProcesso.replace(/\D/g, '') : '';
  const mask = formatCNJ(digits) ?? digits;

  const classe = source.classe ?? null;
  const sistema = source.sistema ?? null;
  const orgao = source.orgaoJulgador ?? null;
  const tribunal = typeof source.tribunal === 'string' ? source.tribunal : '';

  const movimentosRaw = Array.isArray(source.movimentos) ? (source.movimentos as unknown as DataJudMovementLike[]) : [];
  const movements = movimentosRaw.map((m) => {
    const date = toIso(m.dataHora);
    return {
      processNumber: mask,
      date,
      description: movementDescription(m),
      sourceReference: movementReference(m),
    } as ExternalMovement;
  });

  const className = typeof classe?.nome === 'string' ? classe.nome : null;
  const systemName = typeof sistema?.nome === 'string' ? sistema.nome : null;
  const lastMovement = movements.length > 0 ? movements[movements.length - 1] : undefined;

  const process: ExternalProcess = {
    processNumber: mask,
    title: className ? `${className}` : `Processo ${mask}`,
    court: tribunal || undefined,
    area: systemName ?? undefined,
    parties: undefined,
  };

  const metadata: Record<string, unknown> = {
    dataJud: {
      id: source.id ?? null,
      tribunal: source.tribunal ?? null,
      grau: source.grau ?? null,
      nivelSigilo: source.nivelSigilo ?? null,
      classe: classe ? { codigo: classe.codigo ?? null, nome: className } : null,
      sistema: sistema ? { codigo: sistema.codigo ?? null, nome: systemName } : null,
      orgaoJulgador: orgao ? { codigo: orgao.codigo ?? null, nome: orgao.nome ?? null } : null,
      dataAjuizamento: toIso(source.dataAjuizamento),
      dataHoraUltimaAtualizacao: toIso(source.dataHoraUltimaAtualizacao),
      lastMovementAt: lastMovement ? lastMovement.date : null,
      movementCount: movements.length,
    },
  };

  return { process, movements, metadata };
}
