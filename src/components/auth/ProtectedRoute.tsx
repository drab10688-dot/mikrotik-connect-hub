import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useSecretaryPermissions } from '@/hooks/useSecretaryPermissions';
import { useModuleEnabled, TenantModule } from '@/hooks/useTenantBranding';
import { useMyPermissions } from '@/hooks/usePermissions';

interface ProtectedRouteProps {
  children: ReactNode;
  requireSuperAdmin?: boolean;
  requireAdmin?: boolean;
  /** Permiso requerido para asistentes (ej: can_manage_clients) */
  permission?: string;
  /** Módulo del ISP que debe estar activo (ej: onus) */
  module?: TenantModule;
  /** Sección de permisos del ISP (ej: onus, mikrotik) */
  section?: string;
  /** Roles que NO pueden entrar a esta ruta */
  denyRoles?: Array<'secretary' | 'reseller' | 'user'>;
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
  permission,
  module,
  section,
  denyRoles,
}: ProtectedRouteProps) => {
  const { user, role, loading, isSecretary } = useAuth();
  const { assignments, isLoading: loadingPerms } = useSecretaryPermissions();
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

  if (denyRoles && role && denyRoles.includes(role as any)) {
    return <Navigate to="/dashboard" replace />;
  }

  // Módulos desactivados por el super admin para este ISP
  if (module && role !== 'super_admin') {
    if (loadingModules) return <Loader />;
    if (!isEnabled(module)) return <Navigate to="/dashboard" replace />;
  }

  // Secciones de permisos del ISP
  if (section && role !== 'super_admin') {
    if (loadingSections) return <Loader />;
    if (!can(section)) return <Navigate to="/dashboard" replace />;
  }

  // Los asistentes solo entran a los módulos habilitados en su asignación
  if (isSecretary && permission) {
    if (loadingPerms) return <Loader />;
    const allowed = (assignments || []).some((a: any) => a?.[permission] === true);
    if (!allowed) return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;

};
