import type { ChannelMessage, ChannelResult, NotificationChannel } from './types';
import { getEnv } from '../config';

interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

function parseSecure(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true' || value === '1';
  return Boolean(value);
}

/**
 * Resolve as configurações SMTP efetivas para o envio.
 * Prioridade:
 * 1. Configuração por organização (settings) — permite SMTP próprio por cliente/escritório.
 * 2. Variáveis de ambiente (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM) — padrão global.
 * Credenciais nunca são armazenadas no frontend nem commitadas no repositório.
 */
function resolveSmtp(config: Record<string, unknown> | null): SmtpSettings | null {
  const env = getEnv();
  const host = String(config?.host ?? '') || env.SMTP_HOST;
  const port = Number(config?.port ?? (env.SMTP_PORT || 587));
  const user = String(config?.user ?? '') || env.SMTP_USER;
  const pass = String(config?.pass ?? '') || env.SMTP_PASSWORD;
  const from = String(config?.from ?? '') || env.SMTP_FROM;
  const secure = typeof config?.secure !== 'undefined' ? parseSecure(config.secure) : env.SMTP_SECURE === 'true';
  if (!host || !port || !user || !pass || !from) return null;
  return { host, port, secure, user, pass, from };
}

function buildHtml(subject: string, body: string): string {
  const lines = body.split('\n').map((l) => `<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#334155;">${escapeHtml(l).replace(/\s+/g, ' ')}</p>`).join('');
  return `<!DOCTYPE html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:#f1f5f9;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;border:1px solid #e2e8f0;overflow:hidden;">
            <tr>
              <td style="padding:16px 24px;background:#1e3a8a;">
                <span style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">Advogado</span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <h2 style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:18px;color:#0f172a;">${escapeHtml(subject)}</h2>
                <div style="font-family:Arial,sans-serif;color:#334155;">${lines}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;">
                <span style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;">A IA auxilia o advogado. A revisão e decisão final são humanas.</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class EmailChannel implements NotificationChannel {
  readonly name = 'EMAIL' as const;

  isConfigured(config: Record<string, unknown> | null): boolean {
    return resolveSmtp(config) !== null;
  }

  async send(msg: ChannelMessage, config: Record<string, unknown>): Promise<ChannelResult> {
    const smtp = resolveSmtp(config);
    if (!smtp) {
      return { channel: 'EMAIL', status: 'NOT_CONFIGURED', error: 'SMTP não configurado.' };
    }
    try {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: { user: smtp.user, pass: smtp.pass },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      });
      const subject = msg.subject ?? '';
      const info = await transporter.sendMail({
        from: smtp.from,
        to: msg.to,
        subject,
        text: msg.body,
        html: buildHtml(subject, msg.body),
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
