import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app';
import { getPool } from '../src/db/client';

export function makeApp(): Express {
  return createApp();
}

let counter = 0;

export function uniqueEmail(prefix = 'user'): string {
  counter += 1;
  return `${prefix}${Date.now()}_${counter}@test.local`;
}

export interface Session {
  cookie: string;
  userId: string;
  email: string;
  name: string;
  orgId: string;
  role: string;
}

export interface AuthHelper {
  app: Express;
  registerAndLogin(opts?: { role?: string; email?: string; name?: string; createOrg?: boolean }): Promise<Session>;
}

export function createAuthHelper(app: Express): AuthHelper {
  return {
    app,
    async registerAndLogin(opts = {}) {
      const email = opts.email ?? uniqueEmail();
      const name = opts.name ?? 'Test User';
      const password = 'test1234';
      await request(app).post('/api/auth/register').send({ name, email, password }).expect(201);
      const loginRes = await request(app).post('/api/auth/login').send({ email, password }).expect(200);
      const cookie = loginRes.headers['set-cookie']?.[0]?.split(';')[0];
      if (!cookie) throw new Error('no cookie');
      const userId = loginRes.body.user.id;

      let orgId = loginRes.body.organizationId;
      if (opts.createOrg !== false && !orgId) {
        const orgRes = await request(app).post('/api/organizations').set('Cookie', cookie).send({ name: `Org ${email}` }).expect(201);
        orgId = orgRes.body.id;
        await request(app).post('/api/auth/switch-org').set('Cookie', cookie).send({ organizationId: orgId }).expect(200);
      }

      return { cookie, userId, email, name, orgId, role: opts.role ?? 'ADMIN' };
    },
  };
}

export async function createSecondUserInOrg(app: Express, admin: Session, opts: { role?: string; email?: string } = {}) {
  const email = opts.email ?? uniqueEmail('member');
  const password = 'test1234';
  await request(app).post('/api/auth/register').send({ name: 'Member', email, password }).expect(201);
  const loginRes = await request(app).post('/api/auth/login').send({ email, password }).expect(200);
  const cookie = loginRes.headers['set-cookie']?.[0]?.split(';')[0]!;
  // admin adds user to org
  await request(app)
    .post('/api/organizations/members')
    .set('Cookie', admin.cookie)
    .send({ email, role: opts.role ?? 'LAWYER' })
    .expect(201);
  await request(app).post('/api/auth/switch-org').set('Cookie', cookie).send({ organizationId: admin.orgId }).expect(200);
  return { cookie, userId: loginRes.body.user.id, email, name: 'Member', orgId: admin.orgId, role: opts.role ?? 'LAWYER' };
}

export async function resetDb(): Promise<void> {
  const pool = getPool();
  await pool.query(
    `TRUNCATE TABLE audit_logs, ai_approvals, ai_interactions, case_events, case_members, documents,
     legal_publications, tasks, notification_deliveries, notifications, notification_preferences,
     client_notification_preferences, leads, clients, cases, organization_members, organizations,
     sessions, users RESTART IDENTITY CASCADE`,
  );
}

/** Cria um SUPER ADMIN (implantador) diretamente no banco e retorna a sessão. */
export async function createSuperAdmin(app: Express): Promise<Session> {
  const pool = getPool();
  const email = uniqueEmail('super');
  const password = 'test1234';
  const { ScryptHasher } = await import('../src/auth/password');
  const hasher = new ScryptHasher();
  const hash = hasher.hash(password);
  await pool.query(
    `INSERT INTO users (name, email, password_hash, is_super_admin) VALUES ($1, $2, $3, TRUE)`,
    ['Super Admin', email, hash],
  );
  const loginRes = await request(app).post('/api/auth/login').send({ email, password }).expect(200);
  const cookie = loginRes.headers['set-cookie']?.[0]?.split(';')[0]!;
  return { cookie, userId: loginRes.body.user.id, email, name: 'Super Admin', orgId: '', role: 'SUPER_ADMIN' };
}
