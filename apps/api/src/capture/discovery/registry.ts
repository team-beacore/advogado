import type { CaptureSource } from '@advogado/shared';
import type { ProcessDiscoveryProvider } from './types';
import {
  demoDiscoveryProvider,
  djenDiscoveryProvider,
  dataJudDiscoveryProvider,
  pjeDiscoveryProvider,
  esajDiscoveryProvider,
  projudiDiscoveryProvider,
} from './providers';

let providerOverride: ProcessDiscoveryProvider[] | null = null;

export function getDiscoveryProviders(): ProcessDiscoveryProvider[] {
  return providerOverride ?? [
    demoDiscoveryProvider,
    djenDiscoveryProvider,
    dataJudDiscoveryProvider,
    pjeDiscoveryProvider,
    esajDiscoveryProvider,
    projudiDiscoveryProvider,
  ];
}

export function getDiscoveryProvider(source: CaptureSource | string): ProcessDiscoveryProvider | undefined {
  return getDiscoveryProviders().find((p) => p.source === source);
}

export function setDiscoveryProvidersForTests(providers: ProcessDiscoveryProvider[] | null): void {
  providerOverride = providers;
}