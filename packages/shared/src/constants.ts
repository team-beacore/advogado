export const ROLES = ['ADMIN', 'LAWYER', 'ASSISTANT'] as const;
export type Role = (typeof ROLES)[number];

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
export const NOTIFICATION_CHANNELS = ['EMAIL', 'WHATSAPP'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export const CAPTURE_ADAPTERS = ['PJE', 'ESA', 'PROJUDI'] as const;
export type CaptureAdapter = (typeof CAPTURE_ADAPTERS)[number];