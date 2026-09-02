import type { ProcessDiscoveryProvider, ProfessionalIdentityInput, DiscoveryResult, DiscoveryProviderStep } from './types';

/**
 * ETAPA 6 — DiscoveryRouter.
 *
 * Recebe a identidade profissional do advogado, avalia os providers
 * disponíveis e determina quais podem ser utilizados. O resultado informa
 * explicitamente provider, status, motivo e processos encontrados.
 *
 * Este router NÃO inventa capacidade: cada provider declara honestamente
 * suas capacidades, e o router apenas as respeita.
 */

export interface DiscoveryRouterConfig {
  configLoader: (source: string) => Promise<Record<string, unknown> | null>;
}

/**
 * Seleciona providers elegíveis e executa a descoberta.
 * Para cada provider:
 *  - não implementado → SKIPPED (NOT_IMPLEMENTED)
 *  - sem suporte profissional → SKIPPED (NO_PROFESSIONAL_DISCOVERY)
 *  - não configurado → SKIPPED (NOT_CONFIGURED)
 *  - erro na consulta → FAILED
 *  - sucesso → OK com processos
 *
 * Nenhum resultado é inventado; erros são seguros (sem segredos/credenciais).
 */
export class DiscoveryRouter {
  constructor(private readonly config: DiscoveryRouterConfig) {}

  async route(identity: ProfessionalIdentityInput, providers: ProcessDiscoveryProvider[]): Promise<DiscoveryProviderStep[]> {
    const steps: DiscoveryProviderStep[] = [];

    for (const provider of providers) {
      const config = await this.config.configLoader(provider.source);
      const caps = provider.capabilities();

      if (!provider.implemented) {
        steps.push({ provider, status: 'SKIPPED', reason: 'NOT_IMPLEMENTED' });
        continue;
      }
      if (!caps.supportsProfessionalDiscovery) {
        steps.push({ provider, status: 'SKIPPED', reason: 'NO_PROFESSIONAL_DISCOVERY' });
        continue;
      }
      if (!provider.isConfigured(config)) {
        steps.push({ provider, status: 'SKIPPED', reason: 'NOT_CONFIGURED' });
        continue;
      }

      try {
        const result: DiscoveryResult = await provider.discoverByProfessional(identity, config);
        if (result.error) {
          steps.push({ provider, status: 'FAILED', reason: result.error.code, error: result.error });
          continue;
        }
        steps.push({ provider, status: 'OK', reason: undefined, processes: result.processes });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Falha ao consultar a fonte.';
        steps.push({ provider, status: 'FAILED', reason: 'ERROR', error: { code: 'ERROR', message: msg } });
      }
    }

    return steps;
  }

  /** Provider único por source. */
  async routeSingle(identity: ProfessionalIdentityInput, provider: ProcessDiscoveryProvider): Promise<DiscoveryProviderStep> {
    const steps = await this.route(identity, [provider]);
    return steps[0]!;
  }
}