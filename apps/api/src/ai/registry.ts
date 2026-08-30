import type { AIProvider } from './provider';
import { OpenAICompatibleProvider } from './openai';
import { LocalAIProvider } from './local';
import { getEnv } from '../config';

let providerOverride: AIProvider | null = null;

export function getAIProvider(): AIProvider {
  if (providerOverride) return providerOverride;
  const env = getEnv();
  if (env.AI_PROVIDER === 'local') return new LocalAIProvider();
  return new OpenAICompatibleProvider();
}

export function setAIProviderForTests(provider: AIProvider | null): void {
  providerOverride = provider;
}

export function isAIProviderConfigured(): boolean {
  return getAIProvider().isConfigured();
}

export function getProviderInfo(): { configured: boolean; name: string } {
  const p = getAIProvider();
  return { configured: p.isConfigured(), name: p.name };
}