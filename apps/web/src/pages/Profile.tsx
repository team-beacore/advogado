import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPatch, apiPost, apiPut } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Card, Badge, ErrorAlert, Button, Input } from '../components/ui';

interface Identity {
  id: string;
  professional_name: string | null;
  oab_number: string | null;
  oab_state: string | null;
}

interface UserNotificationPrefs {
  emailEnabled: boolean;
  newPublication: boolean;
  deadlineAlert: boolean;
  paymentAlert: boolean;
}

export default function Profile() {
  const { user, refresh } = useAuth();

  // Dados pessoais
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [personalError, setPersonalError] = useState<unknown>(null);
  const [personalMsg, setPersonalMsg] = useState('');
  const [personalSaving, setPersonalSaving] = useState(false);

  // Dados profissionais (identidade)
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [identityLoading, setIdentityLoading] = useState(true);
  const [identityForm, setIdentityForm] = useState({ professionalName: '', oabNumber: '', oabState: '' });
  const [identityError, setIdentityError] = useState<unknown>(null);
  const [identityMsg, setIdentityMsg] = useState('');
  const [identitySaving, setIdentitySaving] = useState(false);

  // Preferências pessoais
  const [prefs, setPrefs] = useState<UserNotificationPrefs | null>(null);
  const [prefsError, setPrefsError] = useState<unknown>(null);

  // Segurança
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwError, setPwError] = useState<unknown>(null);
  const [pwMsg, setPwMsg] = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  const loadPrefs = useCallback(async () => {
    try {
      const p = await apiGet<UserNotificationPrefs>('/api/notifications/preferences');
      setPrefs(p);
    } catch { setPrefs(null); }
  }, []);

  useEffect(() => {
    setName(user?.name ?? '');
    setPhone(user?.phone ?? '');
  }, [user?.name, user?.phone]);

  useEffect(() => {
    void loadPrefs();
  }, [loadPrefs]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const me = await apiGet<{ identity: Identity | null }>('/api/professional-identity/me');
        if (!active) return;
        setIdentity(me.identity);
        setIdentityForm({
          professionalName: me.identity?.professional_name ?? '',
          oabNumber: me.identity?.oab_number ?? '',
          oabState: me.identity?.oab_state ?? '',
        });
      } catch { /* identidade não configurada ainda */ }
      finally { if (active) setIdentityLoading(false); }
    })();
    return () => { active = false; };
  }, []);

  const savePersonal = async (e: React.FormEvent) => {
    e.preventDefault();
    setPersonalError(null); setPersonalMsg('');
    setPersonalSaving(true);
    try {
      await apiPatch('/api/auth/me', { name: name.trim(), phone: phone.trim() });
      await refresh();
      setPersonalMsg('✅ Dados pessoais salvos.');
    } catch (err) { setPersonalError(err); }
    finally { setPersonalSaving(false); }
  };

  const saveIdentity = async (e: React.FormEvent) => {
    e.preventDefault();
    setIdentityError(null); setIdentityMsg('');
    setIdentitySaving(true);
    try {
      await apiPut('/api/professional-identity/me', {
        professionalName: identityForm.professionalName.trim(),
        oabNumber: identityForm.oabNumber.trim(),
        oabState: identityForm.oabState.trim().toUpperCase(),
      });
      const me = await apiGet<{ identity: Identity | null }>('/api/professional-identity/me');
      setIdentity(me.identity);
      setIdentityMsg('✅ Identidade profissional salva.');
    } catch (err) { setIdentityError(err); }
    finally { setIdentitySaving(false); }
  };

  const savePrefs = async (next: Partial<UserNotificationPrefs>) => {
    setPrefsError(null);
    try {
      const saved = await apiPut<UserNotificationPrefs>('/api/notifications/preferences', next);
      setPrefs(saved);
    } catch (err) { setPrefsError(err); }
  };

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

  return (
    <div>
      <div className="mb-6">
        <h1 className="page-title">Meu Perfil</h1>
        <p className="page-subtitle">Gerencie suas informações pessoais, profissionais e de acesso.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Dados pessoais */}
        <Card title="Dados pessoais">
          <form onSubmit={savePersonal} className="space-y-4">
            <ErrorAlert error={personalError} />
            {personalMsg && <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{personalMsg}</div>}
            <div>
              <label className="field-label">Nome</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required minLength={2} />
            </div>
            <div>
              <label className="field-label">E-mail</label>
              <Input value={user?.email ?? ''} disabled />
              <p className="mt-1 text-xs text-gray-500">O e-mail é o identificador de acesso e não pode ser alterado.</p>
            </div>
            <div>
              <label className="field-label">Telefone</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(21) 99999-9999" />
            </div>
            <Button type="submit" disabled={personalSaving} className="w-full">{personalSaving ? 'Salvando…' : 'Salvar dados pessoais'}</Button>
          </form>
        </Card>

        {/* Dados profissionais */}
        <Card title="Dados profissionais">
          {identityLoading ? (
            <div className="py-6 text-center text-sm text-gray-400">Carregando…</div>
          ) : (
            <form onSubmit={saveIdentity} className="space-y-4">
              <ErrorAlert error={identityError} />
              {identityMsg && <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{identityMsg}</div>}
              {identity ? (
                <div className="mb-2 rounded-lg border border-success-100 bg-success-50 px-4 py-3 text-sm text-success-700">
                  Identidade configurada: <b>{identity.professional_name}</b> — OAB/{identity.oab_state ?? '—'} {identity.oab_number ?? '—'}
                </div>
              ) : (
                <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Sua identidade profissional ainda não foi configurada. Ela é usada pela Descoberta de processos.
                </div>
              )}
              <div>
                <label className="field-label">Nome profissional</label>
                <Input value={identityForm.professionalName} onChange={(e) => setIdentityForm({ ...identityForm, professionalName: e.target.value })} placeholder="Ex.: Maria da Silva" required minLength={2} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Nº OAB</label>
                  <Input value={identityForm.oabNumber} onChange={(e) => setIdentityForm({ ...identityForm, oabNumber: e.target.value })} placeholder="123456" required />
                </div>
                <div>
                  <label className="field-label">UF</label>
                  <Input value={identityForm.oabState} onChange={(e) => setIdentityForm({ ...identityForm, oabState: e.target.value.toUpperCase() })} placeholder="RJ" maxLength={2} required />
                </div>
              </div>
              <Button type="submit" disabled={identitySaving} className="w-full">{identitySaving ? 'Salvando…' : 'Salvar identidade profissional'}</Button>
            </form>
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

        {/* Preferências pessoais */}
        <Card title="Preferências pessoais">
          <ErrorAlert error={prefsError} />
          {prefs ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
                Preferências de notificação deste usuário. A plataforma respeita estas escolhas ao enviar avisos.
              </div>
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
          ) : (
            <div className="text-sm text-gray-500">Preferências indisponíveis no momento.</div>
          )}
        </Card>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Badge color="blue">Perfil</Badge>
        <span className="text-xs text-gray-500">Informações da pessoa autenticada — separadas das configurações da plataforma.</span>
      </div>
    </div>
  );
}
