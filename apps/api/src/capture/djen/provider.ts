import type { DiscoveryCapabilities, DiscoveryResult, DiscoveryTestConnectionResult, ProcessDiscoveryProvider, ProfessionalIdentityInput } from '../discovery/types';
import type { DiscoveredProcess } from '../discovery/types';
import { DJENClient, DJENError, DEFAULT_DJEN_BASE_URL } from './client';
import type { DJENTransport, DJENComunicacaoItem } from './client';
import { parseCNJ } from '../datajud/cnj';

/**
 * Provider de descoberta profissional do DJEN (Comunica PJe).
 *
 * O DJEN oferece uma API pública (sem autenticação) que permite consultar
 * comunicações processuais publicadas por OAB/UF do advogado.
 * Isto é DESCOBERTA PROFISSIONAL REAL, embora limitada a processos que
 * tenham comunicações publicadas no DJEN (intimações, citações, editais).
 *
 * Source: https://comunicaapi.pje.jus.br/swagger/djen.yml (spec oficial OpenAPI 3.0)
 * Documentação: Res. CNJ 455/2022 — https://atos.cnj.jus.br/atos/detalhar/4509
 */

export class DjenDiscoveryProvider implements ProcessDiscoveryProvider {
  readonly source = 'DJEN' as const;
  readonly mode = 'PUBLIC' as const;
  readonly label = 'DJEN (Comunica PJe)';
  readonly implemented = true;

  constructor(private readonly transport?: DJENTransport) {}

  /** A API é pública, mas a organização precisa habilitar a fonte explicitamente (evita chamadas externas acidentais). */
  isConfigured(config: Record<string, unknown> | null): boolean {
    return Boolean(config && config.enabled === true);
  }

  capabilities(): DiscoveryCapabilities {
    return {
      supportsProfessionalDiscovery: true,
      supportsProcessLookup: true,
      supportsMovements: false,
      supportsPublications: true,
      supportsDocuments: false,
      requiresAuthentication: false,
      supportedCourts: [],
      supportedSystems: ['DJEN'],
    };
  }

  async discoverByProfessional(identity: ProfessionalIdentityInput, _config: Record<string, unknown> | null): Promise<DiscoveryResult> {
    const oab = identity.oabNumber.replace(/\D/g, '');
    const uf = identity.oabState.toUpperCase();
    if (!oab || !uf) {
      return { source: this.source, processes: [], error: { code: 'INVALID_IDENTITY', message: 'OAB/UF inválidos para consulta no DJEN.' } };
    }

    const client = new DJENClient({ baseUrl: DEFAULT_DJEN_BASE_URL, timeoutMs: 30000, transport: this.transport });
    const processes = new Map<string, DiscoveredProcess>();

    try {
      const response = await client.findByOab(oab, uf);
      for (const item of response.items ?? []) {
        const processNumber = this.extractProcessNumber(item);
        if (!processNumber) continue;
        if (processes.has(processNumber)) continue;

        const confidence = this.computeConfidence(item, oab, uf);
        processes.set(processNumber, {
          source: 'DJEN',
          processNumber,
          court: item.siglaTribunal ?? null,
          courtCode: item.siglaTribunal ?? null,
          judicialSystem: 'DJEN',
          judicialSystemCode: null,
          externalProcessId: String(item.id),
          title: item.nomeClasse ?? null,
          class: item.nomeClasse ?? null,
          classCode: item.codigoClasse != null ? String(item.codigoClasse) : null,
          lastMovement: item.tipoComunicacao ? `Comunicação: ${item.tipoComunicacao}` : null,
          lastMovementAt: item.data_disponibilizacao ?? null,
          publications: [{
            content: this.sanitizeContent(item.tipoComunicacao ?? ''),
            publicationDate: item.data_disponibilizacao ?? null,
            externalReference: item.hash ?? String(item.id),
          }],
          confidence,
          sources: ['DJEN'],
          metadata: { oab, uf, comunicacaoId: item.id, siglaTribunal: item.siglaTribunal, tipoComunicacao: item.tipoComunicacao },
        });
      }
      return { source: this.source, processes: [...processes.values()] };
    } catch (err) {
      if (err instanceof DJENError) {
        return { source: this.source, processes: [], error: { code: err.code, message: err.message } };
      }
      return { source: this.source, processes: [], error: { code: 'DJEN_GENERIC', message: 'Falha ao consultar o DJEN.' } };
    }
  }

  async testConnection(_config: Record<string, unknown>): Promise<DiscoveryTestConnectionResult> {
    try {
      const client = new DJENClient({ baseUrl: DEFAULT_DJEN_BASE_URL, timeoutMs: 15000, transport: this.transport });
      const tribunais = await client.listTribunals();
      if (Array.isArray(tribunais) && tribunais.length > 0) {
        return { ok: true, message: 'DJEN conectado.', details: [`${tribunais.length} tribunais disponíveis`] };
      }
      return { ok: true, message: 'DJEN conectado (sem tribunais retornados).' };
    } catch (err) {
      const msg = err instanceof DJENError ? err.message : 'Falha ao conectar ao DJEN.';
      return { ok: false, message: msg };
    }
  }

  private extractProcessNumber(item: DJENComunicacaoItem): string | null {
    const raw = item.numeroprocessocommascara || item.numero_processo;
    if (!raw) return null;
    const parsed = parseCNJ(raw);
    return parsed?.mask ?? raw;
  }

  private computeConfidence(item: DJENComunicacaoItem, oab: string, uf: string): 'HIGH' | 'MEDIUM' {
    const advs = item.destinatarioadvogados ?? [];
    const match = advs.some((d) => {
      const a = d.advogado;
      return a && a.numero_oab?.replace(/\D/g, '') === oab && a.uf_oab?.toUpperCase() === uf;
    });
    return match ? 'HIGH' : 'MEDIUM';
  }

  /** Extrai texto seguro da comunicação (sem segredo, apenas metadados públicos). */
  private sanitizeContent(tipo: string): string {
    return `Comunicação publicada no DJEN — ${tipo || 'sem tipo'}`;
  }
}