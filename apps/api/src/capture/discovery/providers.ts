import type { CaptureMode, CaptureSource } from '@advogado/shared';
import type {
  DiscoveryCapabilities,
  DiscoveryResult,
  DiscoveryTestConnectionResult,
  ProcessDiscoveryProvider,
  ProfessionalIdentityInput,
} from './types';
import { DEMO_PROCESSES, DEMO_MOVEMENTS, DEMO_PUBLICATIONS } from '../demo';
import { DataJudDiscoveryProvider } from '../datajud/adapter';
import { DjenDiscoveryProvider } from '../djen/provider';
import { PJeDiscoveryProvider } from '../pje/adapter';

/**
 * Providers de descoberta de processos.
 *
 * IMPORTANTE — honestidade de capacidades:
 *  - Nenhum provider declara `supportsProfessionalDiscovery = true` sem implementação real.
 *  - Fontes ainda não integradas (DataJud, PJe, e-SAJ, PROJUDI) retornam erro honesto
 *    em `discoverByProfessional` e nunca fingem descoberta.
 *  - DEMO é explicitamente dados fictícios de demonstração (nunca tratado como real).
 */

const NOT_IMPLEMENTED = 'NOT_IMPLEMENTED';

class UnavailableDiscoveryProvider implements ProcessDiscoveryProvider {
  readonly implemented = false;

  constructor(
    readonly source: CaptureSource,
    readonly mode: CaptureMode,
    readonly label: string,
    private readonly caps: DiscoveryCapabilities,
  ) {}

  isConfigured(_config: Record<string, unknown> | null): boolean {
    return false;
  }

  capabilities(): DiscoveryCapabilities {
    return { ...this.caps };
  }

  async discoverByProfessional(_identity: ProfessionalIdentityInput, _config: Record<string, unknown> | null): Promise<DiscoveryResult> {
    return {
      source: this.source,
      processes: [],
      error: {
        code: NOT_IMPLEMENTED,
        message: `Descoberta por ${this.label} ainda não implementada. Nenhuma conexão real foi estabelecida.`,
      },
    };
  }

  async testConnection(_config: Record<string, unknown>): Promise<DiscoveryTestConnectionResult> {
    return {
      ok: false,
      message: `Fonte ${this.label} ainda não implementada. Nenhuma conexão real foi estabelecida.`,
      details: ['Implementação de produção exige credenciais reais e validação contra o sistema oficial.'],
    };
  }
}

/**
 * DEMO — descoberta de demonstração.
 * Retorna o mesmo conjunto determinístico de dados fictícios do adapter de captura.
 * Nenhum dado real é utilizado e jamais é tratado como produção.
 */
class DemoDiscoveryProvider implements ProcessDiscoveryProvider {
  readonly source = 'DEMO' as const;
  readonly mode = 'DEMO' as const;
  readonly label = 'Demonstração';
  readonly implemented = true;

  isConfigured(_config: Record<string, unknown> | null): boolean {
    return true;
  }

  capabilities(): DiscoveryCapabilities {
    return {
      supportsProfessionalDiscovery: true,
      supportsProcessLookup: true,
      supportsMovements: true,
      supportsPublications: true,
      supportsDocuments: false,
      requiresAuthentication: false,
      supportedCourts: [],
      supportedSystems: [],
    };
  }

  async discoverByProfessional(_identity: ProfessionalIdentityInput, _config: Record<string, unknown> | null): Promise<DiscoveryResult> {
    const processes = DEMO_PROCESSES.map((p) => {
      const movements = DEMO_MOVEMENTS.filter((m) => m.processNumber === p.processNumber)
        .map((m) => ({ date: m.date ?? null, description: m.description, sourceReference: m.sourceReference ?? null }));
      const publications = DEMO_PUBLICATIONS.filter((q) => q.processNumber === p.processNumber)
        .map((q) => ({
          content: q.content,
          publicationDate: q.publicationDate ?? null,
          availabilityDate: q.availabilityDate ?? null,
          externalReference: q.externalReference ?? null,
          possibleDueDate: q.possibleDueDate ?? null,
          notes: q.notes ?? null,
        }));
      return {
        source: this.source,
        processNumber: p.processNumber,
        court: p.court ?? null,
        courtCode: null,
        judicialSystem: null,
        externalProcessId: p.id,
        title: p.title ?? null,
        area: p.area ?? null,
        class: null,
        subjects: null,
        lastMovement: movements[movements.length - 1]?.description ?? null,
        lastMovementAt: movements[movements.length - 1]?.date ?? null,
        parties: p.parties ?? null,
        movements,
        publications,
        metadata: { demo: true },
      };
    });
    return { source: this.source, processes };
  }

  async testConnection(_config: Record<string, unknown>): Promise<DiscoveryTestConnectionResult> {
    return {
      ok: true,
      message: 'Descoberta de demonstração disponível.',
      details: ['Dados fictícios determinísticos', 'Ambiente de demonstração'],
    };
  }
}

/**
 * DATAJUD — fonte pública do CNJ.
 * Integração real implementada (consulta por número CNJ), mas:
 *  - DataJud NÃO permite descobrir todos os processos de um advogado por OAB.
 *    Portanto: supportsProfessionalDiscovery = false (nunca prometido).
 *  - DataJud permite consultar/atualizar um processo específico por número.
 *    Portanto: supportsProcessLookup = true.
 */
const dataJudDiscoveryProvider = new DataJudDiscoveryProvider();

/**
 * PJe — integração real (PDPJ-Br, OAuth2). A API oficial do PJe permite
 * consulta por número CNJ e movimentações, mas NÃO oferece descoberta por OAB
 * (não há endpoint público de descoberta por advogado). Portanto:
 *   supportsProfessionalDiscovery = false (nunca prometido).
 *   supportsProcessLookup = true; supportsMovements = true; supportsDocuments = true.
 */
const pjeDiscoveryProvider = new PJeDiscoveryProvider();

/**
 * e-SAJ / PROJUDI — integrações específicas por tribunal.
 * Nenhuma implementação real validada ainda: capacidades permanecem vazias/falsas.
 */
const esajDiscoveryProvider = new UnavailableDiscoveryProvider('ESAJ', 'AUTHENTICATED', 'e-SAJ', {
  supportsProfessionalDiscovery: false,
  supportsProcessLookup: false,
  supportsMovements: false,
  supportsPublications: false,
  supportsDocuments: false,
  requiresAuthentication: true,
  supportedCourts: [],
  supportedSystems: [],
});

const projudiDiscoveryProvider = new UnavailableDiscoveryProvider('PROJUDI', 'AUTHENTICATED', 'Projudi', {
  supportsProfessionalDiscovery: false,
  supportsProcessLookup: false,
  supportsMovements: false,
  supportsPublications: false,
  supportsDocuments: false,
  requiresAuthentication: true,
  supportedCourts: [],
  supportedSystems: [],
});

export const demoDiscoveryProvider = new DemoDiscoveryProvider();
export const djenDiscoveryProvider = new DjenDiscoveryProvider();
export { dataJudDiscoveryProvider, pjeDiscoveryProvider, esajDiscoveryProvider, projudiDiscoveryProvider };
