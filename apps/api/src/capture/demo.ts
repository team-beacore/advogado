import type { CaptureAdapter, CaptureFetchResult, CaptureTestResult, ExternalProcess, ExternalMovement, ExternalPublication } from './types';

/**
 * Conjunto determinístico de dados fictícios para demonstração e testes.
 * Nenhum dado real, nome real ou credencial é utilizado.
 */
export const DEMO_PROCESSES: Array<ExternalProcess & { id: string }> = [
  {
    id: 'demo-proc-001',
    processNumber: '0000000-00.2026.8.00.0001',
    title: 'Reclamação Trabalhista — Demonstração',
    court: 'Tribunal de Justiça — Demo',
    area: 'Trabalhista',
    parties: ['João da Silva', 'Empresa Exemplo Ltda.'],
  },
  {
    id: 'demo-proc-002',
    processNumber: '0000001-11.2026.8.00.0002',
    title: 'Ação de Cobrança — Demonstração',
    court: 'Tribunal de Justiça — Demo',
    area: 'Cível',
    parties: ['Maria Souza', 'Banco Demonstrativo S.A.'],
  },
  {
    id: 'demo-proc-003',
    processNumber: '0000002-22.2026.8.00.0003',
    title: 'Divórcio Consensual — Demonstração',
    court: 'Tribunal de Justiça — Demo',
    area: 'Família',
    parties: ['Carlos Pereira', 'Ana Pereira'],
  },
];

export const DEMO_MOVEMENTS: ExternalMovement[] = [
  { processNumber: '0000000-00.2026.8.00.0001', date: '2026-01-10', description: 'Distribuição', sourceReference: 'demo-mov-001' },
  { processNumber: '0000000-00.2026.8.00.0001', date: '2026-01-12', description: 'Juntada de documento', sourceReference: 'demo-mov-002' },
  { processNumber: '0000000-00.2026.8.00.0001', date: '2026-01-15', description: 'Despacho', sourceReference: 'demo-mov-003' },
  { processNumber: '0000000-00.2026.8.00.0001', date: '2026-02-01', description: 'Intimação', sourceReference: 'demo-mov-004' },
  { processNumber: '0000000-00.2026.8.00.0001', date: '2026-02-05', description: 'Conclusão para sentença', sourceReference: 'demo-mov-005' },
  { processNumber: '0000000-00.2026.8.00.0001', date: '2026-02-10', description: 'Sentença', sourceReference: 'demo-mov-006' },
  { processNumber: '0000001-11.2026.8.00.0002', date: '2026-01-11', description: 'Distribuição', sourceReference: 'demo-mov-101' },
  { processNumber: '0000001-11.2026.8.00.0002', date: '2026-01-14', description: 'Citação', sourceReference: 'demo-mov-102' },
  { processNumber: '0000001-11.2026.8.00.0002', date: '2026-01-20', description: 'Apresentação de contestação', sourceReference: 'demo-mov-103' },
  { processNumber: '0000001-11.2026.8.00.0002', date: '2026-02-02', description: 'Despacho', sourceReference: 'demo-mov-104' },
  { processNumber: '0000001-11.2026.8.00.0002', date: '2026-02-08', description: 'Audiência de conciliação', sourceReference: 'demo-mov-105' },
  { processNumber: '0000001-11.2026.8.00.0002', date: '2026-02-12', description: 'Intimação', sourceReference: 'demo-mov-106' },
  { processNumber: '0000002-22.2026.8.00.0003', date: '2026-01-12', description: 'Distribuição', sourceReference: 'demo-mov-201' },
  { processNumber: '0000002-22.2026.8.00.0003', date: '2026-01-16', description: 'Juntada de petição', sourceReference: 'demo-mov-202' },
  { processNumber: '0000002-22.2026.8.00.0003', date: '2026-01-22', description: 'Despacho', sourceReference: 'demo-mov-203' },
  { processNumber: '0000002-22.2026.8.00.0003', date: '2026-02-03', description: 'Designação de audiência', sourceReference: 'demo-mov-204' },
  { processNumber: '0000002-22.2026.8.00.0003', date: '2026-02-09', description: 'Intimação', sourceReference: 'demo-mov-205' },
  { processNumber: '0000002-22.2026.8.00.0003', date: '2026-02-14', description: 'Sentença homologatória', sourceReference: 'demo-mov-206' },
];

export const DEMO_PUBLICATIONS: ExternalPublication[] = [
  {
    processNumber: '0000000-00.2026.8.00.0001',
    content: 'Publicação de demonstração: ficará o autor intimado para manifestar-se no prazo legal.',
    publicationDate: '2026-02-01',
    availabilityDate: '2026-01-30',
    externalReference: 'demo-pub-001',
    possibleDueDate: '2026-02-16',
    notes: 'Dados fictícios de demonstração.',
  },
  {
    processNumber: '0000000-00.2026.8.00.0001',
    content: 'Publicação de demonstração: ciência da sentença proferida nos autos.',
    publicationDate: '2026-02-12',
    availabilityDate: '2026-02-11',
    externalReference: 'demo-pub-002',
    notes: 'Dados fictícios de demonstração.',
  },
  {
    processNumber: '0000001-11.2026.8.00.0002',
    content: 'Publicação de demonstração: intimação para audiência de conciliação.',
    publicationDate: '2026-02-08',
    availabilityDate: '2026-02-06',
    externalReference: 'demo-pub-003',
    possibleDueDate: '2026-02-18',
    notes: 'Dados fictícios de demonstração.',
  },
  {
    processNumber: '0000001-11.2026.8.00.0002',
    content: 'Publicação de demonstração: vista para manifestação acerca da contestação.',
    publicationDate: '2026-02-12',
    availabilityDate: '2026-02-11',
    externalReference: 'demo-pub-004',
    notes: 'Dados fictícios de demonstração.',
  },
  {
    processNumber: '0000002-22.2026.8.00.0003',
    content: 'Publicação de demonstração: ciência da sentença homologatória do acordo.',
    publicationDate: '2026-02-14',
    availabilityDate: '2026-02-13',
    externalReference: 'demo-pub-005',
    notes: 'Dados fictícios de demonstração.',
  },
];

export class DemoCaptureAdapter implements CaptureAdapter {
  readonly source = 'DEMO' as const;
  readonly mode = 'DEMO' as const;
  readonly label = 'Demonstração';
  readonly implemented = true;

  isConfigured(_config: Record<string, unknown> | null): boolean {
    return true;
  }

  async testConnection(_config: Record<string, unknown>): Promise<CaptureTestResult> {
    return {
      ok: true,
      message: 'Adapter de demonstração disponível.',
      details: ['Dados fictícios determinísticos', 'Ambiente de demonstração'],
    };
  }

  async fetch(_config: Record<string, unknown>): Promise<CaptureFetchResult> {
    return {
      processes: DEMO_PROCESSES.map(({ id: _id, ...p }) => p),
      movements: DEMO_MOVEMENTS.map((m) => ({ ...m })),
      publications: DEMO_PUBLICATIONS.map((p) => ({ ...p })),
    };
  }
}
