import type { NotificationChannel } from './types';
import { EmailChannel } from './email';
import { WhatsAppChannel } from './whatsapp';

let channelsOverride: NotificationChannel[] | null = null;

export function getNotificationChannels(): NotificationChannel[] {
  return channelsOverride ?? [new EmailChannel(), new WhatsAppChannel()];
}

export function setNotificationChannelsForTests(channels: NotificationChannel[] | null): void {
  channelsOverride = channels;
}