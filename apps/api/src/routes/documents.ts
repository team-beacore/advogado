import { Router } from 'express';
import type { Request } from 'express';
import multer from 'multer';
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE } from '@advogado/shared';
import { requireAuth, requireOrg, getOrgId } from '../auth/middleware';
import * as documentService from '../services/documentService';
import { getStorage } from '../storage';
import { auditLog } from '../audit/audit';
import { assertCasePermission } from '../services/caseService';

async function checkProcessPermission(req: Request, caseId: string, required: 'view' | 'edit') {
  await assertCasePermission(getOrgId(req), caseId, req.user!.id, required, req.user!.role);
}

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
});

router.use(requireAuth, requireOrg);

router.get('/', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const result = await documentService.listDocuments(orgId, {
      processId: typeof req.query.processId === 'string' ? req.query.processId : undefined,
      clientId: typeof req.query.clientId === 'string' ? req.query.clientId : undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 50,
    });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/', (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ code: 'PAYLOAD_TOO_LARGE', message: 'Arquivo excede o tamanho máximo permitido (50MB).' });
        return;
      }
      next(err);
      return;
    }
    try {
      const orgId = getOrgId(req);
      if (!req.file) {
        res.status(400).json({ code: 'VALIDATION', message: 'Nenhum arquivo enviado.' });
        return;
      }
      if (!ALLOWED_MIME_TYPES.includes(req.file.mimetype as (typeof ALLOWED_MIME_TYPES)[number])) {
        res.status(415).json({ code: 'UNSUPPORTED_MEDIA_TYPE', message: `Tipo de arquivo não suportado: ${req.file.mimetype}.` });
        return;
      }
      const processId = typeof req.body.processId === 'string' && req.body.processId ? req.body.processId : null;
      const clientId = typeof req.body.clientId === 'string' && req.body.clientId ? req.body.clientId : null;
      const name = typeof req.body.name === 'string' && req.body.name.trim() ? req.body.name.trim() : req.file.originalname;

      if (processId) {
        await checkProcessPermission(req, processId, 'edit');
      }

      const storage = getStorage();
      const doc = await documentService.uploadDocument(storage, {
        organizationId: orgId,
        processId,
        clientId,
        name,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        buffer: req.file.buffer,
        uploadedBy: req.user!.id,
        ip: req.ip,
      });
      res.status(201).json(doc);
    } catch (err) {
      next(err);
    }
  });
});

router.get('/:id/download', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const doc = await documentService.getDocument(orgId, req.params.id!);
    if (doc.process_id) {
      await checkProcessPermission(req, doc.process_id, 'view');
    }
    const storage = getStorage();
    const buffer = await storage.read(doc.storage_path);
    void auditLog({
      organizationId: orgId,
      userId: req.user!.id,
      action: 'DOCUMENT_VIEWED',
      entity: 'document',
      entityId: doc.id,
      after: { name: doc.name, fileName: doc.file_name },
      ip: req.ip,
      metadata: { action: 'download' },
    });
    res.setHeader('Content-Type', doc.mime_type);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.file_name)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const doc = await documentService.getDocument(orgId, req.params.id!);
    if (doc.process_id) {
      await checkProcessPermission(req, doc.process_id, 'view');
    }
    res.json(doc);
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const doc = await documentService.getDocument(orgId, req.params.id!);
    if (doc.process_id) {
      await checkProcessPermission(req, doc.process_id, 'edit');
    }
    const result = await documentService.deleteDocument(orgId, req.params.id!, req.user!.id, req.ip);
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/:id/extract', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const doc = await documentService.getDocument(orgId, req.params.id!);
    if (doc.process_id) {
      await checkProcessPermission(req, doc.process_id, 'edit');
    }
    const result = await documentService.extractDocument(orgId, req.params.id!);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;