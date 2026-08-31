import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPut, apiPost, apiPatch } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Card, Badge, EmptyState, ErrorAlert, Button, Input } from '../components/ui';

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
  adapter: string;
  enabled: boolean;
  configured: boolean;
  login: string | null;
  passwordSet: boolean;
  baseUrl: string | null;
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
  const [channelStatus, setChannelStatus] = useState<ChannelStatus[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [prefs, setPrefs] = useState<UserNotificationPrefs | null>(null);
  const [profileError, setProfileError] = useState<unknown>(null);
  const [profileSaving, setProfileSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [r, cc, cs, p] = await Promise.all([
        apiGet<SecurityReport>('/api/settings/security'),
        apiGet<CaptureConfigRow[]>('/api/capture/config').catch(() => []),
        apiGet<ChannelStatus[]>('/api/notifications/channels/status').catch(() => []),
        apiGet<UserNotificationPrefs>('/api/notifications/preferences').catch(() => null),
      ]);
      setReport(r);
      setCaptureConfigs(cc);
      setChannelStatus(cs);
      setPrefs(p);
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
  const toggleCapture = async (adapter: string, enabled: boolean) => {
    setError(null);
    try {
      await apiPut('/api/capture/config', { adapter, enabled });
      void load();
    } catch (err) { setError(err); }
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

        {isAdmin && (
          <>
            {/* Capture config — apenas ativar/desativar */}
            <Card title="Captura de publicações" action={<Button className="px-3 py-1.5 text-xs" onClick={load}>Atualizar</Button>}>
              <div className="space-y-4">
                {captureConfigs.map((c) => (
                  <div key={c.adapter} className="rounded border border-gray-200 p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-gray-900">{c.adapter}</div>
                      <div className="flex items-center gap-2">
                        {c.configured ? (
                          <Badge color="green">Configurado</Badge>
                        ) : (
                          <Badge color="gray">Não configurado</Badge>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-gray-500">
                        {c.configured ? (c.enabled ? 'Ativo' : 'Desativado') : 'Configuração feita pelo suporte técnico.'}
                      </span>
                      {c.configured && (
                        <input type="checkbox" checked={c.enabled} onChange={(e) => void toggleCapture(c.adapter, e.target.checked)} />
                      )}
                    </div>
                  </div>
                ))}
                {captureConfigs.length === 0 && <EmptyState title="Nenhum adapter disponível." />}
              </div>
            </Card>

            {/* Notification channels — apenas ativar/desativar */}
            <Card title="Canais de notificação" action={<Button className="px-3 py-1.5 text-xs" onClick={load}>Atualizar</Button>}>
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
          Apenas administradores da organização podem configurar preferências de notificação e captura.
        </div>
      )}
    </div>
  );
}
