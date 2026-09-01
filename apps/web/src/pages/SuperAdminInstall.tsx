import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Card, Badge, ErrorAlert, Button, SecondaryButton, Input, Select } from '../components/ui';

type StepStatus = 'NOT_STARTED' | 'PENDING' | 'OK' | 'FAILED';
interface StepState { status: StepStatus; message?: string; testedAt?: string }
interface Installation {
  id: string;
  currentStep: number;
  steps: Record<string, StepState>;
  clientType: 'solo' | 'escritorio' | null;
  data: Record<string, unknown>;
  ready: boolean;
}

const BASE_STEPS = [
  { key: 'infrastructure', label: 'Infraestrutura' },
  { key: 'email', label: 'E-mail' },
  { key: 'ai', label: 'Inteligência Artificial' },
  { key: 'storage', label: 'Storage' },
  { key: 'capture', label: 'Captura' },
  { key: 'notifications', label: 'Notificações' },
  { key: 'security', label: 'Segurança' },
  { key: 'functional', label: 'Teste funcional' },
  { key: 'summary', label: 'Resumo' },
] as const;

/**
 * Etapas visíveis conforme o plano.
 * SOLO: unifica "Dados profissionais" + "Advogado responsável" em uma única etapa "Dados do advogado".
 * OFFICE: mantém "Dados do escritório" e "Administrador" como etapas separadas.
 */
function getStepDefs(clientType: 'solo' | 'escritorio' | null): Array<{ key: string; label: string }> {
  const head: Array<{ key: string; label: string }> = [{ key: 'type', label: 'Tipo de contratação' }];
  if (clientType === 'solo') {
    head.push({ key: 'soloDetails', label: 'Dados do advogado' });
  } else {
    head.push({ key: 'organization', label: 'Dados do escritório' });
    head.push({ key: 'administrator', label: 'Administrador do escritório' });
  }
  return [...head, ...BASE_STEPS];
}

function getStepState(key: string, steps: Record<string, StepState>): StepState | undefined {
  if (key === 'soloDetails') {
    const o = steps.organization;
    const a = steps.administrator;
    if (o?.status === 'OK' && a?.status === 'OK') return { status: 'OK' };
    if (o?.status === 'FAILED' || a?.status === 'FAILED') return { status: 'FAILED' };
    if (o && o.status !== 'NOT_STARTED') return { status: 'PENDING' };
    return undefined;
  }
  return steps[key];
}

function stepOk(key: string, steps: Record<string, StepState>): boolean {
  if (key === 'soloDetails') {
    return steps.organization?.status === 'OK' && steps.administrator?.status === 'OK';
  }
  return steps[key]?.status === 'OK';
}

/** Rótulos para mensagens de status (por chave do backend). */
function stepLabel(key: string, clientType: 'solo' | 'escritorio' | null): string {
  if (key === 'soloDetails') return 'Dados do advogado';
  if (key === 'organization') return clientType === 'solo' ? 'Dados profissionais' : 'Dados do escritório';
  if (key === 'administrator') return clientType === 'solo' ? 'Advogado responsável' : 'Administrador do escritório';
  return BASE_STEPS.find((d) => d.key === key)?.label ?? key;
}

function statusIcon(s: StepState | undefined): { icon: string; color: string } {
  if (!s || s.status === 'NOT_STARTED') return { icon: '⚪', color: 'text-gray-400' };
  if (s.status === 'OK') return { icon: '🟢', color: 'text-green-600' };
  if (s.status === 'FAILED') return { icon: '🔴', color: 'text-red-600' };
  return { icon: '🟡', color: 'text-yellow-500' };
}

function StepBadge({ s }: { s: StepState | undefined }) {
  const { icon } = statusIcon(s);
  return <span>{icon}</span>;
}

