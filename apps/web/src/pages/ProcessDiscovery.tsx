import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPut, apiPost } from '../api/client';
import { Badge, EmptyState, ErrorAlert, Button, SecondaryButton, Input, statusColor, statusLabel, formatDateTime } from '../components/ui';
import { useAuth } from '../auth/AuthContext';

interface DiscoveryItem {
  id: string;
  process_number: string;
  source: string;
  court: string | null;
  class: string | null;
  status: string;
  confidence: number | null;
  discovered_at: string;
  identity_professional_name: string | null;
  identity_oab_number: string | null;
  identity_oab_state: string | null;
  existing_case_id: string | null;
  existing_case_title: string | null;
}

interface Identity {
  id: string;
  professional_name: string | null;
  oab_number: string | null;
  oab_state: string | null;
}

interface ProviderStatus {
  source: string;
  mode: string;
  implemented: boolean;
  configured: boolean;
  enabled: boolean;
  label: string;
  capabilities: {
    supportsProfessionalDiscovery: boolean;
    supportsProcessLookup: boolean;
    supportsMovements: boolean;
    supportsPublications: boolean;
    supportsDocuments: boolean;
    requiresAuthentication: boolean;
    supportedCourts: string[];
    supportedSystems: string[];
  };
}

interface RunResult {
  runId: string;
  status: string;
  processesFound: number;
  resultsCreated: number;
  resultsDuplicate: number;
  sourcesSkipped: number;
  steps: Array<{ name: string; status: 'OK' | 'SKIPPED' | 'FAILED'; message?: string }>;
  errorMessage?: string | null;
}

function confidenceColor(confidence: number | null): string {
  if (confidence == null) return 'gray';
  if (confidence >= 1) return 'green';
  if (confidence >= 0.5) return 'blue';
  if (confidence >= 0.2) return 'yellow';
  return 'gray';
}

function confidenceLabel(confidence: number | null): string {
  if (confidence == null) return '⚪ Não determinada';
  if (confidence >= 1) return '🟢 Alta confiança';
  if (confidence >= 0.5) return '🟡 Média confiança';
  if (confidence >= 0.2) return '🟠 Baixa confiança';
  return '⚪ Não determinada';
}

function providerIcon(p: ProviderStatus): string {
  if (!p.implemented) return '⚪';
  if (!p.capabilities.supportsProfessionalDiscovery) return '🔵';
  if (!p.configured) return '🟡';
  return '🟢';
}

function providerSub(p: ProviderStatus): string {
  if (!p.implemented) return 'Não implementado';
  if (p.capabilities.supportsProfessionalDiscovery) return p.configured ? 'Descoberta por identidade profissional' : 'Disponível (ativar na configuração)';
  if (p.capabilities.supportsProcessLookup) return 'Consulta/enriquecimento por número CNJ';
  return 'Sem descoberta por identidade profissional';
}

