import type { ChannelMessage, ChannelResult, NotificationChannel } from './types';

export class EmailChannel implements NotificationChannel {
  readonly name = 'EMAIL' as const;

  isConfigured(config: Record<string, unknown> | null): boolean {
    if (!config) return false;
    return Boolean(config.host && config.port && config.user && config.pass && config.from);
  }

  async send(msg: ChannelMessage, config: Record<string, unknown>): Promise<ChannelResult> {
    if (!this.isConfigured(config)) {
      return { channel: 'EMAIL', status: 'NOT_CONFIGURED', error: 'SMTP não configurado.' };
    }
    try {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host: String(config.host),
        port: Number(config.port),
        secure: Boolean(config.secure),
        auth: { user: String(config.user), pass: String(config.pass) },
      });
      const info = await transporter.sendMail({
        from: String(config.from),
        to: msg.to,
        subject: msg.subject ?? '',
        text: msg.body,
      });
      return {
        channel: 'EMAIL',
        status: 'SENT',
        externalReference: info.messageId ?? null,
      };
    } catch (err) {
      return { channel: 'EMAIL', status: 'FAILED', error: (err as Error).message };
    }
  }
}