import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPut, apiPost, apiPatch } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Card, Badge, EmptyState, ErrorAlert, Button, SecondaryButton, Input, formatDateTime } from '../components/ui';

interface SecurityReport {
  organization: { id: string; name: string; plan_type?: string | null; created_at: string } | null;
  currentUserId: string;
  users: Array<{ id: string; name: string; email: string; role: string; created_at: string }>;
  storage: { driver: string; totalBytes: number; documentCount: number };
  counts: { clients: number; cases: number; leads: number; aiInteractions: number; auditLogs: number };
  ai: { configured: boolean; provider: string | null; model: string | null; baseUrl: string | null; disclaimer: string };
  integrations: Record<string, unknown>;
}

interface UserNotificationPrefs {
  emailEnabled: boolean;
  newPublication: boolean;
  deadlineAlert: boolean;
  paymentAlert: boolean;
}

interface CaptureConfigRow {
  source: string;
  mode: string;
  implemented: boolean;
  enabled: boolean;
  configured: boolean;
  login: string | null;
  passwordSet: boolean;
  baseUrl: string | null;
}

interface CaptureStep {
  name: string;
  status: 'OK' | 'FAILED';
  message?: string;
}

interface CaptureRunResult {
  runId: string;
  source: string;
  status: 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED';
  found: number;
  imported: number;
  duplicate: number;
  errors: number;
  processesFound: number;
  movementsFound: number;
  publicationsFound: number;
  steps: CaptureStep[];
  errorMessage?: string | null;
  errorCode?: string | null;
}

interface CaptureTestResult {
  ok: boolean;
  message: string;
  details?: string[];
  source: string;
  mode: string;
}

interface CaptureRunRow {
  id: string;
  source: string | null;
  mode: string | null;
  status: string | null;
  found_count: number;
  imported_count: number;
  duplicate_count: number;
  error_count: number;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  user_name: string | null;
}

interface ChannelStatus {
  channel: string;
  configured: boolean;
  enabled: boolean;
}

