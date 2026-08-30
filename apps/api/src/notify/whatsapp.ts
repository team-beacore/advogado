import type { ChannelMessage, ChannelResult, NotificationChannel } from './types';

export class WhatsAppChannel implements NotificationChannel {
  readonly name = 'WHATSAPP' as const;

  isConfigured(config: Record<string, unknown> | null): boolean {
    if (!config) return false;
    return Boolean(config.apiUrl && config.apiToken);
  }

  async send(msg: ChannelMessage, config: Record<string, unknown>): Promise<ChannelResult> {
    if (!this.isConfigured(config)) {
      return { channel: 'WHATSAPP', status: 'NOT_CONFIGURED', error: 'WhatsApp não configurado.' };
    }
    try {
      const res = await fetch(String(config.apiUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${String(config.apiToken)}`,
        },
        body: JSON.stringify({
          to: msg.to,
          text: `${msg.subject ? `${msg.subject}\n` : ''}${msg.body}`,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { channel: 'WHATSAPP', status: 'FAILED', error: `WhatsApp retornou erro (${res.status}): ${body.slice(0, 300)}` };
      }
      const json = (await res.json().catch(() => null)) as { id?: string } | null;
      return { channel: 'WHATSAPP', status: 'SENT', externalReference: json?.id ?? null };
    } catch (err) {
      return { channel: 'WHATSAPP', status: 'FAILED', error: (err as Error).message };
    }
  }
}