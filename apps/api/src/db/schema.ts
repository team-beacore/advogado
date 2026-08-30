import {
  bigint,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['ADMIN', 'LAWYER', 'ASSISTANT']);
export const caseStatusEnum = pgEnum('case_status', ['ACTIVE', 'SUSPENDED', 'ARCHIVED', 'CLOSED', 'DRAFT']);
export const taskStatusEnum = pgEnum('task_status', ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED']);
export const taskPriorityEnum = pgEnum('task_priority', ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const leadStatusEnum = pgEnum('lead_status', ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST']);
export const publicationStatusEnum = pgEnum('publication_status', ['PENDING', 'READ', 'PROCESSED', 'CANCELLED']);
export const notificationStatusEnum = pgEnum('notification_status', ['PENDING', 'READ']);
export const aiApprovalStatusEnum = pgEnum('ai_approval_status', ['PENDING', 'APPROVED', 'EDITED', 'REJECTED']);
export const aiOperationEnum = pgEnum('ai_operation', ['RESUME', 'ANALYZE_INTIMATION', 'DRAFT']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('users_email_unique').on(t.email)]);

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const organizationMembers = pgTable('organization_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: roleEnum('role').notNull().default('LAWYER'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('organization_members_unique').on(t.organizationId, t.userId),
  index('organization_members_user_idx').on(t.userId),
]);

export const clients = pgTable('clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  cpfCnpj: text('cpf_cnpj'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('clients_organization_idx').on(t.organizationId),
  index('clients_name_idx').on(t.name),
]);

export const cases = pgTable('cases', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  processNumber: text('process_number'),
  court: text('court'),
  jurisdiction: text('jurisdiction'),
  area: text('area'),
  status: caseStatusEnum('status').notNull().default('ACTIVE'),
  description: text('description'),
  responsibleId: uuid('responsible_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('cases_process_number_unique_per_org').on(t.organizationId, t.processNumber),
  index('cases_organization_idx').on(t.organizationId),
  index('cases_client_idx').on(t.clientId),
  index('cases_status_idx').on(t.organizationId, t.status),
]);

export const caseMembers = pgTable('case_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id').notNull().references(() => cases.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: roleEnum('role').notNull().default('LAWYER'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('case_members_unique').on(t.caseId, t.userId),
  index('case_members_user_idx').on(t.userId),
]);

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  processId: uuid('process_id').references(() => cases.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  storagePath: text('storage_path').notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  hash: text('hash').notNull(),
  uploadedBy: uuid('uploaded_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('documents_organization_idx').on(t.organizationId),
  index('documents_process_idx').on(t.processId),
  index('documents_client_idx').on(t.clientId),
]);

export const caseEvents = pgTable('case_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  processId: uuid('process_id').notNull().references(() => cases.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  source: text('source'),
  sourceReference: text('source_reference'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('case_events_process_idx').on(t.processId, t.createdAt),
]);

export const legalPublications = pgTable('legal_publications', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  processId: uuid('process_id').notNull().references(() => cases.id, { onDelete: 'cascade' }),
  source: text('source'),
  availabilityDate: timestamp('availability_date', { withTimezone: true }),
  publicationDate: timestamp('publication_date', { withTimezone: true }),
  content: text('content').notNull(),
  externalReference: text('external_reference'),
  status: publicationStatusEnum('status').notNull().default('PENDING'),
  possibleDueDate: timestamp('possible_due_date', { withTimezone: true }),
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('legal_publications_organization_idx').on(t.organizationId),
  index('legal_publications_process_idx').on(t.processId),
  index('legal_publications_status_idx').on(t.organizationId, t.status),
]);

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  processId: uuid('process_id').references(() => cases.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  priority: taskPriorityEnum('priority').notNull().default('MEDIUM'),
  status: taskStatusEnum('status').notNull().default('TODO'),
  dueDate: timestamp('due_date', { withTimezone: true }),
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('tasks_organization_idx').on(t.organizationId),
  index('tasks_process_idx').on(t.processId),
  index('tasks_status_due_idx').on(t.organizationId, t.status, t.dueDate),
  index('tasks_assigned_idx').on(t.assignedTo),
]);

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  processId: uuid('process_id').references(() => cases.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  status: notificationStatusEnum('status').notNull().default('PENDING'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  readAt: timestamp('read_at', { withTimezone: true }),
}, (t) => [
  index('notifications_organization_idx').on(t.organizationId),
  index('notifications_user_status_idx').on(t.userId, t.status),
]);

export const aiInteractions = pgTable('ai_interactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  processId: uuid('process_id').references(() => cases.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: aiOperationEnum('type').notNull(),
  promptReference: text('prompt_reference'),
  model: text('model'),
  inputReference: jsonb('input_reference').$type<Record<string, unknown>>(),
  output: jsonb('output').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('ai_interactions_organization_idx').on(t.organizationId),
  index('ai_interactions_process_idx').on(t.processId),
]);

export const aiApprovals = pgTable('ai_approvals', {
  id: uuid('id').primaryKey().defaultRandom(),
  aiInteractionId: uuid('ai_interaction_id').notNull().references(() => aiInteractions.id, { onDelete: 'cascade' }),
  reviewerId: uuid('reviewer_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: aiApprovalStatusEnum('status').notNull().default('PENDING'),
  editedOutput: jsonb('edited_output').$type<Record<string, unknown>>(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('ai_approvals_interaction_idx').on(t.aiInteractionId)]);

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  before: jsonb('before').$type<Record<string, unknown> | null>(),
  after: jsonb('after').$type<Record<string, unknown> | null>(),
  ip: text('ip'),
  metadata: jsonb('metadata').$type<Record<string, unknown> | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('audit_logs_organization_idx').on(t.organizationId, t.createdAt),
  index('audit_logs_entity_idx').on(t.entity, t.entityId),
  index('audit_logs_user_idx').on(t.userId),
]);

export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  phone: text('phone'),
  source: text('source'),
  subject: text('subject'),
  status: leadStatusEnum('status').notNull().default('NEW'),
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  convertedClientId: uuid('converted_client_id').references(() => clients.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('leads_organization_idx').on(t.organizationId),
  index('leads_status_idx').on(t.organizationId, t.status),
]);

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }).defaultNow().notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
}, (t) => [
  uniqueIndex('sessions_token_hash_unique').on(t.tokenHash),
  index('sessions_user_idx').on(t.userId),
]);

export const settings = pgTable('settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: jsonb('value').$type<Record<string, unknown> | null>(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('settings_org_key_unique').on(t.organizationId, t.key),
]);
