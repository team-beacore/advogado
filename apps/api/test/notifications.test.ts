import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createAuthHelper, makeApp, resetDb } from './helpers';
import { setNotificationChannelsForTests } from '../src/notify/registry';
import type { NotificationChannel, ChannelMessage, ChannelResult } from '../src/notify/types';

class FakeEmailChannel implements NotificationChannel {
  readonly name = 'EMAIL' as const;
  lastMessage: ChannelMessage | null = null;
  isConfigured(_config: Record<string, unknown> | null): boolean { return true; }
  async send(msg: ChannelMessage, _config: Record<string, unknown>): Promise<ChannelResult> {
    this.lastMessage = msg;
    return { channel: 'EMAIL', status: 'SENT', externalReference: 'fake-msg-id' };
  }
}

describe('Notificações por canal', () => {
  const app = makeApp();
  const helper = createAuthHelper(app);
  const emailChannel = new FakeEmailChannel();

  before(async () => { await resetDb(); });
  after(async () => { setNotificationChannelsForTests(null); const { closePool } = await import('../src/db/client'); await closePool(); });
  beforeEach(async () => { await resetDb(); emailChannel.lastMessage = null; });

  it('channels status retorna not configured por padrão', async () => {
    const session = await helper.registerAndLogin();
    const res = await request(app).get('/api/notifications/channels/status').set('Cookie', session.cookie).expect(200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.every((c: { configured: boolean }) => !c.configured));
  });

  it('configura canal email e dispara envio ao registrar intimação', async () => {
    setNotificationChannelsForTests([emailChannel]);
    const session = await helper.registerAndLogin();

    await request(app)
      .put('/api/notifications/channels')
      .set('Cookie', session.cookie)
      .send({ channel: 'EMAIL', enabled: true, config: { host: 'smtp.test.com', port: 587, user: 'test', pass: 'test', from: 'test@test.com' } })
      .expect(200);

    const proc = await request(app)
      .post('/api/processes')
      .set('Cookie', session.cookie)
      .send({ title: 'Proc Notif', processNumber: '5555-55.2024.8.01.0001' })
      .expect(201);

    await request(app)
      .post('/api/publications')
      .set('Cookie', session.cookie)
      .send({ processId: proc.body.id, content: 'Intimação com notificação', possibleDueDate: new Date(Date.now() + 86400000).toISOString() })
      .expect(201);

    const deliveries = await request(app).get('/api/notifications/deliveries').set('Cookie', session.cookie).expect(200);
    assert.ok(deliveries.body.items.length > 0);
    assert.equal(deliveries.body.items[0].channel, 'EMAIL');
  });
});