import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app';

describe('Auth', () => {
  let app: ReturnType<typeof createApp>;

  before(async () => {
    app = createApp();
  });

  it('should return 401 for /api/auth/me without cookie', async () => {
    const res = await request(app).get('/api/auth/me');
    assert.equal(res.status, 401);
  });

  it('should register a user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Test', email: `test${Date.now()}@example.com`, password: 'test1234' });
    assert.equal(res.status, 201);
    assert.ok(res.body.user);
    assert.equal(res.body.user.name, 'Test');
  });

  it('should login', async () => {
    const email = `login${Date.now()}@example.com`;
    await request(app).post('/api/auth/register').send({ name: 'Login', email, password: 'test1234' });
    const res = await request(app).post('/api/auth/login').send({ email, password: 'test1234' });
    assert.equal(res.status, 200);
    assert.ok(res.body.user);
    assert.equal(res.body.user.email, email);
  });

  it('should logout', async () => {
    const email = `logout${Date.now()}@example.com`;
    await request(app).post('/api/auth/register').send({ name: 'Logout', email, password: 'test1234' });
    const loginRes = await request(app).post('/api/auth/login').send({ email, password: 'test1234' });
    const cookie = loginRes.headers['set-cookie']?.[0]?.split(';')[0];
    assert.ok(cookie);
    const logoutRes = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    assert.equal(logoutRes.status, 200);
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    assert.equal(me.status, 401);
  });
});