import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPut, apiDelete } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Card, Badge, EmptyState, ErrorAlert, Button, SecondaryButton, Input, Modal } from '../components/ui';

interface SecurityReport {
  organization: { id: string; name: string; created_at: string } | null;
  currentUserId: string;
  users: Array<{ id: string; name: string; email: string; role: string; created_at: string }>;
  storage: { driver: string; totalBytes: number; documentCount: number };
  counts: { clients: number; cases: number; leads: number; aiInteractions: number; auditLogs: number };
  ai: { configured: boolean; provider: string | null; model: string | null; baseUrl: string | null; disclaimer: string };
  integrations: Record<string, unknown>;
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

  const load = useCallback(async () => {
    setError(null);
    try {
      const [r, cc, cs] = await Promise.all([
        apiGet<SecurityReport>('/api/settings/security'),
        apiGet<CaptureConfigRow[]>('/api/capture/config').catch(() => []),
        apiGet<ChannelStatus[]>('/api/notifications/channels/status').catch(() => []),
      ]);
      setReport(r);
      setCaptureConfigs(cc);
      setChannelStatus(cs);
    } catch (e) { setError(e); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const [editingCapture, setEditingCapture] = useState<CaptureConfigRow | null>(null);
  const [captureForm, setCaptureForm] = useState({ enabled: true, login: '', password: '', baseUrl: '' });
  const [captureFormError, setCaptureFormError] = useState<unknown>(null);

  const openCaptureEdit = (row: CaptureConfigRow) => {
    setCaptureForm({ enabled: row.enabled, login: row.login ?? '', password: '', baseUrl: row.baseUrl ?? '' });
    setEditingCapture(row);
    setCaptureFormError(null);
  };

  const saveCapture = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCapture) return;
    setCaptureFormError(null);
    try {
      await apiPut('/api/capture/config', {
        adapter: editingCapture.adapter,
        enabled: captureForm.enabled,
        login: captureForm.login || editingCapture.login,
        password: captureForm.password || 'placeholder',
        baseUrl: captureForm.baseUrl || null,
      });
      setEditingCapture(null);
      void load();
    } catch (err) { setCaptureFormError(err); }
  };

  const deleteCapture = async (adapter: string) => {
    if (!confirm(`Remover configuração do adapter ${adapter}?`)) return;
    try {
      await apiDelete(`/api/capture/config/${adapter}`);
      void load();
    } catch (err) { setError(err); }
  };

  const [editingChannel, setEditingChannel] = useState<ChannelStatus | null>(null);
  const [channelForm, setChannelForm] = useState({ enabled: true, host: '', port: '587', user: '', pass: '', from: '', apiUrl: '', apiToken: '' });
  const [channelFormError, setChannelFormError] = useState<unknown>(null);

  const openChannelEdit = (row: ChannelStatus) => {
    setChannelForm({ enabled: row.enabled, host: '', port: '587', user: '', pass: '', from: '', apiUrl: '', apiToken: '' });
    setEditingChannel(row);
    setChannelFormError(null);
  };

  const saveChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingChannel) return;
    setChannelFormError(null);
    const config: Record<string, unknown> = {};
    if (editingChannel.channel === 'EMAIL') {
      if (channelForm.host) { config.host = channelForm.host; config.port = Number(channelForm.port) || 587; config.user = channelForm.user; config.pass = channelForm.pass; config.from = channelForm.from; }
    } else {
      if (channelForm.apiUrl) { config.apiUrl = channelForm.apiUrl; config.apiToken = channelForm.apiToken; }
    }
    if (Object.keys(config).length === 0) { setChannelFormError(new Error('Preencha ao menos um campo.')); return; }
    try {
      await apiPut('/api/notifications/channels', { channel: editingChannel.channel, enabled: channelForm.enabled, config });
      setEditingChannel(null);
      void load();
    } catch (err) { setChannelFormError(err); }
  };

  if (!report) return <div className="text-gray-500">Carregando…</div>;

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">Configurações</h1>
      <ErrorAlert error={error} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Security Report */}
        <Card title="Privacidade e Segurança">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Organização</span><span>{report.organization?.name ?? '—'}</span></div>
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
              {report.ai.configured ? <Badge color="green">Configurado</Badge> : <span className="text-xs text-gray-400">Não configurado</span>}
            </div>
            {report.ai.configured && (
              <>
                <div className="flex justify-between"><span className="text-gray-500">Provedor</span><span>{report.ai.provider}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Modelo</span><span>{report.ai.model}</span></div>
              </>
            )}
            <div className="mt-2 rounded border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700">{report.ai.disclaimer}</div>
          </dl>
        </Card>

        {isAdmin && (
          <>
            {/* Capture config */}
            <Card title="Captura de publicações" action={<Button className="px-3 py-1 text-xs" onClick={load}>Atualizar</Button>}>
              <div className="space-y-3">
                {captureConfigs.map((c) => (
                  <div key={c.adapter} className="rounded border border-gray-200 p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">{c.adapter}</div>
                      <Badge color={c.configured ? 'green' : 'gray'}>{c.configured ? 'Configurado' : 'Não configurado'}</Badge>
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {c.login && <span className="mr-3">Login: {c.login}</span>}
                      {c.passwordSet && <span className="mr-3">Senha: ****</span>}
                      {c.baseUrl && <span className="block truncate">URL: {c.baseUrl}</span>}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <SecondaryButton onClick={() => openCaptureEdit(c)} className="px-3 py-1 text-xs">Configurar</SecondaryButton>
                      <button onClick={() => deleteCapture(c.adapter)} className="text-xs text-red-600 hover:underline">Remover</button>
                    </div>
                  </div>
                ))}
                {captureConfigs.length === 0 && <EmptyState title="Nenhum adapter configurado." hint="Configure um adapter para capturar intimações automaticamente." />}
              </div>
            </Card>

            {/* Notification channels */}
            <Card title="Canais de notificação" action={<Button className="px-3 py-1 text-xs" onClick={load}>Atualizar</Button>}>
              <div className="space-y-3">
                {channelStatus.map((ch) => (
                  <div key={ch.channel} className="rounded border border-gray-200 p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">{ch.channel}</div>
                      <div className="flex items-center gap-2">
                        {ch.enabled && <Badge color="green">Ativo</Badge>}
                        <Badge color={ch.configured ? 'green' : 'gray'}>{ch.configured ? 'Configurado' : 'Não configurado'}</Badge>
                      </div>
                    </div>
                    <div className="mt-2">
                      <SecondaryButton onClick={() => openChannelEdit(ch)} className="px-3 py-1 text-xs">Configurar</SecondaryButton>
                    </div>
                  </div>
                ))}
                {channelStatus.length === 0 && <EmptyState title="Nenhum canal configurado." hint="Configure email ou WhatsApp para notificações." />}
              </div>
            </Card>
          </>
        )}
      </div>

      {!isAdmin && (
        <div className="mt-6 rounded-md border border-yellow-100 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          Apenas administradores da organização podem configurar integrações.
        </div>
      )}

      <Modal open={Boolean(editingCapture)} onClose={() => setEditingCapture(null)} title={`Configurar captura — ${editingCapture?.adapter ?? ''}`}>
        <form onSubmit={saveCapture} className="space-y-3">
          <ErrorAlert error={captureFormError} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={captureForm.enabled} onChange={(e) => setCaptureForm({ ...captureForm, enabled: e.target.checked })} />
            Habilitado
          </label>
          <div>
            <label className="mb-1 block text-sm font-medium">Login *</label>
            <Input value={captureForm.login} onChange={(e) => setCaptureForm({ ...captureForm, login: e.target.value })} required placeholder={editingCapture?.login ?? ''} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Senha *</label>
            <Input type="password" value={captureForm.password} onChange={(e) => setCaptureForm({ ...captureForm, password: e.target.value })} placeholder={editingCapture?.passwordSet ? '****' : 'Nova senha'} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Base URL (opcional)</label>
            <Input value={captureForm.baseUrl} onChange={(e) => setCaptureForm({ ...captureForm, baseUrl: e.target.value })} placeholder={editingCapture?.baseUrl ?? 'URL padrão'} />
          </div>
          <Button type="submit" className="w-full">Salvar</Button>
        </form>
      </Modal>

      <Modal open={Boolean(editingChannel)} onClose={() => setEditingChannel(null)} title={`Configurar canal — ${editingChannel?.channel ?? ''}`}>
        <form onSubmit={saveChannel} className="space-y-3">
          <ErrorAlert error={channelFormError} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={channelForm.enabled} onChange={(e) => setChannelForm({ ...channelForm, enabled: e.target.checked })} />
            Habilitado
          </label>
          {editingChannel?.channel === 'EMAIL' ? (
            <>
              <div><label className="mb-1 block text-sm font-medium">SMTP Host</label><Input value={channelForm.host} onChange={(e) => setChannelForm({ ...channelForm, host: e.target.value })} placeholder="smtp.exemplo.com" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1 block text-sm font-medium">Porta</label><Input value={channelForm.port} onChange={(e) => setChannelForm({ ...channelForm, port: e.target.value })} /></div>
                <div><label className="mb-1 block text-sm font-medium">Usuário</label><Input value={channelForm.user} onChange={(e) => setChannelForm({ ...channelForm, user: e.target.value })} /></div>
              </div>
              <div><label className="mb-1 block text-sm font-medium">Senha SMTP</label><Input type="password" value={channelForm.pass} onChange={(e) => setChannelForm({ ...channelForm, pass: e.target.value })} /></div>
              <div><label className="mb-1 block text-sm font-medium">Remetente</label><Input value={channelForm.from} onChange={(e) => setChannelForm({ ...channelForm, from: e.target.value })} placeholder="advogado@exemplo.com" /></div>
            </>
          ) : (
            <>
              <div><label className="mb-1 block text-sm font-medium">API URL</label><Input value={channelForm.apiUrl} onChange={(e) => setChannelForm({ ...channelForm, apiUrl: e.target.value })} placeholder="https://graph.facebook.com/v19.0/..." /></div>
              <div><label className="mb-1 block text-sm font-medium">Token</label><Input type="password" value={channelForm.apiToken} onChange={(e) => setChannelForm({ ...channelForm, apiToken: e.target.value })} /></div>
            </>
          )}
          <Button type="submit" className="w-full">Salvar</Button>
        </form>
      </Modal>
    </div>
  );
}