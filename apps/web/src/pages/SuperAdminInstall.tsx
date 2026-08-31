import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Card, Badge, ErrorAlert, Button, SecondaryButton, Input, Select } from '../components/ui';

interface StepState { status: 'NOT_STARTED' | 'PENDING' | 'OK' | 'FAILED'; message?: string; testedAt?: string }
interface Installation {
  id: string;
  currentStep: number;
  steps: Record<string, StepState>;
  clientType: 'solo' | 'escritorio';
  data: Record<string, unknown>;
  ready: boolean;
}

const STEP_DEFS = [
  { key: 'organization', label: 'Organização' },
  { key: 'administrator', label: 'Administrador' },
  { key: 'infrastructure', label: 'Infraestrutura' },
  { key: 'email', label: 'E-mail' },
  { key: 'ai', label: 'Inteligência Artificial' },
  { key: 'storage', label: 'Armazenamento' },
  { key: 'capture', label: 'Captura' },
  { key: 'notifications', label: 'Notificações' },
  { key: 'security', label: 'Segurança' },
  { key: 'functional', label: 'Teste funcional' },
  { key: 'summary', label: 'Resumo' },
];

const STEP_KEYS = STEP_DEFS.map((s) => s.key);

const statusIcon = (s: StepState | undefined): string => {
  if (!s || s.status === 'NOT_STARTED') return '⚪';
  if (s.status === 'OK') return '🟢';
  if (s.status === 'FAILED') return '🔴';
  return '🟡';
};

function StepBadge({ s }: { s: StepState | undefined }) {
  return <span>{statusIcon(s)}</span>;
}

