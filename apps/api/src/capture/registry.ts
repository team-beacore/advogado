import type { CaptureAdapter } from './types';
import { dataJudAdapter, demoCaptureAdapter, pjeAdapter, esajAdapter, projudiAdapter } from './adapters';

let adapterOverride: CaptureAdapter[] | null = null;

/** Ordem: DEMO primeiro (sempre disponível), depois fontes reais declaradas. */
export function getCaptureAdapters(): CaptureAdapter[] {
  return adapterOverride ?? [demoCaptureAdapter, dataJudAdapter, pjeAdapter, esajAdapter, projudiAdapter];
}

export function getCaptureAdapter(source: string): CaptureAdapter | undefined {
  return getCaptureAdapters().find((a) => a.source === source);
}

export function setCaptureAdaptersForTests(adapters: CaptureAdapter[] | null): void {
  adapterOverride = adapters;
}
