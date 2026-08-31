import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Button, Input, ErrorAlert } from '../components/ui';
import { apiPost } from '../api/client';

export default function Onboarding() {
  const { user, switchOrg } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const org = await apiPost<{ id: string }>('/api/organizations', { name });
      await switchOrg(org.id);
      navigate('/');
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-5 py-14">
      <div className="w-full max-w-md animate-fade-in">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-950 ring-1 ring-inset ring-gold-300/25">
            <svg viewBox="0 0 24 24" fill="none" stroke="#d8c188" strokeWidth="1.5" strokeLinecap="round" className="h-5 w-5">
              <path d="M12 4v16M6 20h12M4 9h8L8 15 4 9Zm12 0h4l-2 4-2-4Z" />
            </svg>
          </div>
          <div className="eyebrow">Primeiro passo</div>
          <h1 className="mt-2 font-display text-[1.7rem] font-semibold tracking-tightest text-gray-900">Criar organização</h1>
          <p className="page-subtitle">Olá, {user?.name}. Crie a organização do seu escritório para começar.</p>
        </div>
        <div className="surface p-6 sm:p-7">
          <form onSubmit={handleSubmit} className="space-y-5">
            <ErrorAlert error={error} />
            <div>
              <label className="field-label">Nome da organização</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Silva & Advogados" required />
            </div>
            <Button type="submit" disabled={loading} className="w-full py-2.5">
              {loading ? 'Criando…' : 'Criar organização'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
