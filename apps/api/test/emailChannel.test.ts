import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EmailChannel } from '../src/notify/email';
import type { ChannelMessage } from '../src/notify/types';

describe('EmailChannel — SMTP real', () => {
  const channel = new EmailChannel();
  const message: ChannelMessage = { to: 'joao@example.com', subject: 'Nova intimação — Proc', body: 'Existe uma nova intimação. Acesse a plataforma.' };

  it('sem configuração SMTP retorna NOT_CONFIGURED (não finge envio)', async () => {
    assert.equal(channel.isConfigured(null), false);
    const res = await channel.send(message, {});
    assert.equal(res.status, 'NOT_CONFIGURED');
    assert.ok(res.error);
  });

  it('configuração incompleta retorna NOT_CONFIGURED', async () => {
    assert.equal(channel.isConfigured({ host: 'smtp.test.com', user: 'u', pass: 'p' }), false);
    const res = await channel.send(message, { host: 'smtp.test.com', port: 587, user: 'u' });
    assert.equal(res.status, 'NOT_CONFIGURED');
  });

  it('falha de conexão SMTP retorna FAILED com erro', async () => {
    const res = await channel.send(message, {
      host: 'invalid-smtp-host.invalid',
      port: 587,
      user: 'test',
      pass: 'test',
      from: 'test@test.com',
    });
    assert.equal(res.status, 'FAILED');
    assert.ok(res.error);
  });
});
