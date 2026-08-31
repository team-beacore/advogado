import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiPost } from '../api/client';
import { ErrorAlert, Input, Button } from '../components/ui';

export default function PortalLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiPost('/api/portal/login', { email, password });
      navigate('/portal');
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-950 to-brand-900 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-6 text-center">
          <h1 className="font-display text-2xl font-semibold text-gray-900">Portal do Cliente</h1>
          <p className="mt-1 text-sm text-gray-500">Acompanhe a evolução dos seus processos.</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <ErrorAlert error={error} />
          <div>
            <label className="field-label">Email</label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </div>
          <div>
            <label className="field-label">Senha</label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</Button>
        </form>
      </div>
    </div>
  );
}