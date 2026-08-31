import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Card, Badge, EmptyState, ErrorAlert, Button, Input, Select } from '../components/ui';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrador',
  LAWYER: 'Advogado',
  ASSISTANT: 'Assistente',
  FINANCE: 'Financeiro',
};

const ROLE_COLORS: Record<string, string> = {
  ADMIN: 'purple',
  LAWYER: 'blue',
  ASSISTANT: 'gray',
  FINANCE: 'green',
};

export default function Team() {
  const { user } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('LAWYER');
  const [inviteError, setInviteError] = useState<unknown>(null);
  const [inviteMsg, setInviteMsg] = useState<{ name: string; email: string; role: string; temporaryPassword: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiGet<TeamMember[]>('/api/organizations/members');
      setMembers(res);
    } catch (e) { setError(e); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError(null);
    setInviteMsg(null);
    try {
      const res = await apiPost<{ id: string; email: string; role: string; temporaryPassword: string | null }>('/api/organizations/members', {
        email: inviteEmail,
        role: inviteRole,
        name: inviteName,
      });
      setInviteName('');
      setInviteEmail('');
      setInviteMsg({
        name: inviteName,
        email: res.email,
        role: res.role,
        temporaryPassword: res.temporaryPassword ?? '',
      });
      void load();
    } catch (err) { setInviteError(err); }
  };

  const changeRole = async (memberId: string, role: string) => {
    setError(null);
    try {
      await apiPatch(`/api/organizations/members/${memberId}`, { role });
      void load();
    } catch (err) { setError(err); }
  };

  const remove = async (memberId: string) => {
    if (!confirm('Remover este usuário da organização?')) return;
    setError(null);
    try {
      await apiDelete(`/api/organizations/members/${memberId}`);
      void load();
    } catch (err) { setError(err); }
  };

  if (!user) return null;
  const isSolo = user.organizationType === 'SOLO';

  if (isSolo) {
    return (
      <div>
        <h1 className="page-title mb-6">Equipe</h1>
        <Card title="Plano Solo">
          <div className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-800">
            Gerenciamento de equipe não está disponível neste plano.
          </div>
          <p className="mt-3 text-sm text-gray-600">
            O plano Solo é destinado a um único usuário (ADMIN + LAWYER). Para trabalhar em equipe,
            contrate o plano Escritório.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title mb-6">Equipe</h1>
      <ErrorAlert error={error} />

      <Card title={`Membros da organização (${members.length})`}>
        {members.length === 0 ? (
          <EmptyState title="Nenhum membro." />
        ) : (
          <ul className="divide-y divide-gray-100">
            {members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900">
                    {m.name} {m.id === user.id && <span className="text-xs font-normal text-gray-400">(você)</span>}
                  </div>
                  <div className="text-xs text-gray-500">{m.email}{m.phone ? ` · ${m.phone}` : ''}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge color={ROLE_COLORS[m.role] ?? 'gray'}>{ROLE_LABELS[m.role] ?? m.role}</Badge>
                  <Select value={m.role} onChange={(e) => void changeRole(m.id, e.target.value)} className="w-auto px-2 py-1 text-xs">
                    {['LAWYER', 'ASSISTANT', 'FINANCE'].map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </Select>
                  {m.id !== user.id && (
                    <button onClick={() => void remove(m.id)} className="text-xs font-medium text-red-600 hover:underline">Remover</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Adicionar membro">
        <form onSubmit={invite} className="space-y-3">
          <ErrorAlert error={inviteError} />
          {inviteMsg && (
            <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              <div className="font-semibold">Membro criado com sucesso.</div>
              <div className="mt-1">Nome: <b>{inviteMsg.name}</b></div>
              <div>Email: <b>{inviteMsg.email}</b></div>
              <div>Perfil: <b>{ROLE_LABELS[inviteMsg.role] ?? inviteMsg.role}</b></div>
              {inviteMsg.temporaryPassword && (
                <>
                  <div className="mt-1">Senha temporária: <b className="font-mono">{inviteMsg.temporaryPassword}</b></div>
                  <div className="mt-2 rounded bg-white/60 px-2 py-1.5 text-xs">
                    ⚠️ Esta senha é temporária. O membro deverá alterá-la após o primeiro acesso.
                  </div>
                </>
              )}
              {!inviteMsg.temporaryPassword && (
                <div className="mt-1">Usuário já existente — foi adicionado à organização. Ele usa a senha da própria conta.</div>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="field-label">Nome *</label>
              <Input value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Maria Silva" required />
            </div>
            <div>
              <label className="field-label">Email *</label>
              <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="maria@escritorio.com" required />
            </div>
            <div>
              <label className="field-label">Perfil</label>
              <Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                <option value="LAWYER">Advogado</option>
                <option value="ASSISTANT">Assistente</option>
                <option value="FINANCE">Financeiro</option>
              </Select>
            </div>
          </div>
          <Button type="submit" className="w-full">Criar membro</Button>
        </form>
      </Card>
    </div>
  );
}