export default function Settings() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [report, setReport] = useState<SecurityReport | null>(null);
  const [captureConfigs, setCaptureConfigs] = useState<CaptureConfigRow[]>([]);
  const [captureRuns, setCaptureRuns] = useState<CaptureRunRow[]>([]);
  const [channelStatus, setChannelStatus] = useState<ChannelStatus[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [prefs, setPrefs] = useState<UserNotificationPrefs | null>(null);
  const [profileError, setProfileError] = useState<unknown>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [captureError, setCaptureError] = useState<unknown>(null);
  const [runningSource, setRunningSource] = useState<string | null>(null);
  const [testingSource, setTestingSource] = useState<string | null>(null);
  const [runResults, setRunResults] = useState<Record<string, CaptureRunResult>>({});
  const [testResults, setTestResults] = useState<Record<string, CaptureTestResult>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const [r, cc, cs, p, runs] = await Promise.all([
        apiGet<SecurityReport>('/api/settings/security'),
        apiGet<CaptureConfigRow[]>('/api/capture/config').catch(() => []),
        apiGet<ChannelStatus[]>('/api/notifications/channels/status').catch(() => []),
        apiGet<UserNotificationPrefs>('/api/notifications/preferences').catch(() => null),
        apiGet<{ items: CaptureRunRow[] }>('/api/capture/runs').catch(() => ({ items: [] })),
      ]);
      setReport(r);
      setCaptureConfigs(cc);
      setChannelStatus(cs);
      setPrefs(p);
      setCaptureRuns(runs.items);
      setPhone(user?.phone ?? '');
    } catch (e) { setError(e); }
  }, [user?.phone]);

  useEffect(() => { void load(); }, [load]);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    setProfileSaving(true);
    try {
      const res = await apiPatch<{ user: { phone: string | null } }>('/api/auth/me', { phone });
      setPhone(res.user.phone ?? '');
    } catch (err) { setProfileError(err); }
    finally { setProfileSaving(false); }
  };

  const savePrefs = async (next: Partial<UserNotificationPrefs>) => {
    setProfileError(null);
    try {
      const saved = await apiPut<UserNotificationPrefs>('/api/notifications/preferences', next);
      setPrefs(saved);
    } catch (err) { setProfileError(err); }
  };

  // Senha
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwError, setPwError] = useState<unknown>(null);
  const [pwMsg, setPwMsg] = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null); setPwMsg('');
    if (pw.next !== pw.confirm) { setPwError(new Error('As senhas novas não conferem.')); return; }
    setPwSaving(true);
    try {
      await apiPost('/api/auth/change-password', { currentPassword: pw.current, newPassword: pw.next });
      setPw({ current: '', next: '', confirm: '' });
      setPwMsg('✅ Senha alterada com sucesso.');
    } catch (err) { setPwError(err); }
    finally { setPwSaving(false); }
  };

  // Canais — apenas ativar/desativar
  const toggleChannel = async (channel: string, enabled: boolean) => {
    setError(null);
    try {
      await apiPut('/api/notifications/channels', { channel, enabled });
      void load();
    } catch (err) { setError(err); }
  };

  // Captura — apenas ativar/desativar
  const toggleCapture = async (source: string, enabled: boolean) => {
    setError(null);
    try {
      await apiPut('/api/capture/config', { source, enabled });
      void load();
    } catch (err) { setError(err); }
  };

  // Captura — executar uma fonte
  const runCapture = async (source: string) => {
    setCaptureError(null);
    setRunningSource(source);
    try {
      const res = await apiPost<CaptureRunResult>('/api/capture/run', { source });
      setRunResults((prev) => ({ ...prev, [source]: res }));
      const runs = await apiGet<{ items: CaptureRunRow[] }>('/api/capture/runs').catch(() => ({ items: [] }));
      setCaptureRuns(runs.items);
    } catch (err) { setCaptureError(err); }
    finally { setRunningSource(null); }
  };

  // Captura — testar conexão de uma fonte
  const testCapture = async (source: string) => {
    setCaptureError(null);
    setTestingSource(source);
    try {
      const res = await apiPost<CaptureTestResult>('/api/capture/test', { source });
      setTestResults((prev) => ({ ...prev, [source]: res }));
    } catch (err) { setCaptureError(err); }
    finally { setTestingSource(null); }
  };

  const canManageCapture = !!user?.permissions?.includes('capture.manage');
  const canRunCapture = !!user?.permissions?.includes('publications.create');
  const showCapturePanel = canManageCapture || canRunCapture;

  const runStatusColor = (status: string): string => {
    const map: Record<string, string> = { SUCCESS: 'green', PARTIAL: 'yellow', FAILED: 'red', RUNNING: 'blue' };
    return map[status] ?? 'gray';
  };
  const runStatusLabel = (status: string | null): string => {
    const map: Record<string, string> = { SUCCESS: 'Sucesso', PARTIAL: 'Parcial', FAILED: 'Falhou', RUNNING: 'Executando' };
    return map[status ?? ''] ?? (status ?? '—');
  };

  if (!report) return <div className="flex items-center gap-2.5 text-sm text-gray-500"><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-200 border-t-brand-600" />Carregando…</div>;

  return (
    <div>
      <h1 className="page-title mb-6">Configurações</h1>
      <ErrorAlert error={error} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Perfil e preferências do usuário */}
        <Card title="Meu perfil e notificações">
          <form onSubmit={saveProfile} className="space-y-4">
            <ErrorAlert error={profileError} />
            <div>
              <label className="field-label">Telefone do advogado</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(21) 99999-9999" />
              <p className="mt-1 text-xs text-gray-500">Telefone de contato do usuário.</p>
            </div>
            <Button type="submit" disabled={profileSaving} className="w-full">{profileSaving ? 'Salvando…' : 'Salvar telefone'}</Button>
          </form>
          {prefs && (
            <div className="mt-5 space-y-3 border-t border-gray-100 pt-4">
              <div className="text-sm font-semibold text-gray-800">Preferências</div>
              <label className="flex items-center justify-between text-sm">
                <span>Receber e-mail</span>
                <input type="checkbox" checked={prefs.emailEnabled} onChange={(e) => void savePrefs({ emailEnabled: e.target.checked })} />
              </label>
              <label className="flex items-center justify-between text-sm">
                <span>Nova intimação</span>
                <input type="checkbox" checked={prefs.newPublication} onChange={(e) => void savePrefs({ newPublication: e.target.checked })} />
              </label>
              <label className="flex items-center justify-between text-sm">
                <span>Alertas de prazo</span>
                <input type="checkbox" checked={prefs.deadlineAlert} onChange={(e) => void savePrefs({ deadlineAlert: e.target.checked })} />
              </label>
              <label className="flex items-center justify-between text-sm">
                <span>Alertas de cobrança</span>
                <input type="checkbox" checked={prefs.paymentAlert} onChange={(e) => void savePrefs({ paymentAlert: e.target.checked })} />
              </label>
            </div>
          )}
        </Card>

        {/* Segurança */}
        <Card title="Segurança">
          <form onSubmit={changePassword} className="space-y-3">
            <ErrorAlert error={pwError} />
            {pwMsg && <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{pwMsg}</div>}
            <div>
              <label className="field-label">Senha atual</label>
              <Input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" required />
            </div>
            <div>
              <label className="field-label">Nova senha</label>
              <Input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" required minLength={8} />
            </div>
            <div>
              <label className="field-label">Confirmar nova senha</label>
              <Input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" required minLength={8} />
            </div>
            <Button type="submit" className="w-full" disabled={pwSaving}>{pwSaving ? 'Alterando…' : 'Alterar senha'}</Button>
          </form>
        </Card>

        {/* Security Report */}
        <Card title="Privacidade e Segurança">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Organização</span><span>{report.organization?.name ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Plano</span><span>{report.organization?.plan_type === 'OFFICE' ? 'Escritório' : 'Solo'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Membros</span><span>{report.users.length}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Armazenamento</span><span>{report.storage.driver}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Documentos</span><span>{report.storage.documentCount}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Clientes</span><span>{report.counts.clients}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Processos</span><span>{report.counts.cases}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Interações de IA</span><span>{report.counts.aiInteractions}</span></div>
          </dl>
        </Card>

        <Card title="IA">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Status</span>
              {report.ai.configured ? <Badge color="green">Configurado</Badge> : <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Não configurado</span>}
            </div>
            {report.ai.configured && (
              <>
                <div className="flex justify-between"><span className="text-gray-500">Provedor</span><span>{report.ai.provider}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Modelo</span><span>{report.ai.model}</span></div>
              </>
            )}
            <div className="mt-2 rounded-lg border border-info-100 bg-info-50 p-3.5 text-xs leading-relaxed text-info-700">{report.ai.disclaimer}</div>
          </dl>
        </Card>

        {/* Capture config — executar, testar, ativar/desativar */}
        {showCapturePanel && (
          <Card title="Captura de publicações" action={<Button className="px-3 py-1.5 text-xs" onClick={() => void load()}>Atualizar</Button>}>
            <ErrorAlert error={captureError} />
            <div className="space-y-4">
              {captureConfigs.map((c) => {
                const statusIcon = c.implemented ? (c.configured ? '🟢' : '🟡') : '⚪';
                const statusText = c.implemented ? (c.configured ? 'Configurado' : 'Não configurado') : 'Não implementado';
                const result = runResults[c.source];
                const test = testResults[c.source];
                const running = runningSource === c.source;
                const testing = testingSource === c.source;
                const modeBadge = c.mode === 'DEMO'
                  ? { icon: '🟣', label: 'DEMONSTRAÇÃO', sub: 'Dados fictícios', cls: 'border-purple-200 bg-purple-50 text-purple-700' }
                  : c.mode === 'PUBLIC'
                    ? { icon: '🟢', label: 'PÚBLICO', sub: 'Fonte pública', cls: 'border-green-200 bg-green-50 text-green-700' }
                    : { icon: '🔵', label: 'PRODUÇÃO', sub: 'Fonte autenticada', cls: 'border-blue-200 bg-blue-50 text-blue-700' };
                return (
                  <div key={c.source} className="rounded border border-gray-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-gray-900">{c.source}</div>
                      <div className="flex items-center gap-2">
                        <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${modeBadge.cls}`} title={modeBadge.sub}>
                          {modeBadge.icon} {modeBadge.label}
                        </span>
                        <Badge color={c.implemented ? (c.configured ? 'green' : 'yellow') : 'gray'}>{statusIcon} {statusText}</Badge>
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-gray-500">{modeBadge.sub}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      {c.implemented ? (c.configured ? (c.enabled ? 'Ativo' : 'Desativado') : 'Configuração feita pelo suporte técnico.') : 'Nenhuma implementação disponível para esta versão.'}
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      {canRunCapture && (
                        <Button
                          className="px-3 py-1.5 text-xs"
                          disabled={running || !c.implemented}
                          onClick={() => void runCapture(c.source)}
                        >
                          {running ? 'Executando…' : 'Executar captura'}
                        </Button>
                      )}
                      <SecondaryButton
                        className="px-3 py-1.5 text-xs"
                        disabled={testing}
                        onClick={() => void testCapture(c.source)}
                      >
                        {testing ? 'Testando…' : 'Testar conexão'}
                      </SecondaryButton>
                      {canManageCapture && c.implemented && c.configured && (
                        <label className="ml-auto flex items-center gap-2 text-xs text-gray-600">
                          Ativo
                          <input type="checkbox" checked={c.enabled} onChange={(e) => void toggleCapture(c.source, e.target.checked)} />
                        </label>
                      )}
                    </div>

                    {test && (
                      <div className={`mt-2.5 rounded-md border px-3 py-2 text-xs leading-relaxed ${test.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
                        <b>{test.ok ? '✓ Conexão ok' : '✗ Falha na conexão'}</b> — {test.message}
                        {test.details && test.details.length > 0 && (
                          <ul className="mt-1 list-inside list-disc space-y-0.5">
                            {test.details.map((d) => <li key={d}>{d}</li>)}
                          </ul>
                        )}
                      </div>
                    )}

                    {result && (
                      <div className="mt-2.5 rounded-md border border-gray-200 bg-gray-50 p-3">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <Badge color={runStatusColor(result.status)}>{runStatusLabel(result.status)}</Badge>
                          <span>Encontrados: <b>{result.found}</b></span>
                          <span>Importados: <b>{result.imported}</b></span>
                          <span>Duplicados: <b>{result.duplicate}</b></span>
                          <span>Erros: <b>{result.errors}</b></span>
                        </div>
                        <div className="mt-2 text-xs text-gray-600">
                          {result.processesFound} processos · {result.movementsFound} movimentações · {result.publicationsFound} publicações
                        </div>
                        {result.errorMessage && <div className="mt-1.5 text-xs text-red-600">{result.errorMessage}</div>}                        {result.steps.length > 0 && (
                          <ul className="mt-2 space-y-1">
                            {result.steps.map((s) => (
                              <li key={s.name} className="flex items-start gap-2 text-xs">
                                <span>{s.status === 'OK' ? '🟢' : '🔴'}</span>
                                <span>
                                  <b>{s.name}</b>
                                  {s.message && <span className="text-gray-500"> — {s.message}</span>}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {captureConfigs.length === 0 && <EmptyState title="Nenhuma fonte disponível." />}
            </div>

            {captureRuns.length > 0 && (
              <div className="mt-5 border-t border-gray-100 pt-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Histórico de execuções</div>
                <ul className="space-y-1.5">
                  {captureRuns.slice(0, 10).map((run) => (
                    <li key={run.id} className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                      <Badge color={runStatusColor(run.status ?? '')}>{runStatusLabel(run.status)}</Badge>
                      <span className="font-semibold text-gray-800">{run.source ?? '—'}</span>
                      <span>{run.mode ? `(${run.mode})` : ''}</span>
                      <span className="text-gray-400">{formatDateTime(run.started_at)}</span>
                      <span className="text-gray-500">· +{run.imported_count} · dup {run.duplicate_count} · err {run.error_count}</span>
                      {run.user_name && <span className="text-gray-400">· {run.user_name}</span>}
                      {run.error_message && <span className="text-red-600">· {run.error_message}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        )}

        {isAdmin && (
          <>
            {/* Notification channels — apenas ativar/desativar */}
            <Card title="Canais de notificação" action={<Button className="px-3 py-1.5 text-xs" onClick={() => void load()}>Atualizar</Button>}>
              <div className="space-y-4">
                {channelStatus.map((ch) => (
                  <div key={ch.channel} className="rounded border border-gray-200 p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-gray-900">{ch.channel === 'EMAIL' ? 'E-mail' : ch.channel}</div>
                      {ch.configured ? (
                        <div className="flex items-center gap-2">
                          <Badge color="green">Configurado</Badge>
                          {ch.enabled && <Badge color="green">Ativo</Badge>}
                          <input type="checkbox" checked={ch.enabled} onChange={(e) => void toggleChannel(ch.channel, e.target.checked)} />
                        </div>
                      ) : (
                        <Badge color="gray">Não configurado</Badge>
                      )}
                    </div>
                    {!ch.configured && <div className="mt-1 text-xs text-gray-500">Ainda não foi configurado pelo suporte técnico.</div>}
                  </div>
                ))}
                {channelStatus.length === 0 && <EmptyState title="Nenhum canal disponível." />}
              </div>
            </Card>
          </>
        )}
      </div>

      {!isAdmin && (
        <div className="mt-6 rounded-lg border border-warning-100 bg-warning-50 px-4 py-3 text-sm leading-relaxed text-warning-700">
          Apenas administradores da organização podem configurar preferências de notificação e ativar/desativar fontes de captura.
        </div>
      )}
    </div>
  );
}
