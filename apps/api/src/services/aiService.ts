import { errors } from '../errors';
import { getPool } from '../db/client';
import { auditLog } from '../audit/audit';
import { addEvent } from '../events/timeline';
import type { AIProvider } from '../ai/provider';
import { ProcessContextService } from '../ai/context';
import { analyzeIntimation, formatContext, summarizeProcess, suggestDraft, AI_DISCLAIMER } from '../ai/operations';
import { assertCasePermission } from './caseService';

export class AIService {
  constructor(
    private provider: AIProvider,
    private contextService = new ProcessContextService(),
  ) {}

  private async assertProcessAccess(organizationId: string, processId: string, userId: string, orgRole?: string | null) {
    await assertCasePermission(organizationId, processId, userId, 'view', orgRole);
  }

  private async recordInteraction(params: {
    organizationId: string;
    processId: string | null;
    userId: string;
    type: string;
    model: string | null;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
  }) {
    const pool = getPool();
    const res = await pool.query(
      `INSERT INTO ai_interactions (organization_id, process_id, user_id, type, prompt_reference, model, input_reference, output)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        params.organizationId,
        params.processId,
        params.userId,
        params.type,
        null,
        params.model,
        JSON.stringify(params.input),
        JSON.stringify(params.output),
      ],
    );
    return res.rows[0]?.id as string;
  }

  async summarize(organizationId: string, processId: string, userId: string, ip?: string, orgRole?: string | null) {
    await this.assertProcessAccess(organizationId, processId, userId, orgRole);
    if (!this.provider.isConfigured()) throw errors.aiNotConfigured();
    const context = await this.contextService.build(organizationId, processId);
    const result = await summarizeProcess(this.provider, context);
    const interactionId = await this.recordInteraction({
      organizationId,
      processId,
      userId,
      type: 'RESUME',
      model: result.model as string | null,
      input: { processId, contextSummary: formatContext(context).slice(0, 2000) },
      output: result,
    });
    await addEvent({
      processId,
      type: 'AI_EXECUTED',
      title: 'IA: resumo do processo',
      description: 'A IA gerou um resumo do processo. Revisão humana pendente.',
      source: 'ai',
      sourceReference: interactionId,
      createdBy: userId,
    });
    void auditLog({ organizationId, userId, action: 'AI_EXECUTED', entity: 'ai_interaction', entityId: interactionId, after: { type: 'RESUME', processId, model: result.model }, ip });
    return { interactionId, ...result };
  }

  async analyzePublication(organizationId: string, processId: string, publicationId: string, userId: string, ip?: string, orgRole?: string | null) {
    await this.assertProcessAccess(organizationId, processId, userId, orgRole);
    if (!this.provider.isConfigured()) throw errors.aiNotConfigured();
    const pool = getPool();
    const pubRes = await pool.query(
      'SELECT * FROM legal_publications WHERE id = $1 AND process_id = $2 AND organization_id = $3',
      [publicationId, processId, organizationId],
    );
    if (pubRes.rows.length === 0) throw errors.notFound('Intimação não encontrada.');
    const publication = pubRes.rows[0];

    const context = await this.contextService.build(organizationId, processId);
    const result = await analyzeIntimation(this.provider, context, publicationId, publication.content);
    const interactionId = await this.recordInteraction({
      organizationId,
      processId,
      userId,
      type: 'ANALYZE_INTIMATION',
      model: result.model as string | null,
      input: { processId, publicationId, contentExcerpt: publication.content.slice(0, 1000) },
      output: result,
    });
    await addEvent({
      processId,
      type: 'AI_EXECUTED',
      title: 'IA: análise de intimação',
      description: 'A IA analisou a intimação registrada. Revisão humana pendente.',
      source: 'ai',
      sourceReference: interactionId,
      createdBy: userId,
    });
    void auditLog({ organizationId, userId, action: 'AI_EXECUTED', entity: 'ai_interaction', entityId: interactionId, after: { type: 'ANALYZE_INTIMATION', processId, publicationId, model: result.model }, ip });
    return { interactionId, ...result };
  }

  async draft(organizationId: string, processId: string, instruction: string, userId: string, ip?: string, orgRole?: string | null) {
    await this.assertProcessAccess(organizationId, processId, userId, orgRole);
    if (!this.provider.isConfigured()) throw errors.aiNotConfigured();
    const context = await this.contextService.build(organizationId, processId);
    const result = await suggestDraft(this.provider, context, instruction);
    const interactionId = await this.recordInteraction({
      organizationId,
      processId,
      userId,
      type: 'DRAFT',
      model: result.model as string | null,
      input: { processId, instruction },
      output: result,
    });
    await addEvent({
      processId,
      type: 'AI_EXECUTED',
      title: 'IA: rascunho sugerido',
      description: 'A IA preparou uma sugestão de rascunho. Revisão humana necessária.',
      source: 'ai',
      sourceReference: interactionId,
      createdBy: userId,
    });
    void auditLog({ organizationId, userId, action: 'AI_EXECUTED', entity: 'ai_interaction', entityId: interactionId, after: { type: 'DRAFT', processId, model: result.model }, ip });
    return { interactionId, ...result };
  }

  async listInteractions(organizationId: string, opts: { processId?: string; page?: number; pageSize?: number }) {
    const pool = getPool();
    const params: unknown[] = [organizationId];
    let where = 'i.organization_id = $1';
    if (opts.processId) {
      params.push(opts.processId);
      where += ` AND i.process_id = $${params.length}`;
    }
    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 50;
    params.push(pageSize, (page - 1) * pageSize);
    const res = await pool.query(
      `SELECT i.*, u.name AS user_name,
         (SELECT json_agg(json_build_object('id', a.id, 'status', a.status, 'reviewedAt', a.reviewed_at, 'reviewerId', a.reviewer_id, 'editedOutput', a.edited_output))
          FROM ai_approvals a WHERE a.ai_interaction_id = i.id) AS approvals
       FROM ai_interactions i LEFT JOIN users u ON u.id = i.user_id
       WHERE ${where} ORDER BY i.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: res.rows, page, pageSize };
  }