export default function ProcessDiscovery() {
  const { user } = useAuth();
  const [items, setItems] = useState<DiscoveryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  // Identidade profissional + fontes disponíveis
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [identityLoading, setIdentityLoading] = useState(true);
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [identityForm, setIdentityForm] = useState({ professionalName: '', oabNumber: '', oabState: '' });
  const [identityError, setIdentityError] = useState<unknown>(null);
  const [editingIdentity, setEditingIdentity] = useState(false);

  // Execução de descoberta
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);

  const canRun = user?.permissions?.includes('process_discovery.run') ?? false;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      params.set('pageSize', '100');
      const res = await apiGet<{ items: DiscoveryItem[]; total: number }>(`/api/process-discovery/results?${params}`);
      setItems(res.items);
      setTotal(res.total);
    } catch (e) { setError(e); }
    finally { setLoading(false); }
  };

  const loadContext = async () => {
    setIdentityLoading(true);
    try {
      const me = await apiGet<{ identity: Identity | null }>('/api/professional-identity/me');
      setIdentity(me.identity);
      if (me.identity) {
        setIdentityForm({
          professionalName: me.identity.professional_name ?? '',
          oabNumber: me.identity.oab_number ?? '',
          oabState: me.identity.oab_state ?? '',
        });
      }
    } catch { /* identidade não configurada ainda */ }
    try {
      const st = await apiGet<{ providers: ProviderStatus[] }>('/api/process-discovery/status');
      setProviders(st.providers);
    } catch { /* status indisponível */ }
    finally { setIdentityLoading(false); }
  };

  useEffect(() => { void load(); }, [statusFilter]);
  useEffect(() => { void loadContext(); }, []);

  const saveIdentity = async (e: React.FormEvent) => {
    e.preventDefault();
    setIdentityError(null);
    setSavingIdentity(true);
    try {
      await apiPut('/api/professional-identity/me', {
        professionalName: identityForm.professionalName.trim(),
        oabNumber: identityForm.oabNumber.trim(),
        oabState: identityForm.oabState.trim().toUpperCase(),
      });
      setEditingIdentity(false);
      await loadContext();
    } catch (err) { setIdentityError(err); }
    finally { setSavingIdentity(false); }
  };

  const runDiscovery = async () => {
    setRunResult(null);
    setError(null);
    setRunning(true);
    try {
      // Executa a descoberta pela fonte REAL de identidade profissional (DJEN).
      // DEMO permanece disponível apenas na tela de captura (dados fictícios).
      const res = await apiPost<RunResult>('/api/process-discovery/run', { source: 'DJEN' });
      setRunResult(res);
      await load();
    } catch (e) { setError(e); }
    finally { setRunning(false); }
  };

  const enableDjen = async () => {
    setError(null);
    try {
      await apiPut('/api/capture/config', { source: 'DJEN', enabled: true });
      await loadContext();
    } catch (e) { setError(e); }
  };

  const canManageCapture = user?.permissions?.includes('capture.manage') ?? false;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Descoberta de processos</h1>
        <p className="page-subtitle">Informe sua identidade profissional e descubra processos relacionados nas fontes judiciais consultadas.</p>
      </div>

      <ErrorAlert error={error} />

      {/* Identidade profissional + iniciar descoberta */}
      <section className="rounded-xl border border-gray-200/90 bg-white p-6 shadow-card">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold text-gray-900">Descobrir meus processos</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              A descoberta retorna <b>possíveis processos relacionados</b> à identidade profissional nas fontes consultadas — não é garantia de carteira completa.
            </p>
          </div>
        </div>

        {identityLoading ? (
          <div className="py-6 text-center text-sm text-gray-400">Carregando identidade profissional…</div>
        ) : !identity ? (
          <div>
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Configure sua identidade profissional para descobrir seus processos.
            </div>
            <form onSubmit={saveIdentity} className="max-w-md space-y-3">
              <ErrorAlert error={identityError} />
              <div>
                <label className="field-label">Nome do advogado(a)</label>
                <Input
                  value={identityForm.professionalName}
                  onChange={(e) => setIdentityForm({ ...identityForm, professionalName: e.target.value })}
                  placeholder="Ex.: Maria da Silva"
                  required
                  minLength={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Nº OAB</label>
                  <Input
                    value={identityForm.oabNumber}
                    onChange={(e) => setIdentityForm({ ...identityForm, oabNumber: e.target.value })}
                    placeholder="123456"
                    required
                  />
                </div>
                <div>
                  <label className="field-label">UF</label>
                  <Input
                    value={identityForm.oabState}
                    onChange={(e) => setIdentityForm({ ...identityForm, oabState: e.target.value.toUpperCase() })}
                    placeholder="RJ"
                    maxLength={2}
                    required
                  />
                </div>
              </div>
              <Button type="submit" disabled={savingIdentity}>
                {savingIdentity ? 'Salvando…' : '[ Configurar identidade ]'}
              </Button>
            </form>
          </div>
        ) : (
          <div>
            <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
              <span className="font-semibold text-gray-900">{identity.professional_name}</span>
              <span className="text-gray-500">OAB/{identity.oab_state ?? '—'} {identity.oab_number ?? '—'}</span>
              {canRun && (
                <button onClick={() => setEditingIdentity((v) => !v)} className="text-xs font-medium text-brand-700 hover:text-brand-800">
                  {editingIdentity ? 'Cancelar edição' : 'Editar identidade'}
                </button>
              )}
            </div>

            {editingIdentity && (
              <form onSubmit={saveIdentity} className="mb-4 max-w-md space-y-3">
                <ErrorAlert error={identityError} />
                <div>
                  <label className="field-label">Nome do advogado(a)</label>
                  <Input value={identityForm.professionalName} onChange={(e) => setIdentityForm({ ...identityForm, professionalName: e.target.value })} required minLength={2} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="field-label">Nº OAB</label>
                    <Input value={identityForm.oabNumber} onChange={(e) => setIdentityForm({ ...identityForm, oabNumber: e.target.value })} required />
                  </div>
                  <div>
                    <label className="field-label">UF</label>
                    <Input value={identityForm.oabState} onChange={(e) => setIdentityForm({ ...identityForm, oabState: e.target.value.toUpperCase() })} maxLength={2} required />
                  </div>
                </div>
                <Button type="submit" disabled={savingIdentity}>{savingIdentity ? 'Salvando…' : 'Salvar identidade'}</Button>
              </form>
            )}

            <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {providers.length === 0 ? (
                <div className="text-xs text-gray-500">Nenhuma fonte disponível no momento.</div>
              ) : providers.map((p) => (
                <div key={p.source} className="rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-800">{p.label}</span>
                    <span className="text-sm">{providerIcon(p)}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500">{providerSub(p)}</div>
                  {p.source === 'DJEN' && p.implemented && !p.configured && canManageCapture && (
                    <button onClick={() => void enableDjen()} className="mt-1.5 text-xs font-medium text-brand-700 hover:text-brand-800">
                      Ativar DJEN (fonte pública, sem credenciais)
                    </button>
                  )}
                  {p.source === 'DJEN' && p.implemented && !p.configured && !canManageCapture && (
                    <div className="mt-1.5 text-xs text-gray-400">Peça ao administrador para ativar a fonte.</div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void runDiscovery()} disabled={running || !canRun}>
                {running ? 'Descobrindo processos…' : '🔎 Iniciar descoberta'}
              </Button>
              {!canRun && <span className="text-xs text-gray-500">Você não possui permissão para executar descobertas.</span>}
            </div>

            {running && (
              <div className="mt-4 space-y-1.5 rounded-lg border border-info-100 bg-info-50 px-4 py-3 text-sm text-info-700">
                <div>✓ Identidade profissional validada</div>
                <div>⏳ Consultando fontes e processando resultados…</div>
              </div>
            )}

            {runResult && !running && (
              <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50/70 p-4">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <Badge color={runResult.status === 'SUCCESS' ? 'green' : runResult.status === 'PARTIAL' ? 'yellow' : 'red'}>
                    {runResult.status === 'SUCCESS' ? 'Concluída' : runResult.status === 'PARTIAL' ? 'Concluída com avisos' : 'Falhou'}
                  </Badge>
                  <span className="font-semibold text-gray-900">{runResult.processesFound} processo(s) encontrado(s)</span>
                  <span className="text-gray-500">· {runResult.resultsCreated} novo(s) · {runResult.resultsDuplicate} duplicado(s)</span>
                </div>
                {runResult.errorMessage && <div className="mt-2 text-xs text-red-600">{runResult.errorMessage}</div>}
                {runResult.steps.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {runResult.steps.map((s) => (
                      <li key={s.name} className="flex items-start gap-2 text-xs">
                        <span>{s.status === 'OK' ? '✓' : s.status === 'SKIPPED' ? '−' : '✗'}</span>
                        <span>
                          <b>{s.name}</b>
                          {s.message && <span className="text-gray-500"> — {s.message}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {runResult.resultsCreated > 0 && (
                  <p className="mt-3 text-xs text-gray-500">
                    Os processos encontrados foram registrados para revisão abaixo.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Resultados */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-base font-semibold text-gray-900">Processos descobertos</h2>
          <div className="flex flex-wrap gap-2">
            {['', 'PENDING_REVIEW', 'IMPORTED', 'REJECTED', 'DUPLICATE'].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  statusFilter === s
                    ? 'bg-brand-700 text-white shadow-sm'
                    : 'border border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                {s
                  ? { PENDING_REVIEW: 'Pendentes', IMPORTED: 'Importados', REJECTED: 'Rejeitados', DUPLICATE: 'Duplicados' }[s] ?? s
                  : 'Todos'}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-gray-400">Carregando…</div>
        ) : items.length === 0 ? (
          <EmptyState title="Nenhum processo descoberto" hint="Execute uma descoberta para encontrar possíveis processos relacionados." />
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-gray-200/90 bg-white p-5 shadow-card transition-shadow hover:shadow-elevated"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-gray-900">{item.process_number}</span>
                      <Badge color={item.existing_case_id ? 'purple' : statusColor(item.status)}>
                        {item.existing_case_id ? 'Já cadastrado' : statusLabel(item.status)}
                      </Badge>
                      <Badge color={confidenceColor(item.confidence)}>{confidenceLabel(item.confidence)}</Badge>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                      <span>{item.court ?? '—'}</span>
                      {item.class && <span>• {item.class}</span>}
                      <span>• Fonte: {item.source}</span>
                      <span>• {formatDateTime(item.discovered_at)}</span>
                    </div>
                    {(item.identity_professional_name || item.identity_oab_number) && (
                      <div className="mt-1.5 text-xs text-gray-500">
                        Advogado: {item.identity_professional_name ?? '—'} — OAB/{item.identity_oab_state ?? '—'} {item.identity_oab_number ?? '—'}
                      </div>
                    )}
                    {item.existing_case_title && (
                      <div className="mt-1.5 text-xs text-gray-500">
                        Caso existente: {item.existing_case_title}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Link
                      to={`/descoberta/${item.id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-700 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-brand-800"
                    >
                      Revisar
                    </Link>
                  </div>
                </div>
              </div>
            ))}
            <div className="pt-2 text-center text-xs text-gray-400">
              {total} resultado{total !== 1 ? 's' : ''}
            </div>
          </div>
        )}
      </section>

      <div className="flex items-center justify-between">
        <SecondaryButton onClick={() => void load()}>Atualizar</SecondaryButton>
      </div>
    </div>
  );
}
