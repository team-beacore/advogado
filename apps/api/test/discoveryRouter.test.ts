import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ProcessDiscoveryProvider, DiscoveryCapabilities, DiscoveryResult, DiscoveryTestConnectionResult, ProfessionalIdentityInput } from '../src/capture/discovery/types';
import { DiscoveryRouter } from '../src/capture/discovery/router';
import { aggregateProcesses, normalizeKey, pickConfidence } from '../src/capture/discovery/aggregator';
import { DataJudDiscoveryProvider } from '../src/capture/datajud/adapter';
import { DjenDiscoveryProvider } from '../src/capture/djen/provider';
import type { DJENTransport } from '../src/capture/djen/client';

const IDENTITY: ProfessionalIdentityInput = {
  id: 'ident-1',
  professionalName: 'Dr. João Silva',
  oabNumber: '123456',
  oabState: 'RJ',
};

function makeProvider(partial: Partial<ProcessDiscoveryProvider> & { source: ProcessDiscoveryProvider['source'] }): ProcessDiscoveryProvider {
  const caps: DiscoveryCapabilities = { supportsProfessionalDiscovery: false, supportsProcessLookup: false, supportsMovements: false, supportsPublications: false, supportsDocuments: false, requiresAuthentication: false, supportedCourts: [], supportedSystems: [] };
  return {
    mode: 'PUBLIC',
    label: partial.source,
    implemented: true,
    isConfigured: () => true,
    capabilities: () => caps,
    discoverByProfessional: async () => ({ source: partial.source, processes: [] }),
    testConnection: async (): Promise<DiscoveryTestConnectionResult> => ({ ok: true, message: 'ok' }),
    ...partial,
  } as ProcessDiscoveryProvider;
}

function httpOk(body: unknown, status = 200): DJENTransport {
  return async () => ({ status, headers: { get: () => null }, json: async () => body });
}

describe('DiscoveryRouter — seleção e execução de providers', () => {
  const noopConfig = { configLoader: async () => ({}) };

  it('1. provider sem suporte (não implementado) → SKIPPED NOT_IMPLEMENTED', async () => {
    const provider = makeProvider({ source: 'PJE', implemented: false });
    const router = new DiscoveryRouter(noopConfig);
    const steps = await router.route(IDENTITY, [provider]);
    assert.equal(steps[0]!.status, 'SKIPPED');
    assert.equal(steps[0]!.reason, 'NOT_IMPLEMENTED');
  });

  it('2. provider com suporte retorna OK e processos', async () => {
    const provider = makeProvider({
      source: 'DEMO',
      capabilities: () => ({ ...providerCapsBase(), supportsProfessionalDiscovery: true }),
      discoverByProfessional: async () => ({ source: 'DEMO', processes: [{ source: 'DEMO', processNumber: '0000000-00.2026.8.00.0001' }] }),
    });
    const router = new DiscoveryRouter(noopConfig);
    const steps = await router.route(IDENTITY, [provider]);
    assert.equal(steps[0]!.status, 'OK');
    assert.equal(steps[0]!.processes?.length, 1);
  });

  it('3. múltiplos providers são avaliados independentemente', async () => {
    const a = makeProvider({ source: 'DEMO', implemented: false });
    const b = makeProvider({
      source: 'DJEN',
      capabilities: () => ({ ...providerCapsBase(), supportsProfessionalDiscovery: true }),
      discoverByProfessional: async () => ({ source: 'DJEN', processes: [] }),
    });
    const router = new DiscoveryRouter(noopConfig);
    const steps = await router.route(IDENTITY, [a, b]);
    assert.equal(steps[0]!.status, 'SKIPPED');
    assert.equal(steps[1]!.status, 'OK');
  });

  it('4. provider sem suporte profissional → SKIPPED NO_PROFESSIONAL_DISCOVERY', async () => {
    const provider = makeProvider({ source: 'DATAJUD' });
    const router = new DiscoveryRouter(noopConfig);
    const steps = await router.route(IDENTITY, [provider]);
    assert.equal(steps[0]!.status, 'SKIPPED');
    assert.equal(steps[0]!.reason, 'NO_PROFESSIONAL_DISCOVERY');
  });

  it('5. erro de autenticação retorna FAILED com erro seguro (sem credencial)', async () => {
    const provider = makeProvider({
      source: 'DJEN',
      capabilities: () => ({ ...providerCapsBase(), supportsProfessionalDiscovery: true }),
      isConfigured: () => true,
      discoverByProfessional: async () => ({ source: 'DJEN', processes: [], error: { code: 'DJEN_UNAVAILABLE', message: 'Falha ao consultar o DJEN.' } }),
    });
    const router = new DiscoveryRouter(noopConfig);
    const steps = await router.route(IDENTITY, [provider]);
    assert.equal(steps[0]!.status, 'FAILED');
    assert.ok(!steps[0]!.error!.message.includes('senha'));
    assert.ok(!steps[0]!.error!.message.includes('token'));
  });

  it('6. exception do provider → FAILED ERROR (não derruba o router)', async () => {
    const provider = makeProvider({
      source: 'DEMO',
      capabilities: () => ({ ...providerCapsBase(), supportsProfessionalDiscovery: true }),
      discoverByProfessional: async (): Promise<DiscoveryResult> => { throw new Error('boom'); },
    });
    const router = new DiscoveryRouter(noopConfig);
    const steps = await router.route(IDENTITY, [provider]);
    assert.equal(steps[0]!.status, 'FAILED');
    assert.equal(steps[0]!.reason, 'ERROR');
  });

  it('16. DataJud permanece sem professional discovery', async () => {
    const provider = new DataJudDiscoveryProvider();
    const caps = provider.capabilities();
    assert.equal(caps.supportsProfessionalDiscovery, false);
    assert.equal(caps.supportsProcessLookup, true);
  });
});

