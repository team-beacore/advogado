import { formatCNJ } from '../datajud/cnj';
import type { ExternalMovement, ExternalProcess } from '../types';
import type { PJeProcessoHeader, PJeMovimento } from './types';

/**
 * Normaliza o processo/movimentos da API do PJe (PDPJ-Br) para o formato
 * interno (ExternalProcess / ExternalMovement) consumido pelo engine de captura.
 *
 * Campos de identidade da fonte (numeroProcesso, id, dataHora do movimento)
 * são preservados para garantir idempotência via source_reference.
 */

/** Converte datas do PJe para ISO. Aceita ISO 8601 ou timestamp epoch ms. */
export function parsePJeDate(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'number') {
    if (value > 1e12) {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    return null;
  }
  if (typeof value !== 'string') return null;
  const str = value.trim();
  if (!str) return null;
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function nameOf(value: { nome?: string | null; descricao?: string | null } | null | undefined): string | null {
  if (!value) return null;
  return value.nome ?? value.descricao ?? null;
}

function movementDescription(mov: PJeMovimento): string {
  const base = nameOf(mov.tipoMovimento) ?? mov.nome ?? 'Movimento';
  const extras = (mov.complementosTabelados ?? [])
    .map((c) => nameOf(c))
    .filter((x): x is string => Boolean(x));
  return extras.length > 0 ? `${base} — ${extras.join('; ')}` : base;
}

function movementReference(mov: PJeMovimento): string {
  const id = mov.id ?? '';
  const stamp = mov.dataHora ?? mov.data ?? '';
  return `pje-mov-${String(id)}-${String(stamp)}`;
}

export interface NormalizedPJeResult {
  process: ExternalProcess;
  movements: ExternalMovement[];
  metadata: Record<string, unknown>;
}

/** Converte um processo do PJe em ExternalProcess + movimentações. */
export function normalizePJeProcess(raw: PJeProcessoHeader): NormalizedPJeResult {
  const source = raw ?? {};
  const digits = (source.numeroProcesso ?? source.numeroUnico ?? '').toString().replace(/\D/g, '');
  const mask = formatCNJ(digits) ?? source.numero ?? digits;

  const classe = source.classe ?? null;
  const orgao = source.orgaoJulgador ?? null;
  const tribunal = source.tribunal ?? null;

  const movimentosRaw = Array.isArray(source.movimentos) ? source.movimentos : [];
  const movements = movimentosRaw.map((m) => ({
    processNumber: mask,
    date: parsePJeDate(m.dataHora ?? m.data),
    description: movementDescription(m),
    sourceReference: movementReference(m),
  } as ExternalMovement));

  const className = nameOf(classe);
  const lastMovement = movements.length > 0 ? movements[movements.length - 1] : undefined;
  const parties = Array.isArray(source.partes)
    ? source.partes.map((p) => p.nome).filter((x): x is string => Boolean(x))
    : undefined;

  const process: ExternalProcess = {
    processNumber: mask,
    title: className ? `${className}` : `Processo ${mask}`,
    court: tribunal || undefined,
    area: undefined,
    parties,
  };

  const metadata: Record<string, unknown> = {
    pje: {
      id: source.id ?? null,
      tribunal,
      grau: source.grau ?? null,
      nivelSigilo: source.nivelSigilo ?? null,
      sigilo: source.sigilo ?? null,
      classe: classe ? { codigo: classe.codigo ?? null, nome: className } : null,
      orgaoJulgador: orgao ? { codigo: orgao.codigo ?? null, nome: nameOf(orgao) } : null,
      dataAjuizamento: parsePJeDate(source.dataAjuizamento),
      dataHoraUltimaAtualizacao: parsePJeDate(source.dataHoraUltimaAtualizacao),
      lastMovementAt: lastMovement ? lastMovement.date : null,
      movementCount: movements.length,
    },
  };

  return { process, movements, metadata };
}
