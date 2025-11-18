import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

interface ProtectedRouteProps {
  children: ReactNode;
  requireSuperAdmin?: boolean;
  requireAdmin?: boolean;
}

export const ProtectedRoute = ({ 
  children, 
  requireSuperAdmin = false,
  requireAdmin = false 
}: ProtectedRouteProps) => {
  const { user, role, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (requireSuperAdmin && role !== 'super_admin') {
    return <Navigate to="/dashboard" replace />;
  }

  if (requireAdmin && role !== 'admin' && role !== 'super_admin') {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};