  async reviewInteraction(organizationId: string, interactionId: string, userId: string, status: 'APPROVED' | 'EDITED' | 'REJECTED', editedOutput?: Record<string, unknown> | null, ip?: string) {
    const pool = getPool();
    const intRes = await pool.query(
      'SELECT * FROM ai_interactions WHERE id = $1 AND organization_id = $2',
      [interactionId, organizationId],
    );
    if (intRes.rows.length === 0) throw errors.notFound('Interação de IA não encontrada.');
    const interaction = intRes.rows[0];

    if (status === 'EDITED' && !editedOutput) {
      throw errors.validation('Para editar uma resposta de IA, é necessário fornecer a saída editada.');
    }

    const approvalRes = await pool.query(
      `INSERT INTO ai_approvals (ai_interaction_id, reviewer_id, status, edited_output, reviewed_at)
       VALUES ($1, $2, $3, $4, now()) RETURNING *`,
      [interactionId, userId, status, editedOutput ? JSON.stringify(editedOutput) : null],
    );

    if (interaction.process_id) {
      await addEvent({
        processId: interaction.process_id,
        type: 'AI_REVIEWED',
        title: `IA revisada: ${status === 'APPROVED' ? 'aprovada' : status === 'EDITED' ? 'editada' : 'rejeitada'}`,
        description: `A resposta da IA foi ${status === 'APPROVED' ? 'aprovada' : status === 'EDITED' ? 'editada pelo advogado' : 'rejeitada'} pelo usuário.`,
        source: 'ai',
        sourceReference: interactionId,
        createdBy: userId,
      });
    }
    void auditLog({
      organizationId,
      userId,
      action: 'AI_REVIEWED',
      entity: 'ai_interaction',
      entityId: interactionId,
      before: { approvalStatus: 'PENDING' },
      after: { status, edited: Boolean(editedOutput) },
      ip,
    });
    return approvalRes.rows[0];
  }

  getDisclaimer(): string {
    return AI_DISCLAIMER;
  }
}
