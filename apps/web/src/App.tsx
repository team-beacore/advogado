import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import Onboarding from './pages/Onboarding';
import Dashboard from './pages/Dashboard';
import Processes from './pages/Processes';
import ProcessDetail from './pages/ProcessDetail';
import Clients from './pages/Clients';
import ClientDetail from './pages/ClientDetail';
import Tasks from './pages/Tasks';
import Publications from './pages/Publications';
import Documents from './pages/Documents';
import Leads from './pages/Leads';
import Settings from './pages/Settings';
import Finance from './pages/Finance';
import Team from './pages/Team';
import SuperAdmin from './pages/SuperAdmin';
import SuperAdminInstall from './pages/SuperAdminInstall';
import PortalLogin from './pages/PortalLogin';
import PortalDashboard from './pages/PortalDashboard';
import PortalProcessDetail from './pages/PortalProcessDetail';
import ProcessDiscovery from './pages/ProcessDiscovery';
import ProcessDiscoveryReview from './pages/ProcessDiscoveryReview';

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-gray-500">Carregando…</div>;
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  // SUPER ADMIN pertence à camada técnica, fora de qualquer organização
  if (user?.isSuperAdmin) return <Navigate to="/superadmin" replace />;
  if (user && !user.organizationId) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

function RequireOrg({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  // SUPER ADMIN nunca passa pelo fluxo jurídico/onboarding
  if (user.isSuperAdmin) return <Navigate to="/superadmin" replace />;
  if (!user.organizationId) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

function SuperAdminGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-gray-500">Carregando…</div>;
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!user.isSuperAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/onboarding" element={<Protected><Onboarding /></Protected>} />
      <Route path="/superadmin" element={<SuperAdminGuard><SuperAdmin /></SuperAdminGuard>} />
      <Route path="/superadmin/install" element={<SuperAdminGuard><SuperAdminInstall /></SuperAdminGuard>} />
      <Route path="/" element={<Protected><OnboardingGuard><Layout /></OnboardingGuard></Protected>}>
        <Route index element={<RequireOrg><Dashboard /></RequireOrg>} />
        <Route path="processos" element={<RequireOrg><Processes /></RequireOrg>} />
        <Route path="processos/:id" element={<RequireOrg><ProcessDetail /></RequireOrg>} />
        <Route path="descoberta" element={<RequireOrg><ProcessDiscovery /></RequireOrg>} />
        <Route path="descoberta/:id" element={<RequireOrg><ProcessDiscoveryReview /></RequireOrg>} />
        <Route path="clientes" element={<RequireOrg><Clients /></RequireOrg>} />
        <Route path="clientes/:id" element={<RequireOrg><ClientDetail /></RequireOrg>} />
        <Route path="tarefas" element={<RequireOrg><Tasks /></RequireOrg>} />
        <Route path="intimacoes" element={<RequireOrg><Publications /></RequireOrg>} />
        <Route path="documentos" element={<RequireOrg><Documents /></RequireOrg>} />
        <Route path="leads" element={<RequireOrg><Leads /></RequireOrg>} />
        <Route path="financeiro" element={<RequireOrg><Finance /></RequireOrg>} />
        <Route path="configuracoes" element={<RequireOrg><Settings /></RequireOrg>} />
        <Route path="equipe" element={<RequireOrg><Team /></RequireOrg>} />
      </Route>
      <Route path="/portal/login" element={<PortalLogin />} />
      <Route path="/portal" element={<PortalDashboard />} />
      <Route path="/portal/processos/:id" element={<PortalProcessDetail />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
