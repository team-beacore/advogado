export interface ChannelMessage {
  to: string;
  subject?: string;
  body: string;
}

export interface ChannelResult {
  channel: 'EMAIL';
  status: 'SENT' | 'FAILED' | 'NOT_CONFIGURED';
  error?: string;
  externalReference?: string | null;
}

export interface NotificationChannel {
  readonly name: 'EMAIL';
  isConfigured(config: Record<string, unknown> | null): boolean;
  send(msg: ChannelMessage, config: Record<string, unknown>): Promise<ChannelResult>;
}