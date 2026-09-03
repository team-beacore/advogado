/**
 * Tipos da API do PJe (PDPJ-Br) — baseados na documentação oficial do CNJ.
 * Fonte: http://docs.pje.jus.br e https://docs.pdpj.jus.br (padrões de API REST).
 *
 * O PJe expõe API REST (JSON) com OAuth2 (Keycloak realm `pje`). Recursos:
 *   GET /processos?filter={"numero":{"eq":"..."}}
 *   GET /processos:cabecalho/{numero}
 *   GET /processos/{id}/movimentos
 *   GET /processos/{id}/documentos
 */

export interface PJeTokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

export interface PJeProcessoListResponse {
  _embedded?: {
    processos?: Array<PJeProcessoHeader>;
  };
  _links?: Record<string, unknown>;
  content?: Array<PJeProcessoHeader>;
  totalElements?: number;
}

export interface PJeProcessoHeader {
  id?: string | number;
  numero?: string;
  numeroUnico?: string;
  numeroProcesso?: string;
  classe?: PJeNomeCodigo | null;
  orgaoJulgador?: PJeNomeCodigo | null;
  tribunal?: string | null;
  grau?: string | null;
  sigilo?: boolean | null;
  nivelSigilo?: string | null;
  assunto?: string | null;
  dataAjuizamento?: string | null;
  dataHoraUltimaAtualizacao?: string | null;
  partes?: Array<PJeParte> | null;
  movimentos?: Array<PJeMovimento> | null;
  metadadosProcessuais?: Record<string, unknown> | null;
}

export interface PJeNomeCodigo {
  codigo?: string | number | null;
  nome?: string | null;
  descricao?: string | null;
  valor?: unknown;
}

export interface PJeParte {
  nome?: string | null;
  papel?: PJeNomeCodigo | null;
  advogados?: Array<{ nome?: string | null; numeroOab?: string | null; ufOab?: string | null }> | null;
}

export interface PJeMovimento {
  id?: string | number;
  data?: string | null;
  dataHora?: string | null;
  tipoMovimento?: PJeNomeCodigo | null;
  nome?: string | null;
  descricao?: string | null;
  complementosTabelados?: Array<PJeNomeCodigo> | null;
  usuario?: string | null;
}

export interface PJeMovimentosResponse {
  content?: Array<PJeMovimento>;
  _embedded?: { movimentos?: Array<PJeMovimento> };
}

export interface PJeDocumento {
  id?: string | number;
  nome?: string | null;
  tipo?: PJeNomeCodigo | null;
  data?: string | null;
  hash?: string | null;
}

export interface PJeDocumentosResponse {
  content?: Array<PJeDocumento>;
  _embedded?: { documentos?: Array<PJeDocumento> };
}

/** Configuração resolvida para a integração PJe. */
export interface ResolvedPJeConfig {
  /** OAuth2 client_id (cadastrado junto ao CNJ). */
  clientId: string;
  /** OAuth2 client_secret (nunca exposto). */
  clientSecret: string;
  /** Usuário (advogado/servidor) para grant_type=password. */
  username: string;
  /** Senha do usuário (nunca exposta). */
  password: string;
  /** URL do token endpoint OAuth2 (Keycloak). */
  tokenUrl: string;
  /** URL base da API (gateway PDPJ/PJe). */
  baseUrl: string;
  timeoutMs: number;
  processNumbers: string[];
  enabled: boolean;
}
