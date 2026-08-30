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
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <h1 className="mb-2 text-center text-2xl font-bold text-gray-900">Criar organização</h1>
        <p className="mb-8 text-center text-sm text-gray-500">
          Olá, {user?.name}. Crie a organização do seu escritório para começar.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <ErrorAlert error={error} />
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Nome da organização</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Silva & Advogados" required />
          </div>
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Criando…' : 'Criar organização'}
          </Button>
        </form>
      </div>
    </div>
  );
}