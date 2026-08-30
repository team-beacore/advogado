import { errors } from '../errors';
import type { CapturedPublication, CaptureAdapter } from './types';

function readString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function normalizeItems(raw: unknown): CapturedPublication[] {
  if (!raw || typeof raw !== 'object') return [];
  const root = raw as Record<string, unknown>;
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray(root.items)
      ? root.items
      : Array.isArray(root.publicacoes)
        ? root.publicacoes
        : Array.isArray(root.intimacoes)
          ? root.intimacoes
          : Array.isArray(root.result)
            ? root.result
            : [];

  const result: CapturedPublication[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const processNumber = readString(item.processNumber ?? item.numeroProcesso ?? item.numero_processo ?? item.npu);
    const content = readString(item.content ?? item.conteudo ?? item.text ?? item.publicacao);
    if (!processNumber || !content) continue;
    result.push({
      processNumber,
      source: '',
      content,
      publicationDate: readString(item.publicationDate ?? item.dataPublicacao ?? item.publicadoEm),
      availabilityDate: readString(item.availabilityDate ?? item.dataDisponibilizacao ?? item.disponibilizadoEm),
      externalReference: readString(item.externalReference ?? item.referencia ?? item.id),
      possibleDueDate: readString(item.possibleDueDate ?? item.prazo ?? item.dataPrazo),
      notes: readString(item.notes ?? item.observacoes),
    });
  }
  return result;
}

class PjeAdapter implements CaptureAdapter {
  readonly name = 'PJE' as const;

  isConfigured(config: Record<string, unknown> | null): boolean {
    return Boolean(config && typeof config.login === 'string' && config.login.length > 0 && typeof config.password === 'string' && config.password.length > 0);
  }

  async fetch(config: Record<string, unknown>): Promise<CapturedPublication[]> {
    if (!this.isConfigured(config)) {
      throw errors.validation('Adapter PJE não configurado.');
    }
    const baseUrl = typeof config.baseUrl === 'string' && config.baseUrl.length > 0
      ? config.baseUrl
      : 'https://pje-consulta-publica.tjsp.jus.br/pje/ConsultaPublica/listView.seam';
    const url = new URL(baseUrl);
    if (typeof config.login === 'string') url.searchParams.set('login', config.login);
    if (typeof config.password === 'string') url.searchParams.set('password', config.password);
    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return [];
      const text = await res.text();
      if (!text || text.trim().length === 0) return [];
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        return [];
      }
      return normalizeItems(payload).map((p) => ({ ...p, source: 'PJE' }));
    } catch {
      throw errors.externalUnavailable('Não foi possível acessar o serviço PJe.');
    }
  }
}

class EsajAdapter implements CaptureAdapter {
  readonly name = 'ESAJ' as const;

  isConfigured(config: Record<string, unknown> | null): boolean {
    return Boolean(config && typeof config.login === 'string' && config.login.length > 0 && typeof config.password === 'string' && config.password.length > 0);
  }

  async fetch(config: Record<string, unknown>): Promise<CapturedPublication[]> {
    if (!this.isConfigured(config)) {
      throw errors.validation('Adapter e-SAJ não configurado.');
    }
    const baseUrl = typeof config.baseUrl === 'string' && config.baseUrl.length > 0
      ? config.baseUrl
      : 'https://esaj.tjsp.jus.br/cpopg/search.do';
    const url = new URL(baseUrl);
    if (typeof config.login === 'string') url.searchParams.set('login', config.login);
    if (typeof config.password === 'string') url.searchParams.set('password', config.password);
    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return [];
      const text = await res.text();
      if (!text || text.trim().length === 0) return [];
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        return [];
      }
      return normalizeItems(payload).map((p) => ({ ...p, source: 'ESAJ' }));
    } catch {
      throw errors.externalUnavailable('Não foi possível acessar o serviço e-SAJ.');
    }
  }
}

class ProjudiAdapter implements CaptureAdapter {
  readonly name = 'PROJUDI' as const;

  isConfigured(config: Record<string, unknown> | null): boolean {
    return Boolean(config && typeof config.login === 'string' && config.login.length > 0 && typeof config.password === 'string' && config.password.length > 0);
  }

  async fetch(config: Record<string, unknown>): Promise<CapturedPublication[]> {
    if (!this.isConfigured(config)) {
      throw errors.validation('Adapter Projudi não configurado.');
    }
    const baseUrl = typeof config.baseUrl === 'string' && config.baseUrl.length > 0
      ? config.baseUrl
      : 'https://projudi.tjpr.jus.br/projudi/';
    const url = new URL(baseUrl);
    if (typeof config.login === 'string') url.searchParams.set('login', config.login);
    if (typeof config.password === 'string') url.searchParams.set('password', config.password);
    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return [];
      const text = await res.text();
      if (!text || text.trim().length === 0) return [];
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        return [];
      }
      return normalizeItems(payload).map((p) => ({ ...p, source: 'PROJUDI' }));
    } catch {
      throw errors.externalUnavailable('Não foi possível acessar o serviço Projudi.');
    }
  }
}

export const pjeAdapter = new PjeAdapter();
export const esajAdapter = new EsajAdapter();
export const projudiAdapter = new ProjudiAdapter();
