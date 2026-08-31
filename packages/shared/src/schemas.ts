import { z } from 'zod';
import {
  CASE_STATUS,
  CONTRACT_STATUS,
  INVOICE_STATUS,
  INTERNAL_ROLES,
  LEAD_STATUS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUS,
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  PUBLICATION_STATUS,
  ROLES,
  TASK_PRIORITY,
  TASK_STATUS,
} from './constants';

export const emailSchema = z.string().trim().email().max(255);

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(255),
  email: emailSchema,
  password: z.string().min(8).max(128),
  phone: z.string().trim().max(40).optional().or(z.literal('')).transform((v) => (v ? v : null)),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(255),
});

export const createClientSchema = z.object({
  name: z.string().trim().min(2).max(255),
  email: emailSchema.optional().or(z.literal('')).transform((v) => (v ? v : null)),
  phone: z.string().trim().max(40).optional().or(z.literal('')).transform((v) => (v ? v : null)),
  cpfCnpj: z.string().trim().max(20).optional().or(z.literal('')).transform((v) => (v ? v : null)),
  notes: z.string().trim().max(5000).optional().or(z.literal('')).transform((v) => (v ? v : null)),
});

export const updateClientSchema = createClientSchema.partial();

export const createCaseSchema = z.object({
  clientId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(2).max(255),
  processNumber: z.string().trim().max(120).optional().or(z.literal('')).transform((v) => (v ? v : null)),
  court: z.string().trim().max(255).optional().or(z.literal('')).transform((v) => (v ? v : null)),
  jurisdiction: z.string().trim().max(255).optional().or(z.literal('')).transform((v) => (v ? v : null)),
  area: z.string().trim().max(120).optional().or(z.literal('')).transform((v) => (v ? v : null)),
  description: z.string().trim().max(10000).optional().or(z.literal('')).transform((v) => (v ? v : null)),
  status: z.enum(CASE_STATUS).default('ACTIVE'),
  responsibleId: z.string().uuid().nullable().optional(),
});

export const updateCaseSchema = createCaseSchema.partial();