describe('DiscoveryAggregator — deduplicação, sources e confidence', () => {
  it('7. mesmo processo de duas fontes → UM processo com sources[]', () => {
    const base = (source: 'PJE' | 'DJEN'): Parameters<typeof aggregateProcesses>[0][number] => ({
      source, processNumber: '0000832-35.2018.4.01.3202', court: 'TRF1',
    });
    const out = aggregateProcesses([base('PJE'), base('DJEN')]);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0]!.sources, ['PJE', 'DJEN']);
  });

  it('8. confidence mais forte prevalece na agregação', () => {
    const a = { source: 'PJE' as const, processNumber: 'X-1', confidence: 'MEDIUM' as const };
    const b = { source: 'DJEN' as const, processNumber: 'X-1', confidence: 'HIGH' as const };
    const out = aggregateProcesses([a, b]);
    assert.equal(out[0]!.confidence, 'HIGH');
    assert.equal(pickConfidence('LOW', 'MEDIUM'), 'MEDIUM');
    assert.equal(pickConfidence(undefined, 'UNKNOWN'), 'UNKNOWN');
  });

  it('9. processos distintos não são mesclados', () => {
    const a = { source: 'PJE' as const, processNumber: '1111111-11.2020.8.01.0001' };
    const b = { source: 'DJEN' as const, processNumber: '2222222-22.2020.8.01.0001' };
    const out = aggregateProcesses([a, b]);
    assert.equal(out.length, 2);
  });

  it('10. normalizeKey normaliza número CNJ mascarado e sem máscara', () => {
    assert.equal(normalizeKey('0000832-35.2018.4.01.3202'), '00008323520184013202');
    assert.equal(normalizeKey('00008323520184013202'), '00008323520184013202');
  });

  it('11. source sem confidence → UNKNOWN (não inventa certeza)', () => {
    const out = aggregateProcesses([{ source: 'PJE', processNumber: 'X-1' }]);
    assert.equal(out[0]!.confidence, 'UNKNOWN');
  });
});

describe('DJEN — provider real de descoberta profissional', () => {
  it('12. descobre processos por OAB via transporte (comunicação do advogado)', async () => {
    const body = {
      status: 'success',
      count: 1,
      items: [{
        id: 1,
        numero_processo: '00008323520184013202',
        siglaTribunal: 'TRF1',
        tipoComunicacao: 'Intimação',
        nomeClasse: 'Procedimento do Juizado Especial Cível',
        destinatarioadvogados: [{ advogado: { nome: 'João Silva', numero_oab: '123456', uf_oab: 'RJ' } }],
      }],
    };
    const provider = new DjenDiscoveryProvider(httpOk(body));
    const r = await provider.discoverByProfessional(IDENTITY, {});
    assert.equal(r.error, undefined);
    assert.equal(r.processes.length, 1);
    const p = r.processes[0]!;
    assert.equal(p.processNumber, '0000832-35.2018.4.01.3202');
    assert.equal(p.court, 'TRF1');
    assert.equal(p.confidence, 'HIGH'); // advogado confirmado como destinatário
    assert.deepEqual(p.sources, ['DJEN']);
  });

  it('13. confidence MEDIUM quando não há destinatário advogado confirmado', async () => {
    const body = {
      status: 'success',
      count: 1,
      items: [{ id: 2, numero_processo: '0000832-35.2018.4.01.3202', siglaTribunal: 'TRF1', destinatarioadvogados: [] }],
    };
    const provider = new DjenDiscoveryProvider(httpOk(body));
    const r = await provider.discoverByProfessional(IDENTITY, {});
    assert.equal(r.processes[0]!.confidence, 'MEDIUM');
  });

  it('14. não duplica quando duas comunicações apontam o mesmo processo', async () => {
    const body = {
      status: 'success',
      count: 2,
      items: [
        { id: 1, numero_processo: '0000832-35.2018.4.01.3202', siglaTribunal: 'TRF1' },
        { id: 2, numero_processo: '00008323520184013202', siglaTribunal: 'TRF1' },
      ],
    };
    const provider = new DjenDiscoveryProvider(httpOk(body));
    const r = await provider.discoverByProfessional(IDENTITY, {});
    assert.equal(r.processes.length, 1);
  });

  it('15. provider indisponível → FAILED honesto (sem falso sucesso)', async () => {
    const provider = new DjenDiscoveryProvider(httpOk({}, 500));
    const r = await provider.discoverByProfessional(IDENTITY, {});
    assert.equal(r.processes.length, 0);
    assert.ok(r.error);
  });

  it('17. isConfigured exige habilitação explícita da fonte', () => {
    const provider = new DjenDiscoveryProvider();
    assert.equal(provider.isConfigured(null), false);
    assert.equal(provider.isConfigured({}), false);
    assert.equal(provider.isConfigured({ enabled: true }), true);
  });
});

function providerCapsBase(): DiscoveryCapabilities {
  return { supportsProfessionalDiscovery: false, supportsProcessLookup: false, supportsMovements: false, supportsPublications: false, supportsDocuments: false, requiresAuthentication: false, supportedCourts: [], supportedSystems: [] };
}
