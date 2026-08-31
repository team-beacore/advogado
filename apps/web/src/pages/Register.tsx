import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Button, Input, ErrorAlert } from '../components/ui';

export default function Register() {
  const { register, login } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await register(name, email, password);
      await login(email, password);
      navigate('/onboarding');
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden flex-col justify-between bg-brand-950 p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-b from-brand-700 to-brand-900 ring-1 ring-inset ring-gold-300/30">
            <svg viewBox="0 0 24 24" fill="none" stroke="#d8c188" strokeWidth="1.5" strokeLinecap="round" className="h-[18px] w-[18px]">
              <path d="M12 4v16M6 20h12M4 9h8L8 15 4 9Zm12 0h4l-2 4-2-4Z" />
            </svg>
          </div>
          <span className="font-display text-sm font-semibold tracking-tight">Plataforma Jurídica</span>
        </div>
        <div className="max-w-md">
          <p className="font-display text-[2rem] font-semibold leading-snug tracking-tightest text-white">
            Comece a operar com padrão de escritório premium.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-white/50">
            Cadastre-se e centralize processos, clientes e prazos com rastreabilidade completa.
          </p>
        </div>
        <div className="text-[11px] uppercase tracking-[0.16em] text-gold-300/60">Ambiente seguro</div>
      </aside>

      <main className="flex items-center justify-center bg-gray-50 px-5 py-14">
        <div className="w-full max-w-[26rem] animate-fade-in">
          <div className="mb-9 text-center lg:text-left">
            <div className="eyebrow">Nova conta</div>
            <h1 className="mt-2 font-display text-[1.7rem] font-semibold tracking-tightest text-gray-900">Criar conta</h1>
            <p className="page-subtitle">Leva menos de um minuto para começar.</p>
          </div>
          <div className="surface p-6 sm:p-7">
            <form onSubmit={handleSubmit} className="space-y-5">
              <ErrorAlert error={error} />
              <div>
                <label className="field-label">Nome</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
              </div>
              <div>
                <label className="field-label">Email</label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              </div>
              <div>
                <label className="field-label">Senha</label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
                <p className="mt-1.5 text-xs text-gray-400">Mínimo de 8 caracteres.</p>
              </div>
              <Button type="submit" disabled={loading} className="w-full py-2.5">
                {loading ? 'Criando…' : 'Criar conta'}
              </Button>
            </form>
          </div>
          <p className="mt-6 text-center text-sm text-gray-500">
            Já tem conta?{' '}
            <Link to="/login" className="link-quiet">
              Faça login
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