export default function SuperAdminInstall() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [inst, setInst] = useState<Installation | null>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  // formulários
  const [org, setOrg] = useState({ orgName: '', orgTradeName: '', orgCnpj: '', orgOab: '', orgUf: '', orgAddress: '', orgPhone: '', orgEmail: '' });
  const [admin, setAdmin] = useState({ name: '', email: '', password: '', phone: '', oab: '' });
  const [smtp, setSmtp] = useState({ host: '', port: '587', user: '', pass: '', from: '', secure: 'false' });
  const [ai, setAi] = useState({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' });
  const [notif, setNotif] = useState({ emailEnabled: true, newPublication: true, deadlineAlert: true, paymentAlert: false });
  const [includePassword, setIncludePassword] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiGet<{ installation: Installation | null }>('/api/superadmin/installation');
      setInst(res.installation);
      if (res.installation) setStep(Math.min(res.installation.currentStep, STEP_KEYS.length - 1));
    } catch (e) { setError(e); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const startWizard = async (clientType: 'solo' | 'escritorio') => {
    setError(null);
    try {
      const res = await apiPost<{ installation: Installation }>('/api/superadmin/installation', { clientType });
      setInst(res.installation);
      setStep(0);
    } catch (e) { setError(e); }
  };

  const runStep = async (path: string, body?: unknown) => {
    setError(null); setMsg(''); setBusy(true);
    try {
      const res = await apiPost<{ installation: Installation }>(`/api/superadmin/installation/step/${path}`, body);
      setInst(res.installation);
      const stepStatus = res.installation?.steps?.[path]?.status;
      if (stepStatus === 'OK') setMsg(`✅ ${path} validado e concluído.`);
      else if (stepStatus === 'FAILED') setMsg(`❌ Falha: ${res.installation?.steps?.[path]?.message ?? 'erro desconhecido'}`);
      else setMsg(`ℹ️ ${path} salvo (status: ${stepStatus ?? 'pendente'}).`);
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  };

  const finalize = async () => {
    setError(null); setMsg(''); setBusy(true);
    try {
      const res = await apiPost<{ installation: Installation }>('/api/superadmin/installation/finalize');
      setInst(res.installation);
      setMsg('✅ Implantação pronta para entrega.');
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  };

  const downloadReport = async () => {
    setReportLoading(true); setError(null);
    try {
      const url = `/api/superadmin/installation/report?includePassword=${includePassword ? 'true' : 'false'}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'relatorio-implantacao.pdf';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { setError(e); }
    finally { setReportLoading(false); }
  };

  const doLogout = async () => { await logout(); navigate('/login'); };

  if (!user?.isSuperAdmin) return null;

  if (!inst) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="border-b border-gray-200 bg-white">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
            <div><div className="eyebrow">Camada técnica</div><h1 className="font-display text-lg font-semibold text-gray-900">Implantação da Instalação</h1></div>
            <button onClick={() => void doLogout()} className="text-sm text-gray-500 hover:text-gray-900">Sair</button>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-10">
          <ErrorAlert error={error} />
          <Card title="Nova implantação">
            <p className="mb-5 text-sm text-gray-600">Escolha o tipo de cliente para iniciar o assistente de implantação.</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Button onClick={() => void startWizard('solo')} className="h-24 flex-col gap-2">Advogado solo<br /><span className="text-xs font-normal opacity-80">1 usuário ADMIN + LAWYER</span></Button>
              <SecondaryButton onClick={() => void startWizard('escritorio')} className="h-24 flex-col gap-2 border-brand-300 text-brand-700 hover:bg-brand-50">Escritório<br /><span className="text-xs font-normal">ADMIN + equipe</span></SecondaryButton>
            </div>
          </Card>
        </main>
      </div>
    );
  }

  const current = STEP_KEYS[step];
  const currentDef = STEP_DEFS[step];
  const currentStatus = inst.steps[current]?.status ?? 'NOT_STARTED';
  const progress = Math.round((STEP_KEYS.filter((k) => inst.steps[k]?.status === 'OK').length / STEP_KEYS.length) * 100);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div>
            <div className="eyebrow">Camada técnica</div>
            <h1 className="font-display text-lg font-semibold text-gray-900">Implantação da Instalação</h1>
          </div>
          <div className="flex items-center gap-3">
            <Badge color={inst.clientType === 'escritorio' ? 'blue' : 'green'}>{inst.clientType === 'escritorio' ? 'Escritório' : 'Advogado Solo'}</Badge>
            <button onClick={() => void doLogout()} className="text-sm text-gray-500 hover:text-gray-900">Sair</button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-medium text-gray-700">Implantação</span>
            <span className="text-gray-500">{progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-200">
            <div className="h-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
          {/* Sidebar de etapas */}
          <aside className="rounded-xl border border-gray-200 bg-white p-3">
            <div className="flex flex-col gap-1">
              {STEP_DEFS.map((d, i) => {
                const st = inst.steps[d.key];
                const active = i === step;
                return (
                  <button
                    key={d.key}
                    onClick={() => setStep(i)}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${active ? 'bg-brand-50 font-semibold text-brand-800' : 'text-gray-600 hover:bg-gray-50'}`}
                  >
                    <span className="text-sm"><StepBadge s={st} /></span>
                    <span className="truncate">{d.label}</span>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Conteúdo da etapa */}
          <div>
            <ErrorAlert error={error} />
            {msg && <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{msg}</div>}

            <Card title={`${step + 1}. ${currentDef.label}`}>
              {current === 'organization' && (
                <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void runStep('organization', org); }}>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div><label className="field-label">Nome da organização *</label><Input value={org.orgName} onChange={(e) => setOrg({ ...org, orgName: e.target.value })} required /></div>
                    <div><label className="field-label">Nome fantasia</label><Input value={org.orgTradeName} onChange={(e) => setOrg({ ...org, orgTradeName: e.target.value })} /></div>
                    <div><label className="field-label">CNPJ/CPF</label><Input value={org.orgCnpj} onChange={(e) => setOrg({ ...org, orgCnpj: e.target.value })} /></div>
                    <div><label className="field-label">OAB</label><Input value={org.orgOab} onChange={(e) => setOrg({ ...org, orgOab: e.target.value })} /></div>
                    <div><label className="field-label">UF</label><Input value={org.orgUf} onChange={(e) => setOrg({ ...org, orgUf: e.target.value })} /></div>
                    <div><label className="field-label">Endereço</label><Input value={org.orgAddress} onChange={(e) => setOrg({ ...org, orgAddress: e.target.value })} /></div>
                    <div><label className="field-label">Telefone</label><Input value={org.orgPhone} onChange={(e) => setOrg({ ...org, orgPhone: e.target.value })} /></div>
                    <div><label className="field-label">Email</label><Input type="email" value={org.orgEmail} onChange={(e) => setOrg({ ...org, orgEmail: e.target.value })} /></div>
                  </div>
                  <Button type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Continuar'}</Button>
                </form>
              )}

              {current === 'administrator' && (
                <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void runStep('administrator', admin); }}>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div><label className="field-label">Nome *</label><Input value={admin.name} onChange={(e) => setAdmin({ ...admin, name: e.target.value })} required /></div>
                    <div><label className="field-label">Email *</label><Input type="email" value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} required /></div>
                    <div><label className="field-label">Senha inicial (temporária) *</label><Input type="password" value={admin.password} onChange={(e) => setAdmin({ ...admin, password: e.target.value })} required minLength={8} /></div>
                    <div><label className="field-label">Telefone</label><Input value={admin.phone} onChange={(e) => setAdmin({ ...admin, phone: e.target.value })} /></div>
                    <div><label className="field-label">OAB</label><Input value={admin.oab} onChange={(e) => setAdmin({ ...admin, oab: e.target.value })} /></div>
                  </div>
                  <p className="text-xs text-gray-500">Perfil: <b>ADMIN + LAWYER</b>. Senha temporária — o administrador deve alterá-la no primeiro acesso.</p>
                  <Button type="submit" disabled={busy}>{busy ? 'Criando…' : 'Criar administrador'}</Button>
                </form>
              )}

              {current === 'infrastructure' && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">Executa verificações reais de banco, migrations, storage e ambiente.</p>
                  <Button onClick={() => void runStep('infrastructure')} disabled={busy}>{busy ? 'Testando…' : 'Executar verificação'}</Button>
                </div>
              )}

              {current === 'email' && (
                <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void runStep('email', { ...smtp, port: Number(smtp.port), secure: smtp.secure === 'true' }); }}>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div><label className="field-label">SMTP Host</label><Input value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} placeholder="smtp.exemplo.com" /></div>
                    <div><label className="field-label">Porta</label><Input value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: e.target.value })} /></div>
                    <div><label className="field-label">Usuário</label><Input value={smtp.user} onChange={(e) => setSmtp({ ...smtp, user: e.target.value })} /></div>
                    <div><label className="field-label">Senha</label><Input type="password" value={smtp.pass} onChange={(e) => setSmtp({ ...smtp, pass: e.target.value })} /></div>
                    <div><label className="field-label">Remetente</label><Input value={smtp.from} onChange={(e) => setSmtp({ ...smtp, from: e.target.value })} /></div>
                    <div><label className="field-label">Secure (TLS)</label><Select value={smtp.secure} onChange={(e) => setSmtp({ ...smtp, secure: e.target.value })}><option value="false">Não</option><option value="true">Sim</option></Select></div>
                  </div>
                  <div className="flex gap-2">
                    <SecondaryButton type="button" onClick={() => void runStep('email', { ...smtp, port: Number(smtp.port), secure: smtp.secure === 'true' })} disabled={busy}>Testar e salvar</SecondaryButton>
                    <Button type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar e validar'}</Button>
                  </div>
                </form>
              )}

              {current === 'ai' && (
                <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void runStep('ai', ai); }}>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div><label className="field-label">Provider</label><Select value={ai.provider} onChange={(e) => setAi({ ...ai, provider: e.target.value })}><option value="openai">OpenAI / Compatível</option><option value="local">LocalAI</option></Select></div>
                    <div><label className="field-label">Modelo</label><Input value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })} placeholder="gpt-4o-mini" /></div>
                    <div className="sm:col-span-2"><label className="field-label">Base URL</label><Input value={ai.baseUrl} onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" /></div>
                    <div className="sm:col-span-2"><label className="field-label">API Key</label><Input type="password" value={ai.apiKey} onChange={(e) => setAi({ ...ai, apiKey: e.target.value })} /></div>
                  </div>
                  <div className="flex gap-2">
                    <SecondaryButton type="button" onClick={() => void runStep('ai', { ...ai, baseUrl: ai.provider === 'local' ? '' : ai.baseUrl })} disabled={busy}>Testar e salvar</SecondaryButton>
                    <Button type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar e validar'}</Button>
                  </div>
                </form>
              )}

              {['storage', 'capture', 'security'].includes(current) && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">
                    {current === 'storage' && 'Testa escrita, leitura e remoção no storage configurado.'}
                    {current === 'capture' && 'Verifica os adapters de captura (PJe, e-SAJ, Projudi).'}
                    {current === 'security' && 'Executa verificações de segurança: isolamento, sessões, permissions, scope e auditoria.'}
                  </p>
                  <Button onClick={() => void runStep(current)} disabled={busy}>{busy ? 'Executando…' : 'Executar'}</Button>
                </div>
              )}

              {current === 'notifications' && (
                <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void runStep('notifications', notif); }}>
                  {([['emailEnabled', 'E-mail habilitado'], ['newPublication', 'Nova intimação'], ['deadlineAlert', 'Alerta de prazo'], ['paymentAlert', 'Cobrança']] as const).map(([k, label]) => (
                    <label key={k} className="flex items-center justify-between text-sm">
                      <span>{label}</span>
                      <input type="checkbox" checked={notif[k] as boolean} onChange={(e) => setNotif({ ...notif, [k]: e.target.checked })} />
                    </label>
                  ))}
                  <Button type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar preferências'}</Button>
                </form>
              )}

              {current === 'functional' && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">
                    Cria cliente/processo/intimação de teste, valida extração e IA, verifica responsável/notificação e remove os dados temporários.
                  </p>
                  <Button onClick={() => void runStep('functional')} disabled={busy}>{busy ? 'Executando…' : 'Executar teste funcional'}</Button>
                </div>
              )}

              {current === 'summary' && (
                <div className="space-y-4">
                  <ErrorAlert error={error} />
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-gray-500">Organização</span><b>{String(inst.data.orgName ?? '—')}</b></div>
                    <div className="flex justify-between"><span className="text-gray-500">Tipo</span><b>{inst.clientType === 'escritorio' ? 'Escritório' : 'Advogado Solo'}</b></div>
                    <div className="flex justify-between"><span className="text-gray-500">Administrador</span><b>{String(inst.data.adminName ?? '—')} ({String(inst.data.adminEmail ?? '—')})</b></div>
                  </dl>
                  <div className="rounded-lg border border-gray-200 p-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Checklist</div>
                    <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                      {STEP_DEFS.map((d) => (
                        <li key={d.key} className="flex items-center gap-2 text-sm"><StepBadge s={inst.steps[d.key]} /><span>{d.label}</span></li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void finalize()} disabled={busy}>{busy ? 'Finalizando…' : 'Finalizar implantação'}</Button>
                  </div>
                  {inst.ready && (
                    <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4">
                      <div className="text-sm font-semibold text-green-800">🟢 PRONTA PARA ENTREGA</div>
                      <label className="mt-3 flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={includePassword} onChange={(e) => setIncludePassword(e.target.checked)} />
                        Incluir credencial temporária no relatório
                      </label>
                      <Button onClick={() => void downloadReport()} disabled={reportLoading} className="mt-3">
                        {reportLoading ? 'Gerando…' : 'Baixar relatório de implantação (PDF)'}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Navegação */}
              <div className="mt-6 flex items-center justify-between border-t border-gray-100 pt-4">
                <SecondaryButton onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>← Voltar</SecondaryButton>
                <div className="flex items-center gap-2">
                  {inst.steps[current]?.status === 'OK' && (
                    <span className="text-xs text-green-700">🟢 {currentStatus === 'OK' ? 'Concluído' : ''}</span>
                  )}
                  <Button onClick={() => setStep(Math.min(STEP_KEYS.length - 1, step + 1))} disabled={step >= STEP_KEYS.length - 1}>Avançar →</Button>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}