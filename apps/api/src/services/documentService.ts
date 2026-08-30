import { randomUUID } from 'node:crypto';
import { errors } from '../errors';
import { getPool } from '../db/client';
import { auditLog } from '../audit/audit';
import { addEvent } from '../events/timeline';
import type { Storage } from '../storage/storage';
import { resolveStorageKey } from '../storage/storage';
import { extractText } from '../extract';
import { setOcrConfigured } from '../extract/extractors';
import { getEnv } from '../config';
import { getStorage as getStorageModule } from '../storage';

setOcrConfigured(getEnv().OCR_ENABLED === 'true');

export interface DocumentUploadInput {
  organizationId: string;
  processId?: string | null;
  clientId?: string | null;
  name: string;
  fileName: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
  uploadedBy: string;
  ip?: string;
}

export async function uploadDocument(storage: Storage, input: DocumentUploadInput) {
  const pool = getPool();
  if (input.processId) {
    const processRes = await pool.query('SELECT id, client_id FROM cases WHERE id = $1 AND organization_id = $2', [input.processId, input.organizationId]);
    if (processRes.rows.length === 0) throw errors.validation('Processo inválido para esta organização.');
  }
  if (input.clientId) {
    const clientRes = await pool.query('SELECT id FROM clients WHERE id = $1 AND organization_id = $2', [input.clientId, input.organizationId]);
    if (clientRes.rows.length === 0) throw errors.validation('Cliente inválido para esta organização.');
  }

  const id = randomUUID();
  const key = resolveStorageKey(input.organizationId, id, input.fileName);
  let stored;
  try {
    stored = await storage.save(input.buffer, key);
  } catch (err) {
    if (err instanceof Error && 'status' in err && (err as { status: number }).status === 503) throw err;
    throw errors.storageUnavailable();
  }

  const res = await pool.query(
    `INSERT INTO documents (id, organization_id, process_id, client_id, name, file_name, mime_type, storage_path, size, hash, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [
      id,
      input.organizationId,
      input.processId ?? null,
      input.clientId ?? null,
      input.name,
      input.fileName,
      input.mimeType,
      stored.key,
      stored.size,
      stored.hash,
      input.uploadedBy,
    ],
  );
  const doc = res.rows[0];

  if (input.processId) {
    await addEvent({
      processId: input.processId,
      type: 'DOCUMENT_UPLOADED',
      title: 'Documento anexado',
      description: `Documento "${input.name}" (${input.fileName}) anexado ao processo.`,
      source: 'internal',
      sourceReference: doc.id,
      createdBy: input.uploadedBy,
    });
  }
  void auditLog({
    organizationId: input.organizationId,
    userId: input.uploadedBy,
    action: 'DOCUMENT_UPLOADED',
    entity: 'document',
    entityId: doc.id,
    after: { name: input.name, fileName: input.fileName, mimeType: input.mimeType, size: input.size, hash: stored.hash, processId: input.processId },
    ip: input.ip,
    metadata: { size: input.size },
  });
  return doc;
}

export async function listDocuments(organizationId: string, opts: { processId?: string; clientId?: string; page?: number; pageSize?: number }) {
  const pool = getPool();
  const params: unknown[] = [organizationId];
  let where = 'd.organization_id = $1 AND d.deleted_at IS NULL';
  if (opts.processId) {
    params.push(opts.processId);
    where += ` AND d.process_id = $${params.length}`;
  }
  if (opts.clientId) {
    params.push(opts.clientId);
    where += ` AND d.client_id = $${params.length}`;
  }
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 50;
  params.push(pageSize, (page - 1) * pageSize);
  const res = await pool.query(
    `SELECT d.id, d.name, d.file_name, d.mime_type, d.size, d.hash, d.created_at, d.process_id, d.client_id,
       d.extraction_status, d.extraction_method, d.extracted_at,
       u.name AS uploaded_by_name, c.title AS process_title
     FROM documents d
     LEFT JOIN users u ON u.id = d.uploaded_by
     LEFT JOIN cases c ON c.id = d.process_id
     WHERE ${where}
     ORDER BY d.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: res.rows, page, pageSize };
}

export async function getDocument(organizationId: string, documentId: string) {
  const pool = getPool();
  const res = await pool.query(
    `SELECT d.*, u.name AS uploaded_by_name FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by
     WHERE d.id = $1 AND d.organization_id = $2 AND d.deleted_at IS NULL`,
    [documentId, organizationId],
  );
  if (res.rows.length === 0) throw errors.notFound('Documento não encontrado.');
  return res.rows[0];
}

export async function getDocumentContent(storage: Storage, organizationId: string, documentId: string) {
  const doc = await getDocument(organizationId, documentId);
  const buffer = await storage.read(doc.storage_path);
  return { doc, buffer };
}

export async function extractDocument(organizationId: string, documentId: string) {
  const pool = getPool();
  const doc = await getDocument(organizationId, documentId);
  const storage = getStorageModule();
  const buffer = await storage.read(doc.storage_path);
  const result = await extractText(doc.mime_type, buffer);
  const { text, method, status } = result;
  await pool.query(
    `UPDATE documents SET extracted_text = $1, extraction_status = $2, extraction_method = $3, extracted_at = now()
     WHERE id = $4`,
    [text, status, method, documentId],
  );
  void auditLog({
    organizationId,
    userId: doc.uploaded_by,
    action: 'DOCUMENT_TEXT_EXTRACTED',
    entity: 'document',
    entityId: documentId,
    after: { name: doc.name, status, method, length: text?.length ?? 0 },
    metadata: { status },
  });
  if (doc.process_id) {
    await addEvent({
      processId: doc.process_id,
      type: 'DOCUMENT_TEXT_EXTRACTED',
      title: status === 'EXTRACTED' ? 'Texto extraído do documento' : 'Extração de texto não realizada',
      description: status === 'EXTRACTED'
        ? `Texto extraído do documento "${doc.name}" (${method ?? 'n/a'}, ${text?.length ?? 0} caracteres).`
        : `A extração de texto do documento "${doc.name}" não foi possível (${status === 'NOT_CONFIGURED' ? 'OCR não configurado' : 'falha'}).`,
      source: 'internal',
      sourceReference: documentId,
      createdBy: doc.uploaded_by,
    });
  }
  return { id: documentId, status, method, textLength: text?.length ?? 0, text };
}

export async function deleteDocument(organizationId: string, documentId: string, userId: string, ip?: string) {
  const pool = getPool();
  const doc = await getDocument(organizationId, documentId);
  await pool.query('UPDATE documents SET deleted_at = now() WHERE id = $1', [documentId]);
  if (doc.process_id) {
    await addEvent({
      processId: doc.process_id,
      type: 'DOCUMENT_DELETED',
      title: 'Documento excluído',
      description: `Documento "${doc.name}" foi excluído.`,
      source: 'internal',
      sourceReference: doc.id,
      createdBy: userId,
    });
  }
  void auditLog({ organizationId, userId, action: 'DOCUMENT_DELETED', entity: 'document', entityId: documentId, before: { name: doc.name, fileName: doc.file_name }, ip });
  return { ok: true };
}
