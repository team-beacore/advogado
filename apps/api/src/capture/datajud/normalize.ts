import { formatCNJ } from './cnj';
import type { ExternalComplement, ExternalMovement, ExternalProcess, ExternalSubject } from '../types';
import type { DataJudSource } from './types';

/**
 * Normaliza o documento `_source` do DataJud para o formato interno
 * (ExternalProcess / ExternalMovement) consumido pelo engine de captura.
 *
 * ETAPA 12A — correção da normalização:
 *  - assuntos, formato, código municipal do órgão julgador e estrutura das
 *    movimentações (codigo/nome/complementosTabelados) NÃO são mais descartados;
 *  - o payload útil é promovido a campos canônicos (class_code/name, degree,
 *    filing_date, source_last_updated_at, judicial_system) ou preservado em
 *    metadata.dataJud;
 *  - nenhum dado é inventado: valor disponível → preenche; indisponível → null/ausente.
 *
 * O payload original NÃO é armazenado integralmente (LGPD/tamanho/segurança):
 * apenas os dados relevantes sobrevivem no modelo normalizado + metadata.
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
  id?: unknown;
  codigo?: unknown;
  nome?: string | null;
  descricao?: string | null;
  dataHora?: unknown;
  complementosTabelados?: Array<{ codigo?: unknown; descricao?: string | null; nome?: string | null; valor?: unknown }> | null;
  movimentoNacional?: { codigo?: unknown; nome?: string | null } | null;
}

function codeToStr(value: unknown): string | null {
  if (value == null) return null;
  return String(value);
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

function movementComplements(mov: DataJudMovementLike): ExternalComplement[] | null {
  const list = mov.complementosTabelados ?? [];
  if (list.length === 0) return null;
  return list.map((c) => ({
    code: codeToStr(c.codigo),
    value: c.valor != null ? String(c.valor) : null,
    name: c.nome ?? null,
    description: c.descricao ?? null,
  }));
}

/** Normaliza assuntos (preservando codigo + nome). Nunca descarta. */
function normalizeSubjects(raw: unknown): ExternalSubject[] | null {
  if (!Array.isArray(raw)) return null;
  const subjects: ExternalSubject[] = [];
  for (const s of raw) {
    const obj = (typeof s === 'object' && s !== null ? s : {}) as Record<string, unknown>;
    const name = typeof obj.nome === 'string' && obj.nome ? obj.nome : null;
    const code = codeToStr(obj.codigo);
    if (!name && !code) continue;
    subjects.push({ code, name });
  }
  return subjects.length > 0 ? subjects : null;
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
  const formato = source.formato ?? null;
  const orgao = source.orgaoJulgador ?? null;
  const tribunal = typeof source.tribunal === 'string' ? source.tribunal : '';

  const movimentosRaw = Array.isArray(source.movimentos) ? (source.movimentos as unknown as DataJudMovementLike[]) : [];
  const movements = movimentosRaw.map((m) => {
    const date = toIso(m.dataHora);
    const baseName = typeof m.movimentoNacional?.nome === 'string' ? m.movimentoNacional.nome : m.nome;
    const baseCode = m.movimentoNacional?.codigo ?? m.codigo;
    return {
      processNumber: mask,
      date,
      occurredAt: date,
      description: movementDescription(m),
      sourceReference: movementReference(m),
      code: codeToStr(baseCode),
      name: baseName ?? null,
      complements: movementComplements(m),
      metadata: m.movimentoNacional ? { movimentoNacional: { codigo: codeToStr(m.movimentoNacional.codigo), nome: m.movimentoNacional.nome ?? null } } : undefined,
    } as ExternalMovement;
  });

  const className = typeof classe?.nome === 'string' ? classe.nome : null;
  const systemName = typeof sistema?.nome === 'string' ? sistema.nome : null;
  const subjects = normalizeSubjects(source.assuntos);
  const lastMovement = movements.length > 0 ? movements[movements.length - 1] : undefined;

  const process: ExternalProcess = {
    processNumber: mask,
    title: className ? `${className}` : `Processo ${mask}`,
    court: tribunal || undefined,
    // area NÃO recebe sistema processual (semântica de área jurídica).
    area: undefined,
    classCode: classe?.codigo ?? null,
    className,
    judicialSystem: systemName,
    judicialSystemCode: sistema?.codigo ?? null,
    degree: source.grau ?? null,
    filingDate: toIso(source.dataAjuizamento),
    sourceLastUpdatedAt: toIso(source.dataHoraUltimaAtualizacao),
    subjects,
    courtName: typeof orgao?.nome === 'string' ? orgao.nome : null,
    courtCode: orgao?.codigo ?? null,
    courtCityCode: orgao?.codigoMunicipioIBGE ?? null,
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
      formato: formato ? { codigo: formato.codigo ?? null, nome: formato.nome ?? null } : null,
      orgaoJulgador: orgao
        ? { codigo: orgao.codigo ?? null, nome: orgao.nome ?? null, codigoMunicipioIBGE: orgao.codigoMunicipioIBGE ?? null }
        : null,
      assuntos: subjects,
      dataAjuizamento: toIso(source.dataAjuizamento),
      dataHoraUltimaAtualizacao: toIso(source.dataHoraUltimaAtualizacao),
      lastMovementAt: lastMovement ? lastMovement.date : null,
      movementCount: movements.length,
    },
  };

  return { process, movements, metadata };
}
