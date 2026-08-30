import type { CaptureAdapter } from './types';
import { pjeAdapter, esajAdapter, projudiAdapter } from './adapters';

let adapterOverride: CaptureAdapter[] | null = null;

export function getCaptureAdapters(): CaptureAdapter[] {
  return adapterOverride ?? [pjeAdapter, esajAdapter, projudiAdapter];
}

export function setCaptureAdaptersForTests(adapters: CaptureAdapter[] | null): void {
  adapterOverride = adapters;
}
