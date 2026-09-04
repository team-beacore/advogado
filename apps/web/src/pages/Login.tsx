import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ErrorAlert } from '../components/ui';
import AuthLayout from '../components/AuthLayout';

function EmailIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={`h-[18px] w-[18px] ${className}`} aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </svg>
  );
}

function LockIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={`h-[18px] w-[18px] ${className}`} aria-hidden="true">
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
      <circle cx="12" cy="15.5" r="1.3" />
    </svg>
  );
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
    <AuthLayout
      panelTitle={
        <>
          Todo o seu escritório,
          <br />
          <span className="text-brand-300">organizado com precisão.</span>
        </>
      }
    >
      <div className="mb-6 flex justify-center">
        <img
          src="/favicon.ico"
          alt="Plataforma Jurídica"
          className="h-12 w-12 object-contain drop-shadow-sm"
        />
      </div>

      <div className="mb-8 text-center">
        <div className="eyebrow">Acesso restrito</div>
        <h1 className="mt-2 font-display text-[1.65rem] font-semibold tracking-tightest text-gray-900">Entrar na plataforma</h1>
        <p className="page-subtitle">Use suas credenciais profissionais para continuar.</p>
      </div>

      <div className="rounded-2xl border border-gray-200/80 bg-white p-7 shadow-[0_2px_6px_rgba(16,36,53,0.04),0_12px_32px_-16px_rgba(16,36,53,0.14)] sm:p-8">
        <form onSubmit={handleSubmit} className="space-y-5">
          <ErrorAlert error={error} />

          <div>
            <label htmlFor="email" className="field-label">E-mail</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                <EmailIcon />
              </span>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@escritorio.com.br"
                autoComplete="email"
                required
                className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-11 pr-3.5 text-sm text-gray-900 shadow-sm transition-all duration-200 placeholder:text-gray-400 hover:border-gray-300 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/10"
              />
            </div>
          </div>

          <div>
            <label htmlFor="password" className="field-label">Senha</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                <LockIcon />
              </span>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Digite sua senha"
                autoComplete="current-password"
                required
                className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-11 pr-20 text-sm text-gray-900 shadow-sm transition-all duration-200 placeholder:text-gray-400 hover:border-gray-300 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-semibold text-gray-500 transition-colors hover:text-brand-700"
              >
                {showPassword ? 'Ocultar' : 'Exibir'}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-brand-600 accent-brand-600" />
              Manter-me conectado
            </label>
            <span className="text-xs text-gray-400">Sessão segura</span>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm ring-1 ring-inset ring-brand-800/40 transition-all duration-200 hover:bg-brand-800 hover:shadow-elevated focus-visible:ring-2 focus-visible:ring-brand-500/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-45"
          >
            {loading ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Entrando…
              </>
            ) : (
              <>Entrar <span aria-hidden="true">→</span></>
            )}
          </button>
        </form>
      </div>

      <p className="mt-6 text-center text-sm text-gray-500">
        Não tem conta?{' '}
        <Link to="/register" className="link-quiet">
          Cadastre-se
        </Link>
      </p>
    </AuthLayout>
  );
}
