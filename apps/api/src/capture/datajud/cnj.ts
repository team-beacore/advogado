import { DATAJUD_ERROR_CODES, DataJudError } from './errors';

/**
 * Número único de processo CNJ (Resolução CNJ nº 65/2008):
 *
 *   NNNNNNN-DD.AAAA.J.TR.OOOO
 *
 *   7 dígitos de sequência + 2 dígitos verificadores + 4 dígitos do ano
 *   + 1 dígito do segmento da justiça (J) + 2 dígitos do tribunal (TR)
 *   + 4 dígitos da origem. Total = 20 dígitos.
 */

export interface ParsedCNJ {
  /** 20 dígitos, sem máscara (usado na consulta ao DataJud). */
  digits: string;
  /** Formato mascarado canônico: NNNNNNN-DD.AAAA.J.TR.OOOO */
  mask: string;
  sequence: string;
  checkDigits: string;
  year: string;
  segment: string;
  tribunal: string;
  origin: string;
}

/** Códigos de tribunal (TR) → UF (Resolução CNJ nº 65/2008, Anexo). */
const TR_TO_UF: Record<string, string> = {
  '01': 'AC', '02': 'AL', '03': 'AM', '04': 'AP', '05': 'BA', '06': 'CE',
  '07': 'DF', '08': 'ES', '09': 'GO', '10': 'MA', '11': 'MG', '12': 'MS',
  '13': 'MT', '14': 'PA', '15': 'PB', '16': 'PE', '17': 'PI', '18': 'PR',
  '19': 'RJ', '20': 'RN', '21': 'RO', '22': 'RR', '23': 'RS', '24': 'SC',
  '25': 'SE', '26': 'SP', '27': 'TO',
};

/** Extrai apenas os 20 dígitos do número CNJ (aceita número com ou sem máscara). */
export function digitsOnly(input: string): string | null {
  const cleaned = String(input ?? '').replace(/\D/g, '');
  return cleaned.length === 20 ? cleaned : null;
}

/** Converte 20 dígitos no formato mascarado NNNNNNN-DD.AAAA.J.TR.OOOO. */
export function formatCNJ(digits: string): string | null {
  if (!/^\d{20}$/.test(digits)) return null;
  return `${digits.slice(0, 7)}-${digits.slice(7, 9)}.${digits.slice(9, 13)}.${digits.slice(13, 14)}.${digits.slice(14, 16)}.${digits.slice(16, 20)}`;
}

/**
 * Valida e normaliza um número de processo CNJ.
 * Não rejeita processos válidos por excesso de formatação (aceita qualquer
 * pontuação; extrai apenas os dígitos).
 */
export function parseCNJ(input: string): ParsedCNJ | null {
  const digits = digitsOnly(input);
  if (!digits) return null;
  const mask = formatCNJ(digits);
  if (!mask) return null;
  return {
    digits,
    mask,
    sequence: digits.slice(0, 7),
    checkDigits: digits.slice(7, 9),
    year: digits.slice(9, 13),
    segment: digits.slice(13, 14),
    tribunal: digits.slice(14, 16),
    origin: digits.slice(16, 20),
  };
}

export interface CourtResolution {
  /** Nome do tribunal, ex.: "TJRJ", "TRF1", "STJ". */
  court: string;
  /** Sigla usada no caminho do endpoint DataJud, ex.: "tjrj", "trf1", "tre-rj". */
  sigla: string;
  /** Segmento da justiça. */
  segment: string;
  /** Código do tribunal (TR). */
  tribunalCode: string;
  /** UF quando aplicável. */
  uf?: string;
}

/**
 * Resolve o tribunal a partir do número CNJ usando as regras oficiais do CNJ
 * (segmento J + código de tribunal TR).
 *
 * IMPORTANTE: STF (J=1) e CNJ (J=2) não integram a base pública do DataJud.
 * Para esses segmentos retorna `null` (tribunal não suportado).
 */
export function resolveCourtFromProcessNumber(input: string): CourtResolution | null {
  const parsed = parseCNJ(input);
  if (!parsed) throw new DataJudError(DATAJUD_ERROR_CODES.INVALID_NUMBER);

  const segment = parsed.segment;
  const tr = parsed.tribunal;

  // Segmentos que não integram o DataJud público.
  if (segment === '1' || segment === '2') return null;

  if (segment === '3') {
    if (tr !== '00') return null;
    return { court: 'STJ', sigla: 'stj', segment, tribunalCode: tr };
  }

  if (segment === '4') {
    const n = Number(tr);
    if (n < 1 || n > 6) return null;
    return { court: `TRF${n}`, sigla: `trf${n}`, segment, tribunalCode: tr };
  }

  if (segment === '5') {
    if (tr === '00') return { court: 'TST', sigla: 'tst', segment, tribunalCode: tr };
    const n = Number(tr);
    if (n < 1 || n > 24) return null;
    return { court: `TRT${n}`, sigla: `trt${n}`, segment, tribunalCode: tr };
  }

  if (segment === '6') {
    if (tr === '00') return { court: 'TSE', sigla: 'tse', segment, tribunalCode: tr };
    const uf = TR_TO_UF[tr];
    if (!uf) return null;
    return { court: `TRE-${uf}`, sigla: `tre-${uf.toLowerCase()}`, segment, tribunalCode: tr, uf };
  }

  if (segment === '7') {
    if (tr !== '00') return null;
    return { court: 'STM', sigla: 'stm', segment, tribunalCode: tr };
  }

  if (segment === '8') {
    const uf = TR_TO_UF[tr];
    if (!uf) return null;
    const court = uf === 'DF' ? 'TJDFT' : `TJ${uf}`;
    const sigla = uf === 'DF' ? 'tjdft' : `tj${uf.toLowerCase()}`;
    return { court, sigla, segment, tribunalCode: tr, uf };
  }

  if (segment === '9') {
    // Justiça Militar Estadual — apenas MG, RS e SP possuem TJM.
    const map: Record<string, { court: string; sigla: string }> = {
      '11': { court: 'TJMMG', sigla: 'tjmmg' },
      '23': { court: 'TJMRS', sigla: 'tjmrs' },
      '26': { court: 'TJMSP', sigla: 'tjmsp' },
    };
    const found = map[tr];
    if (!found) return null;
    return { court: found.court, sigla: found.sigla, segment, tribunalCode: tr, uf: TR_TO_UF[tr] };
  }

  return null;
}
