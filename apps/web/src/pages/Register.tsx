import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Button, Input, ErrorAlert } from '../components/ui';
import LoginVisualPanel from '../components/LoginVisualPanel';

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
      <LoginVisualPanel
        title="Comece a operar com padrão de escritório premium."
        subtitle="Cadastre-se e centralize processos, clientes e prazos com rastreabilidade completa."
      />

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