const initialOrg = { orgName: '', orgTradeName: '', orgCnpj: '', orgOab: '', orgUf: '', orgAddress: '', orgPhone: '', orgEmail: '' };
const initialAdmin = { name: '', email: '', password: '', phone: '', oab: '' };
const initialSmtp = { host: '', port: '587', user: '', pass: '', from: '', secure: 'false' };
const initialAi = { provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' };
const initialNotif = { emailEnabled: true, newPublication: true, deadlineAlert: true, paymentAlert: false };

export default function SuperAdminInstall() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [inst, setInst] = useState<Installation | null>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [testingStep, setTestingStep] = useState<string | null>(null);

  const [org, setOrg] = useState(initialOrg);
  const [admin, setAdmin] = useState(initialAdmin);
  const [smtp, setSmtp] = useState(initialSmtp);
  const [ai, setAi] = useState(initialAi);
  const [notif, setNotif] = useState(initialNotif);
  const [includePassword, setIncludePassword] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiGet<{ installation: Installation | null }>('/api/superadmin/installation');
      setInst(res.installation);
      if (res.installation) {
        const defs = getStepDefs(res.installation.clientType);
        const idx = defs.findIndex((d) => !stepOk(d.key, res.installation!.steps));
        setStep(idx === -1 ? defs.length - 1 : Math.max(0, idx));
      }
    } catch (e) { setError(e); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const startWizard = async () => {
    setError(null);
    try {
      const res = await apiPost<{ installation: Installation }>('/api/superadmin/installation', {});
      setInst(res.installation);
      setStep(0);
      setMsg('');
    } catch (e) { setError(e); }
  };

  const runStep = async (path: string, body?: unknown) => {
    setError(null); setMsg(''); setBusy(true); setTestingStep(path);
    try {
      const res = await apiPost<{ installation: Installation }>(`/api/superadmin/installation/step/${path}`, body);
      setInst(res.installation);
      const stepStatus = res.installation?.steps?.[path]?.status;
      const label = stepLabel(path, res.installation?.clientType ?? null);
      if (stepStatus === 'OK') setMsg(`✅ ${label} validado.`);
      else if (stepStatus === 'FAILED') setMsg(`❌ Falha: ${res.installation?.steps?.[path]?.message ?? 'erro desconhecido'}`);
      else setMsg(`ℹ️ ${label} salvo (status: ${stepStatus ?? 'pendente'}).`);
    }     catch (e) { setError(e); }
    finally { setBusy(false); setTestingStep(null); }
  };

  /** Etapa unificada SOLO: grava dados profissionais (organization) + credenciais (administrador) de uma vez. */
  const runSoloDetails = async () => {
    setError(null); setMsg(''); setBusy(true); setTestingStep('soloDetails');
    try {
      const orgRes = await apiPost<{ installation: Installation }>('/api/superadmin/installation/step/organization', org);
      setInst(orgRes.installation);
      const adminRes = await apiPost<{ installation: Installation }>('/api/superadmin/installation/step/administrator', {
        name: admin.name,
        email: org.orgEmail,
        password: admin.password,
        phone: org.orgPhone,
        oab: org.orgOab,
      });
      setInst(adminRes.installation);
      const orgStatus = adminRes.installation?.steps?.organization?.status;
      const admStatus = adminRes.installation?.steps?.administrator?.status;
      if (orgStatus === 'OK' && admStatus === 'OK') setMsg('✅ Dados do advogado validados (ADMIN + LAWYER).');
      else setMsg(`ℹ️ Dados do advogado salvos (${orgStatus ?? 'pendente'} / ${admStatus ?? 'pendente'}).`);
    } catch (e) { setError(e); }
    finally { setBusy(false); setTestingStep(null); }
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
            <div>
              <div className="eyebrow">Camada técnica</div>
              <h1 className="font-display text-lg font-semibold text-gray-900">Nova implantação</h1>
            </div>
            <button onClick={() => void doLogout()} className="text-sm text-gray-500 hover:text-gray-900">Sair</button>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-10">
          <ErrorAlert error={error} />
          <Card title="Assistente de implantação">
            <p className="mb-5 text-sm text-gray-600">Prepare uma nova instalação da Plataforma Jurídica. O assistente guiará você por todas as etapas de implantação.</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void startWizard()} className="whitespace-nowrap">+ Nova implantação</Button>
              <SecondaryButton onClick={() => navigate('/superadmin')}>Voltar ao painel</SecondaryButton>
            </div>
          </Card>
        </main>
      </div>
    );
  }

  const stepDefs = getStepDefs(inst.clientType);
  const stepKeys = stepDefs.map((d) => d.key);
  const current = stepKeys[step];
  const isSolo = inst.clientType === 'solo' || inst.data.planType === 'SOLO';
  const okCount = stepDefs.filter((d) => stepOk(d.key, inst.steps)).length;
  const progress = Math.round((okCount / stepDefs.length) * 100);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div>
            <div className="eyebrow">Camada técnica</div>
            <h1 className="font-display text-lg font-semibold text-gray-900">Implantação da Instalação</h1>
          </div>
          <div className="flex items-center gap-3">
            {inst.clientType && <Badge color={isSolo ? 'green' : 'blue'}>{isSolo ? 'Advogado Solo · SOLO' : 'Escritório · OFFICE'}</Badge>}
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
              {stepDefs.map((d, i) => {
                const st = getStepState(d.key, inst.steps);
                const active = i === step;
                const { icon } = statusIcon(st);
                return (
                  <button
                    key={d.key}
                    onClick={() => setStep(i)}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${active ? 'bg-brand-50 font-semibold text-brand-800' : 'text-gray-600 hover:bg-gray-50'}`}
                  >
                    <span className="text-sm">{icon}</span>
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

            <Card title={`${step + 1}. ${stepDefs[step].label}`}>
              {current === 'type' && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">Qual tipo de instalação será criada?</p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => void runStep('type', { clientType: 'solo' })}
                      disabled={busy}
                      className={`flex flex-col items-start gap-2 rounded-xl border p-5 text-left transition-all hover:border-brand-400 hover:bg-brand-50/50 disabled:opacity-50 ${inst.data.planType === 'SOLO' ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-200' : 'border-gray-200 bg-white'}`}
                    >
                      <span className="font-display text-base font-semibold text-gray-900">Advogado Solo</span>
                      <span className="text-sm text-gray-500">Instalação para advogado autônomo ou consultório individual.</span>
                      <ul className="mt-1 space-y-1 text-xs text-gray-500">
                        <li>• 1 usuário</li>
                        <li>• ADMIN + LAWYER</li>
                        <li>• sem equipe</li>
                      </ul>
                    </button>
                    <button
                      type="button"
                      onClick={() => void runStep('type', { clientType: 'escritorio' })}
                      disabled={busy}
                      className={`flex flex-col items-start gap-2 rounded-xl border p-5 text-left transition-all hover:border-brand-400 hover:bg-brand-50/50 disabled:opacity-50 ${inst.data.planType === 'OFFICE' ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-200' : 'border-gray-200 bg-white'}`}
                    >
                      <span className="font-display text-base font-semibold text-gray-900">Escritório</span>
                      <span className="text-sm text-gray-500">Instalação para escritório com múltiplos usuários.</span>
                      <ul className="mt-1 space-y-1 text-xs text-gray-500">
                        <li>• ADMIN, LAWYER, ASSISTANT, FINANCE</li>
                        <li>• gerenciamento de equipe</li>
                      </ul>
                    </button>
                  </div>
                  {inst.clientType && (
                    <div className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-800">
                      Plano selecionado: <b>{inst.clientType === 'escritorio' ? 'OFFICE' : 'SOLO'}</b>
                    </div>
                  )}
                </div>
              )}

              {current === 'soloDetails' && (
                <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void runSoloDetails(); }}>
                  <div className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-800">
                    Plano selecionado: <b>SOLO</b>
                  </div>
                  <p className="font-display text-sm font-semibold text-gray-700">Dados profissionais</p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div><label className="field-label">Nome completo *</label><Input value={admin.name} onChange={(e) => setAdmin({ ...admin, name: e.target.value })} required /></div>
                    <div><label className="field-label">Nome profissional</label><Input value={org.orgName} onChange={(e) => setOrg({ ...org, orgName: e.target.value })} placeholder="João Silva Advocacia" required /></div>
                    <div><label className="field-label">CPF</label><Input value={org.orgCnpj} onChange={(e) => setOrg({ ...org, orgCnpj: e.target.value })} /></div>
                    <div><label className="field-label">OAB</label><Input value={org.orgOab} onChange={(e) => setOrg({ ...org, orgOab: e.target.value })} /></div>
                    <div><label className="field-label">UF</label><Input value={org.orgUf} onChange={(e) => setOrg({ ...org, orgUf: e.target.value })} /></div>
                    <div className="sm:col-span-2"><label className="field-label">Endereço profissional</label><Input value={org.orgAddress} onChange={(e) => setOrg({ ...org, orgAddress: e.target.value })} /></div>
                    <div><label className="field-label">Telefone</label><Input value={org.orgPhone} onChange={(e) => setOrg({ ...org, orgPhone: e.target.value })} /></div>
                    <div><label className="field-label">E-mail *</label><Input type="email" value={org.orgEmail} onChange={(e) => setOrg({ ...org, orgEmail: e.target.value })} required /></div>
                  </div>
                  <p className="font-display text-sm font-semibold text-gray-700">Credenciais de acesso</p>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                    E-mail de acesso: <b>{org.orgEmail || '—'}</b>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="field-label">Senha inicial (temporária) *</label>
                      <Input type="password" value={admin.password} onChange={(e) => setAdmin({ ...admin, password: e.target.value })} required minLength={8} />
                    </div>
                  </div>
                  <div className="rounded-lg border border-warning-100 bg-warning-50 px-4 py-3 text-sm text-warning-800">
                    Perfil: <b>ADMIN + LAWYER</b>. Esta senha é temporária e deverá ser alterada imediatamente após o primeiro acesso.
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={includePassword} onChange={(e) => setIncludePassword(e.target.checked)} />
                    Incluir senha temporária no relatório de implantação
                  </label>
                  <Button type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar dados do advogado'}</Button>
                </form>
              )}

              {current === 'organization' && (
                <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void runStep('organization', org); }}>
                  <div className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-800">
                    Plano selecionado: <b>OFFICE</b>
                  </div>
                  <p className="text-sm text-gray-600">Informe os dados do escritório que será utilizado nesta instalação.</p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div><label className="field-label">Nome do escritório *</label><Input value={org.orgName} onChange={(e) => setOrg({ ...org, orgName: e.target.value })} placeholder="Silva & Associados" required /></div>
                    <div><label className="field-label">Nome fantasia</label><Input value={org.orgTradeName} onChange={(e) => setOrg({ ...org, orgTradeName: e.target.value })} /></div>
                    <div><label className="field-label">CNPJ</label><Input value={org.orgCnpj} onChange={(e) => setOrg({ ...org, orgCnpj: e.target.value })} /></div>
                    <div><label className="field-label">OAB</label><Input value={org.orgOab} onChange={(e) => setOrg({ ...org, orgOab: e.target.value })} /></div>
                    <div><label className="field-label">UF</label><Input value={org.orgUf} onChange={(e) => setOrg({ ...org, orgUf: e.target.value })} /></div>
                    <div><label className="field-label">Endereço</label><Input value={org.orgAddress} onChange={(e) => setOrg({ ...org, orgAddress: e.target.value })} /></div>
                    <div><label className="field-label">Telefone</label><Input value={org.orgPhone} onChange={(e) => setOrg({ ...org, orgPhone: e.target.value })} /></div>
                    <div><label className="field-label">E-mail</label><Input type="email" value={org.orgEmail} onChange={(e) => setOrg({ ...org, orgEmail: e.target.value })} /></div>
                  </div>
                  <Button type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Continuar'}</Button>
                </form>
              )}

              {current === 'administrator' && (
                <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void runStep('administrator', admin); }}>
                  <p className="text-sm text-gray-600">Cadastre o administrador responsável pela instalação.</p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div><label className="field-label">Nome *</label><Input value={admin.name} onChange={(e) => setAdmin({ ...admin, name: e.target.value })} required /></div>
                    <div><label className="field-label">Email *</label><Input type="email" value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} required /></div>
                    <div><label className="field-label">Telefone</label><Input value={admin.phone} onChange={(e) => setAdmin({ ...admin, phone: e.target.value })} /></div>
                    <div><label className="field-label">OAB</label><Input value={admin.oab} onChange={(e) => setAdmin({ ...admin, oab: e.target.value })} /></div>
                    <div className="sm:col-span-2">
                      <label className="field-label">Senha inicial (temporária) *</label>
                      <Input type="password" value={admin.password} onChange={(e) => setAdmin({ ...admin, password: e.target.value })} required minLength={8} />
                    </div>
                  </div>
                  <div className="rounded-lg border border-warning-100 bg-warning-50 px-4 py-3 text-sm text-warning-800">
                    Perfil: <b>ADMIN + LAWYER</b>. Esta senha é temporária e deverá ser alterada imediatamente após o primeiro acesso.
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={includePassword} onChange={(e) => setIncludePassword(e.target.checked)} />
                    Incluir senha temporária no relatório de implantação
                  </label>
                  <Button type="submit" disabled={busy}>{busy ? 'Criando…' : 'Criar usuário'}</Button>
                </form>
              )}

              {current === 'infrastructure' && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">Executa verificações reais de banco, migrations, storage e ambiente.</p>
                  <div className="rounded-lg border border-gray-200 p-3 text-sm">
                    <ul className="space-y-1.5">
                      <li className="flex items-center gap-2">🟢 API funcionando</li>
                      <li className="flex items-center gap-2">🟢 Banco funcionando</li>
                      <li className="flex items-center gap-2">🟢 Storage disponível</li>
                      <li className="flex items-center gap-2">🟢 Migrations aplicadas</li>
                    </ul>
                  </div>
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
                  <p className="text-xs text-gray-500">O teste valida conexão, autenticação e envio real de e-mail. A senha nunca é exibida.</p>
                  <div className="flex gap-2">
                    <Button type="submit" disabled={busy}>{busy ? 'Testando…' : 'Testar e-mail e validar'}</Button>
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
                  <p className="text-xs text-gray-500">O teste técnico executa uma chamada real com o prompt "Responda apenas: TESTE OK". A API Key nunca é exibida.</p>
                  <div className="flex gap-2">
                    <Button type="submit" disabled={busy}>{busy ? 'Testando…' : 'Testar e validar'}</Button>
                  </div>
                </form>
              )}

              {current === 'storage' && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">Testa escrita, leitura e remoção no storage configurado, usando apenas arquivo de teste.</p>
                  <Button onClick={() => void runStep('storage')} disabled={busy}>{busy ? 'Testando…' : 'Executar teste de storage'}</Button>
                </div>
              )}

              {current === 'capture' && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">A configuração técnica das fontes de captura é exclusiva do SUPER ADMIN. Nesta instalação, a fonte de demonstração é validada localmente (dados fictícios).</p>
                  <div className="rounded-lg border border-gray-200 p-3 text-sm">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Fontes</div>
                    <ul className="space-y-1.5">
                      <li className="flex items-center gap-2">🟢 Demonstração — <span className="text-brand-700">validada localmente</span></li>
                      <li className="flex items-center gap-2">⚪ DataJud — fonte pública, não implementada nesta versão</li>
                      <li className="flex items-center gap-2">⚪ PJe — não implementado nesta versão</li>
                      <li className="flex items-center gap-2">⚪ e-SAJ — não implementado nesta versão</li>
                      <li className="flex items-center gap-2">⚪ Projudi — não implementado nesta versão</li>
                    </ul>
                  </div>
                  <div className="rounded-lg border border-info-100 bg-info-50 px-4 py-3 text-xs leading-relaxed text-info-700">
                    Ambiente de demonstração. Os dados apresentados são fictícios e servem apenas para demonstração e testes. Nenhuma credencial judicial é utilizada.
                  </div>
                  <Button onClick={() => void runStep('capture')} disabled={busy}>{busy ? 'Validando…' : 'Executar captura de demonstração'}</Button>
                </div>
              )}

              {current === 'notifications' && (
                <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void runStep('notifications', notif); }}>
                  <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
                    Canal de comunicação: <b>E-mail</b> — {inst.steps.email?.status === 'OK' ? '🟢 configurado e testado' : '🟡 não validado'}
                  </div>
                  {([['emailEnabled', 'E-mail habilitado'], ['newPublication', 'Nova intimação'], ['deadlineAlert', 'Alerta de prazo'], ['paymentAlert', 'Cobrança']] as const).map(([k, label]) => (
                    <label key={k} className="flex items-center justify-between text-sm">
                      <span>{label}</span>
                      <input type="checkbox" checked={notif[k] as boolean} onChange={(e) => setNotif({ ...notif, [k]: e.target.checked })} />
                    </label>
                  ))}
                  <Button type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar preferências'}</Button>
                </form>
              )}

              {current === 'security' && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">Executa verificações de segurança: autenticação, sessões, senhas, isolamento, permissões, scope e auditoria.</p>
                  <div className="rounded-lg border border-gray-200 p-3 text-sm">
                    <ul className="space-y-1.5">
                      <li className="flex items-center gap-2">🟢 Autenticação</li>
                      <li className="flex items-center gap-2">🟢 Sessões</li>
                      <li className="flex items-center gap-2">🟢 Senhas (hash)</li>
                      <li className="flex items-center gap-2">🟢 Isolamento</li>
                      <li className="flex items-center gap-2">🟢 Permissões</li>
                      <li className="flex items-center gap-2">🟢 Auditoria</li>
                    </ul>
                  </div>
                  <Button onClick={() => void runStep('security')} disabled={busy}>{busy ? 'Executando…' : 'Executar verificação'}</Button>
                </div>
              )}

              {current === 'functional' && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">
                    Cria cliente/processo/documento/intimação de teste, valida extração e IA, dispara notificação por e-mail e remove os dados temporários.
                  </p>
                  <Button onClick={() => void runStep('functional')} disabled={busy}>{busy ? 'Executando…' : 'Executar teste funcional'}</Button>
                </div>
              )}

              {current === 'summary' && (
                <div className="space-y-4">
                  <ErrorAlert error={error} />
                  <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-800">
                    {inst.ready ? '🟢 INSTALAÇÃO VALIDADA' : 'Em andamento…'}
                  </div>
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-gray-500">Instalação</span><b>{String(inst.data.orgName ?? '—')}</b></div>
                    <div className="flex justify-between"><span className="text-gray-500">Plano</span><b>{inst.data.planType ? String(inst.data.planType) : (inst.clientType === 'escritorio' ? 'OFFICE' : inst.clientType === 'solo' ? 'SOLO' : '—')}</b></div>
                    <div className="flex justify-between"><span className="text-gray-500">{isSolo ? 'Responsável' : 'Administrador'}</span><b>{String(inst.data.adminName ?? '—')} ({String(inst.data.adminEmail ?? '—')})</b></div>
                  </dl>
                  <div className="rounded-lg border border-gray-200 p-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Infraestrutura</div>
                    <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                      <li className="flex items-center gap-2 text-sm">API <StepBadge s={inst.steps.infrastructure} /></li>
                      <li className="flex items-center gap-2 text-sm">Banco <StepBadge s={inst.steps.infrastructure} /></li>
                      <li className="flex items-center gap-2 text-sm">Storage <StepBadge s={inst.steps.storage} /></li>
                    </ul>
                  </div>
                  <div className="rounded-lg border border-gray-200 p-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Comunicação</div>
                    <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                      <li className="flex items-center gap-2 text-sm">E-mail <StepBadge s={inst.steps.email} /> {inst.steps.email?.status === 'OK' ? 'configurado e testado' : ''}</li>
                    </ul>
                  </div>
                  <div className="rounded-lg border border-gray-200 p-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Inteligência Artificial</div>
                    <ul className="space-y-1 text-sm">
                      <li className="flex items-center gap-2">IA <StepBadge s={inst.steps.ai} /> {inst.steps.ai?.status === 'OK' ? 'configurada e testada' : ''}</li>
                      <li className="text-xs text-gray-500">Provider: {String((inst.data.ai as Record<string, unknown> | undefined)?.provider ?? '—')} · Modelo: {String((inst.data.ai as Record<string, unknown> | undefined)?.model ?? '—')}</li>
                    </ul>
                  </div>
                  <div className="rounded-lg border border-gray-200 p-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Captura</div>
                    <ul className="space-y-1 text-sm">
                      <li className="flex items-center gap-2">Demonstração <StepBadge s={inst.steps.capture} /> {inst.steps.capture?.status === 'OK' ? 'validada (dados fictícios)' : ''}</li>
                      <li className="text-xs text-gray-500">DataJud, PJe, e-SAJ e Projudi não implementados nesta versão.</li>
                    </ul>
                  </div>
                  <div className="rounded-lg border border-gray-200 p-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Segurança e teste funcional</div>
                    <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                      <li className="flex items-center gap-2 text-sm">Segurança <StepBadge s={inst.steps.security} /> {inst.steps.security?.status === 'OK' ? 'validada' : ''}</li>
                      <li className="flex items-center gap-2 text-sm">Teste funcional <StepBadge s={inst.steps.functional} /> {inst.steps.functional?.status === 'OK' ? 'aprovado' : ''}</li>
                    </ul>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void finalize()} disabled={busy}>{busy ? 'Finalizando…' : 'Finalizar implantação'}</Button>
                  </div>
                  {inst.ready && (
                    <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4">
                      <div className="text-sm font-semibold text-green-800">🟢 PRONTO PARA ENTREGA</div>
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
                  {getStepState(current, inst.steps)?.status === 'OK' && (
                    <span className="text-xs text-green-700">🟢 Concluído</span>
                  )}
                  {testingStep === current && <span className="text-xs text-yellow-600">🔄 Testando…</span>}
                  <Button onClick={() => setStep(Math.min(stepKeys.length - 1, step + 1))} disabled={step >= stepKeys.length - 1}>Avançar →</Button>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
