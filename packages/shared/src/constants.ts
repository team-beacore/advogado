export const ROLES = ['SUPER_ADMIN', 'ADMIN', 'LAWYER', 'ASSISTANT', 'FINANCE'] as const;
export type Role = (typeof ROLES)[number];

export const INTERNAL_ROLES = ['ADMIN', 'LAWYER', 'ASSISTANT', 'FINANCE'] as const;
export type InternalRole = (typeof INTERNAL_ROLES)[number];

export const PERMISSIONS = {
  ORG_MANAGE: 'org.manage',
  TEAM_MANAGE: 'team.manage',
  SETTINGS_MANAGE: 'settings.manage',
  NOTIFICATIONS_MANAGE: 'notifications.manage',
  CAPTURE_MANAGE: 'capture.manage',
  CLIENTS_READ: 'clients.read',
  CLIENTS_CREATE: 'clients.create',
  CLIENTS_UPDATE: 'clients.update',
  PROCESSES_READ: 'processes.read',
  PROCESSES_CREATE: 'processes.create',
  PROCESSES_UPDATE: 'processes.update',
  PUBLICATIONS_READ: 'publications.read',
  PUBLICATIONS_CREATE: 'publications.create',
  PUBLICATIONS_ANALYZE: 'publications.analyze',
  DOCUMENTS_READ: 'documents.read',
  DOCUMENTS_CREATE: 'documents.create',
  TASKS_READ: 'tasks.read',
  TASKS_CREATE: 'tasks.create',
  AI_USE: 'ai.use',
  LEADS_READ: 'leads.read',
  LEADS_CREATE: 'leads.create',
  BILLING_READ: 'billing.read',
  BILLING_MANAGE: 'billing.manage',
  PAYMENTS_READ: 'payments.read',
  PAYMENTS_MANAGE: 'payments.manage',
  AUDIT_READ: 'audit.read',
  CLIENT_PORTAL_MANAGE: 'client_portal.manage',
} as const;
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: Object.values(PERMISSIONS),
  ADMIN: [
    PERMISSIONS.ORG_MANAGE,
    PERMISSIONS.TEAM_MANAGE,
    PERMISSIONS.SETTINGS_MANAGE,
    PERMISSIONS.NOTIFICATIONS_MANAGE,
    PERMISSIONS.CAPTURE_MANAGE,
    PERMISSIONS.CLIENTS_READ,
    PERMISSIONS.CLIENTS_CREATE,
    PERMISSIONS.CLIENTS_UPDATE,
    PERMISSIONS.PROCESSES_READ,
    PERMISSIONS.PROCESSES_CREATE,
    PERMISSIONS.PROCESSES_UPDATE,
    PERMISSIONS.PUBLICATIONS_READ,
    PERMISSIONS.PUBLICATIONS_CREATE,
    PERMISSIONS.PUBLICATIONS_ANALYZE,
    PERMISSIONS.DOCUMENTS_READ,
    PERMISSIONS.DOCUMENTS_CREATE,
    PERMISSIONS.TASKS_READ,
    PERMISSIONS.TASKS_CREATE,
    PERMISSIONS.AI_USE,
    PERMISSIONS.LEADS_READ,
    PERMISSIONS.LEADS_CREATE,
    PERMISSIONS.BILLING_READ,
    PERMISSIONS.BILLING_MANAGE,
    PERMISSIONS.PAYMENTS_READ,
    PERMISSIONS.PAYMENTS_MANAGE,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.CLIENT_PORTAL_MANAGE,
  ],
  LAWYER: [
    PERMISSIONS.CLIENTS_READ,
    PERMISSIONS.CLIENTS_CREATE,
    PERMISSIONS.CLIENTS_UPDATE,
    PERMISSIONS.PROCESSES_READ,
    PERMISSIONS.PROCESSES_CREATE,
    PERMISSIONS.PROCESSES_UPDATE,
    PERMISSIONS.PUBLICATIONS_READ,
    PERMISSIONS.PUBLICATIONS_CREATE,
    PERMISSIONS.PUBLICATIONS_ANALYZE,
    PERMISSIONS.DOCUMENTS_READ,
    PERMISSIONS.DOCUMENTS_CREATE,
    PERMISSIONS.TASKS_READ,
    PERMISSIONS.TASKS_CREATE,
    PERMISSIONS.AI_USE,
    PERMISSIONS.LEADS_READ,
    PERMISSIONS.LEADS_CREATE,
    PERMISSIONS.BILLING_READ,
    PERMISSIONS.PAYMENTS_READ,
    PERMISSIONS.AUDIT_READ,
  ],
  ASSISTANT: [
    PERMISSIONS.CLIENTS_READ,
    PERMISSIONS.CLIENTS_CREATE,
    PERMISSIONS.CLIENTS_UPDATE,
    PERMISSIONS.PROCESSES_READ,
    PERMISSIONS.PROCESSES_CREATE,
    PERMISSIONS.PUBLICATIONS_READ,
    PERMISSIONS.PUBLICATIONS_CREATE,
    PERMISSIONS.DOCUMENTS_READ,
    PERMISSIONS.DOCUMENTS_CREATE,
    PERMISSIONS.TASKS_READ,
    PERMISSIONS.TASKS_CREATE,
    PERMISSIONS.LEADS_READ,
    PERMISSIONS.LEADS_CREATE,
  ],
  FINANCE: [
    PERMISSIONS.CLIENTS_READ,
    PERMISSIONS.BILLING_READ,
    PERMISSIONS.BILLING_MANAGE,
    PERMISSIONS.PAYMENTS_READ,
    PERMISSIONS.PAYMENTS_MANAGE,
  ],
};

