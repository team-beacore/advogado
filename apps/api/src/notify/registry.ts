import type { NotificationChannel } from './types';
import { EmailChannel } from './email';

let channelsOverride: NotificationChannel[] | null = null;

export function getNotificationChannels(): NotificationChannel[] {
  return channelsOverride ?? [new EmailChannel()];
}

export function setNotificationChannelsForTests(channels: NotificationChannel[] | null): void {
  channelsOverride = channels;
}