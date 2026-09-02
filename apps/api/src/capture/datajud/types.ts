/**
 * Tipos específicos do DataJud.
 * Refletem a estrutura do documento Elasticsearch retornado pela API Pública.
 * Todos os campos são opcionais porque o schema varia por tribunal.
 */

export interface DataJudSource {
  id?: string;
  tribunal?: string;
  numeroProcesso?: string;
  dataAjuizamento?: unknown;
  grau?: string;
  nivelSigilo?: number;
  classe?: { codigo?: number; nome?: string } | null;
  assuntos?: unknown;
  orgaoJulgador?: { codigo?: number; nome?: string; codigoMunicipioIBGE?: number } | null;
  sistema?: { codigo?: number; nome?: string } | null;
  formato?: { codigo?: number; nome?: string } | null;
  movimentos?: unknown[];
  dataHoraUltimaAtualizacao?: unknown;
  '@timestamp'?: unknown;
}

export interface DataJudConfig {
  /** Chave pública da API (nunca exposta). */
  apiKey?: string;
  /** URL base, ex.: https://api-publica.datajud.cnj.jus.br */
  baseUrl?: string;
  /** Timeout em ms. */
  timeoutMs?: number;
  /** Lista de números de processo a consultar. */
  processNumbers?: string[];
  /** Habilitado? */
  enabled?: boolean;
}