export const listCasesQuerySchema = z.object({
  search: z.string().trim().max(255).optional(),
  status: z.enum(CASE_STATUS).optional(),
  clientId: z.string().uuid().optional(),
  area: z.string().trim().max(120).optional(),
  sort: z.enum(['created_desc', 'created_asc', 'title_asc', 'due_date_asc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const createTaskSchema = z.object({
  processId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(2).max(255),
  description: z.string().trim().max(10000).optional().or(z.literal('')).transform((v) => (v ? v : null)),
  priority: z.enum(TASK_PRIORITY).default('MEDIUM'),
  status: z.enum(TASK_STATUS).default('TODO'),
  dueDate: z.string().datetime({ offset: true }).nullable().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
});

export const updateTaskSchema = createTaskSchema.partial();

export const createPublicationSchema = z.object({
  processId: z.string().uuid(),
  source: z.string().trim().max(255).optional().or(z.literal('')).transform((v) => (v ? v : null)),
  availabilityDate: z.string().datetime({ offset: true }).nullable().optional(),
  publicationDate: z.string().datetime({ offset: true }).nullable().optional(),
  content: z.string().trim().min(1).max(100000),
  externalReference: z.string().trim().max(255).optional().or(z.literal('')).transform((v) => (v ? v : null)),
  status: z.enum(PUBLICATION_STATUS).default('PENDING'),
  possibleDueDate: z.string().datetime({ offset: true }).nullable().optional(),
  notes: z.string().trim().max(5000).optional().or(z.literal('')).transform((v) => (v ? v : null)),
});

export const updatePublicationSchema = createPublicationSchema.partial();

export const createLeadSchema = z.object({
  name: z.string().trim().min(2).max(255),
  phone: z.string().trim().max(40).optional().or(z.literal('')).transform((v) => (v ? v : null)),
  source: z.string().trim().max(120).optional().or(z.literal('')).transform((v) => (v ? v : null)),
  subject: z.string().trim().max(1000).optional().or(z.literal('')).transform((v) => (v ? v : null)),
  status: z.enum(LEAD_STATUS).default('NEW'),
  assignedTo: z.string().uuid().nullable().optional(),
});

export const updateLeadSchema = createLeadSchema.partial();

export const convertLeadSchema = z.object({
  clientName: z.string().trim().min(2).max(255).optional(),
});

export const updateNotificationSchema = z.object({
  status: z.enum(NOTIFICATION_STATUS),
});

export const updateUserProfileSchema = z.object({
  name: z.string().trim().min(2).max(255).optional(),
  phone: z.string().trim().max(40).optional().or(z.literal('')).transform((v) => (v ? v : null)),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

export const userNotificationPreferencesSchema = z.object({
  emailEnabled: z.boolean().optional(),
  newPublication: z.boolean().optional(),
  deadlineAlert: z.boolean().optional(),
  paymentAlert: z.boolean().optional(),
});

export const clientNotificationPreferencesSchema = z.object({
  emailEnabled: z.boolean().optional(),
  processUpdatesEnabled: z.boolean().optional(),
});

export const aiDraftSchema = z.object({
  instruction: z.string().trim().min(1).max(8000),
});

export const addMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(INTERNAL_ROLES).default('LAWYER'),
});

export const createEventSchema = z.object({
  type: z.string().trim().min(1).max(60),
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().max(10000).optional().or(z.literal('')).transform((v) => (v ? v : null)),
  source: z.string().trim().max(120).optional().or(z.literal('')).transform((v) => (v ? v : null)),
  sourceReference: z.string().trim().max(255).optional().or(z.literal('')).transform((v) => (v ? v : null)),
});

// --- Financeiro ---
export const createContractSchema = z.object({
  clientId: z.string().uuid().nullable().optional(),
  caseId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(2).max(255),
  description: z.string().trim().max(10000).optional().or(z.literal('')).transform((v) => (v ? v : null)),
  totalValue: z.coerce.number().nonnegative().default(0),
  status: z.enum(CONTRACT_STATUS).default('DRAFT'),
  startDate: z.string().datetime({ offset: true }).nullable().optional(),
  endDate: z.string().datetime({ offset: true }).nullable().optional(),
  notes: z.string().trim().max(5000).optional().or(z.literal('')).transform((v) => (v ? v : null)),
});

export const updateContractSchema = createContractSchema.partial();

export const createInvoiceSchema = z.object({
  contractId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  description: z.string().trim().min(2).max(255),
  amount: z.coerce.number().nonnegative().default(0),
  status: z.enum(INVOICE_STATUS).default('PENDING'),
  dueDate: z.string().datetime({ offset: true }).nullable().optional(),
  externalReference: z.string().trim().max(255).optional().or(z.literal('')).transform((v) => (v ? v : null)),
  installmentCount: z.coerce.number().int().min(1).default(1),
});

export const updateInvoiceSchema = createInvoiceSchema.partial();

export const registerPaymentSchema = z.object({
  invoiceId: z.string().uuid().nullable().optional(),
  installmentId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  amount: z.coerce.number().positive(),
  method: z.enum(PAYMENT_METHODS).default('PIX'),
  status: z.enum(PAYMENT_STATUS).default('PAID'),
  gateway: z.string().trim().max(120).optional().or(z.literal('')).transform((v) => (v ? v : null)),
  externalReference: z.string().trim().max(255).optional().or(z.literal('')).transform((v) => (v ? v : null)),
  metadata: z.record(z.unknown()).optional(),
});

export const chargePaymentSchema = z.object({
  invoiceId: z.string().uuid(),
  gateway: z.enum(['mercadopago', 'stripe']).default('mercadopago'),
  metadata: z.record(z.unknown()).optional(),
});

// --- Notificações por canal ---
export const updateNotificationChannelSchema = z.object({
  channel: z.enum(NOTIFICATION_CHANNELS),
  enabled: z.boolean().default(false),
  config: z.record(z.unknown()).optional(),
});

// --- Captura de publicações ---
export const runCaptureSchema = z.object({
  adapters: z.array(z.enum(['PJE', 'ESAJ', 'PROJUDI'])).optional(),
});

export const captureConfigSchema = z.object({
  adapter: z.enum(['PJE', 'ESAJ', 'PROJUDI']),
  enabled: z.boolean().default(true),
  login: z.string().trim().optional().or(z.literal('')).transform((v) => (v ? v : undefined)),
  password: z.string().optional().or(z.literal('')).transform((v) => (v && v !== 'placeholder' ? v : undefined)),
  baseUrl: z.string().trim().max(500).optional().or(z.literal('')).transform((v) => (v ? v : undefined)),
});

// --- Permissões granulares por processo ---
export const updateCaseMemberPermissionsSchema = z.object({
  canView: z.boolean().optional(),
  canEdit: z.boolean().optional(),
  canManage: z.boolean().optional(),
  role: z.enum(INTERNAL_ROLES).optional(),
});

// --- Equipe / membros da organização ---
export const addMemberByEmailSchema = z.object({
  email: z.string().trim().email().max(255),
  role: z.enum(INTERNAL_ROLES).default('LAWYER'),
  name: z.string().trim().min(2).max(255).optional(),
});

// --- Portal do cliente ---
export const clientPortalInviteSchema = z.object({
  email: z.string().trim().email().max(255),
});

export const clientPortalLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const clientCaseShareSchema = z.object({
  caseId: z.string().uuid(),
  canViewDocuments: z.boolean().default(false),
});
