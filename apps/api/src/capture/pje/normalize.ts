import { formatCNJ } from '../datajud/cnj';
import type { ExternalComplement, ExternalMovement, ExternalProcess, ExternalSubject } from '../types';
import type { PJeProcessoHeader, PJeMovimento } from './types';

/**
 * Normaliza o processo/movimentos da API do PJe (PDPJ-Br) para o formato
 * interno (ExternalProcess / ExternalMovement) consumido pelo engine de captura.
 *
 * ETAPA 12A — camada canônica:
 *  - preserva classe, grau, datas de ajuizamento/atualização e estrutura das
 *    movimentações (tipoMovimento.codigo/nome + complementosTabelados);
 *  - judicialSystem = "PJe" (identidade da fonte; não é inventado);
 *  - área jurídica NÃO é inferida (PJe não a fornece);
 *  - valor disponível → preenche; indisponível → null/ausente. Nunca inventa.
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

function codeOf(value: { codigo?: string | number | null } | null | undefined): string | null {
  if (!value || value.codigo == null) return null;
  return String(value.codigo);
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

function movementComplements(mov: PJeMovimento): ExternalComplement[] | null {
  const list = mov.complementosTabelados ?? [];
  if (list.length === 0) return null;
  return list.map((c) => ({
    code: codeOf(c),
    value: c.valor != null ? String(c.valor) : null,
    name: c.nome ?? null,
    description: c.descricao ?? null,
  }));
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
  const movements = movimentosRaw.map((m) => {
    const date = parsePJeDate(m.dataHora ?? m.data);
    return {
      processNumber: mask,
      date,
      occurredAt: date,
      description: movementDescription(m),
      sourceReference: movementReference(m),
      code: codeOf(m.tipoMovimento),
      name: nameOf(m.tipoMovimento) ?? m.nome ?? null,
      complements: movementComplements(m),
      metadata: m.usuario ? { usuario: m.usuario } : undefined,
    } as ExternalMovement;
  });

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
    classCode: classe?.codigo ?? null,
    className,
    judicialSystem: 'PJe',
    judicialSystemCode: null,
    degree: source.grau ?? null,
    filingDate: parsePJeDate(source.dataAjuizamento),
    sourceLastUpdatedAt: parsePJeDate(source.dataHoraUltimaAtualizacao),
    subjects: normalizePJeSubjects(source.assunto),
    courtName: nameOf(orgao),
    courtCode: codeOf(orgao),
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
      assunto: source.assunto ?? null,
      dataAjuizamento: parsePJeDate(source.dataAjuizamento),
      dataHoraUltimaAtualizacao: parsePJeDate(source.dataHoraUltimaAtualizacao),
      lastMovementAt: lastMovement ? lastMovement.date : null,
      movementCount: movements.length,
    },
  };

  return { process, movements, metadata };
}

/**
 * Normaliza assunto do PJe (string simples) para a mesma representação canônica
 * de subjects (array [{code?, name?}]) usada por DataJud e futuras fontes.
 */
function normalizePJeSubjects(assunto: string | null | undefined): ExternalSubject[] | null {
  if (!assunto || !assunto.trim()) return null;
  return [{ code: null, name: assunto.trim() }];
}
