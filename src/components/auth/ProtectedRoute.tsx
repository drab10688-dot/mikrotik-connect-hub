import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useModuleEnabled, TenantModule } from '@/hooks/useTenantBranding';
import { useMyPermissions } from '@/hooks/usePermissions';

interface ProtectedRouteProps {
  children: ReactNode;
  requireSuperAdmin?: boolean;
  /** Solo administradores (admin del ISP o superadmin) */
  requireAdmin?: boolean;
  /** Módulo del ISP que debe estar activo (ej: onus) */
  module?: TenantModule;
  /** Sección de permisos del técnico (ej: onus, mikrotik) */
  section?: string;
}


const Loader = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
  </div>
);

export const ProtectedRoute = ({
  children,
  requireSuperAdmin = false,
  requireAdmin = false,
  module,
  section,
}: ProtectedRouteProps) => {
  const { user, role, loading } = useAuth();
  const { isEnabled, isLoading: loadingModules } = useModuleEnabled();
  const { can, isLoading: loadingSections } = useMyPermissions();

  if (loading) return <Loader />;

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (requireSuperAdmin && role !== 'super_admin') {
    return <Navigate to="/dashboard" replace />;
  }

  if (requireAdmin && role !== 'admin' && role !== 'super_admin') {
    return <Navigate to="/dashboard" replace />;
  }

  // Módulos desactivados por el super admin para este ISP
  if (module && role !== 'super_admin') {
    if (loadingModules) return <Loader />;
    if (!isEnabled(module)) return <Navigate to="/dashboard" replace />;
  }

  // Secciones de permisos del ISP (admin y superadmin tienen acceso total)
  if (section && role !== 'super_admin') {
    if (loadingSections) return <Loader />;
    if (!can(section)) return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;

};
