import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Button, Input, ErrorAlert } from '../components/ui';
import LoginVisualPanel from '../components/LoginVisualPanel';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const u = await login(email, password);
      // SUPER ADMIN vai direto ao painel técnico; usuários normais vão ao fluxo
      // jurídico (que decide entre onboarding e dashboard).
      navigate(u?.isSuperAdmin ? '/superadmin' : '/');
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <LoginVisualPanel />

      <main className="flex items-center justify-center bg-gray-50 px-5 py-14">
        <div className="w-full max-w-[26rem] animate-fade-in">
          <div className="mb-9 text-center lg:text-left">
            <div className="eyebrow">Acesso restrito</div>
            <h1 className="mt-2 font-display text-[1.7rem] font-semibold tracking-tightest text-gray-900">Entrar na plataforma</h1>
            <p className="page-subtitle">Use suas credenciais profissionais para continuar.</p>
          </div>
          <div className="surface p-6 sm:p-7">
            <form onSubmit={handleSubmit} className="space-y-5">
              <ErrorAlert error={error} />
              <div>
                <label className="field-label">Email</label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              </div>
              <div>
                <label className="field-label">Senha</label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
              </div>
              <Button type="submit" disabled={loading} className="w-full py-2.5">
                {loading ? 'Entrando…' : 'Entrar'}
              </Button>
            </form>
          </div>
          <p className="mt-6 text-center text-sm text-gray-500">
            Não tem conta?{' '}
            <Link to="/register" className="link-quiet">
              Cadastre-se
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