export const CASE_STATUS = [
  'ACTIVE',
  'SUSPENDED',
  'ARCHIVED',
  'CLOSED',
  'DRAFT',
] as const;
export type CaseStatus = (typeof CASE_STATUS)[number];

export const TASK_STATUS = ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export type TaskStatus = (typeof TASK_STATUS)[number];

export const TASK_PRIORITY = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type TaskPriority = (typeof TASK_PRIORITY)[number];

export const LEAD_STATUS = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST'] as const;
export type LeadStatus = (typeof LEAD_STATUS)[number];

export const PUBLICATION_STATUS = ['PENDING', 'READ', 'PROCESSED', 'CANCELLED'] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUS)[number];

export const NOTIFICATION_STATUS = ['PENDING', 'READ'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUS)[number];

export const AI_OPERATION_TYPE = ['RESUME', 'ANALYZE_INTIMATION', 'DRAFT'] as const;
export type AIOperationType = (typeof AI_OPERATION_TYPE)[number];

export const AI_APPROVAL_STATUS = ['PENDING', 'APPROVED', 'EDITED', 'REJECTED'] as const;
export type AIApprovalStatus = (typeof AI_APPROVAL_STATUS)[number];

export const EVENT_TYPES = [
  'PROCESS_CREATED',
  'DOCUMENT_UPLOADED',
  'TASK_CREATED',
  'TASK_COMPLETED',
  'PUBLICATION_REGISTERED',
  'AI_EXECUTED',
  'AI_REVIEWED',
  'STATUS_CHANGED',
  'CLIENT_ASSOCIATED',
  'CASE_MEMBER_ADDED',
  'NOTE_ADDED',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'text/plain',
  'text/csv',
  'application/vnd.oasis.opendocument.text',
] as const;

export const CONTRACT_STATUS = ['DRAFT', 'ACTIVE', 'FINISHED', 'CANCELLED'] as const;
export type ContractStatus = (typeof CONTRACT_STATUS)[number];
export const INVOICE_STATUS = ['PENDING', 'PAID', 'OVERDUE', 'CANCELLED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUS)[number];
export const INSTALLMENT_STATUS = ['PENDING', 'PAID', 'OVERDUE', 'CANCELLED'] as const;
export type InstallmentStatus = (typeof INSTALLMENT_STATUS)[number];
export const PAYMENT_STATUS = ['PENDING', 'PAID', 'FAILED', 'REFUNDED', 'CANCELLED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[number];
export const PAYMENT_METHODS = ['PIX', 'CREDIT_CARD', 'BOLETO', 'TRANSFER', 'CASH', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const NOTIFICATION_CHANNELS = ['EMAIL'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export const CAPTURE_ADAPTERS = ['PJE', 'ESA', 'PROJUDI'] as const;
export type CaptureAdapter = (typeof CAPTURE_ADAPTERS)[number];