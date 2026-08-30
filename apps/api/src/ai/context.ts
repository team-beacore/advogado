import { getPool } from '../db/client';

export interface ProcessContext {
  process: Record<string, unknown> | null;
  client: Record<string, unknown> | null;
  responsible: Record<string, unknown> | null;
  members: unknown[];
  recentEvents: unknown[];
  documents: Array<Record<string, unknown>>;
  publications: unknown[];
  tasks: unknown[];
  organizationsName?: string | null;
}

export interface ContextOptions {
  maxDocuments?: number;
  maxEvents?: number;
  maxTasks?: number;
}

/**
 * Serviço que monta o contexto autorizado de um processo para uso da IA.
 * Somente dados reais do banco, filtrados pela organização do usuário.
 */
export class ProcessContextService {
  constructor(private pool = getPool()) {}

  async build(organizationId: string, processId: string, opts: ContextOptions = {}): Promise<ProcessContext> {
    const { maxDocuments = 10, maxEvents = 20, maxTasks = 20 } = opts;
    const pool = this.pool;

    const processRes = await pool.query(
      `SELECT c.id, c.title, c.process_number, c.court, c.jurisdiction, c.area, c.status, c.description,
              c.client_id, c.responsible_id, c.created_at, c.updated_at,
              u.name AS responsible_name, org.name AS organization_name
       FROM cases c
       LEFT JOIN users u ON u.id = c.responsible_id
       LEFT JOIN organizations org ON org.id = c.organization_id
       WHERE c.id = $1 AND c.organization_id = $2`,
      [processId, organizationId],
    );
    const process = processRes.rows[0] ?? null;

    let client: Record<string, unknown> | null = null;
    let members: unknown[] = [];
    let recentEvents: unknown[] = [];
    let documents: Array<Record<string, unknown>> = [];
    let publications: unknown[] = [];
    let tasks: unknown[] = [];

    if (process) {
      if (process.client_id) {
        const clientRes = await pool.query(
          'SELECT id, name, email, phone, cpf_cnpj, notes FROM clients WHERE id = $1 AND organization_id = $2',
          [process.client_id, organizationId],
        );
        client = clientRes.rows[0] ?? null;
      }
      const membersRes = await pool.query(
        `SELECT cm.role, u.id AS user_id, u.name FROM case_members cm
         JOIN users u ON u.id = cm.user_id
         WHERE cm.case_id = $1`,
        [processId],
      );
      members = membersRes.rows;

      const eventsRes = await pool.query(
        `SELECT type, title, description, source, source_reference, created_at FROM case_events
         WHERE process_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [processId, maxEvents],
      );
      recentEvents = eventsRes.rows;

      const docsRes = await pool.query(
        `SELECT id, name, file_name, mime_type, size, created_at, uploaded_by, extracted_text, extraction_status, extraction_method FROM documents
         WHERE process_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT $2`,
        [processId, maxDocuments],
      );
      documents = docsRes.rows.map((d) => ({
        ...d,
        content_extracted: Boolean(d.extracted_text),
        extraction_status: d.extraction_status ?? 'NONE',
        note: d.extracted_text ? 'texto extraído disponível' : 'conteúdo textual não extraído',
      }));

      const pubsRes = await pool.query(
        `SELECT id, source, availability_date, publication_date, content, external_reference, status, possible_due_date, notes, created_at
         FROM legal_publications WHERE process_id = $1 ORDER BY created_at DESC LIMIT 10`,
        [processId],
      );
      publications = pubsRes.rows;

      const tasksRes = await pool.query(
        `SELECT id, title, description, priority, status, due_date, assigned_to, created_at FROM tasks
         WHERE process_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [processId, maxTasks],
      );
      tasks = tasksRes.rows;
    }

    return {
      process,
      client,
      responsible: process?.responsible_name ? { id: process.responsible_id, name: process.responsible_name } : null,
      members,
      recentEvents,
      documents,
      publications,
      tasks,
      organizationsName: process?.organization_name,
    };
  }
}
