import { Link } from 'react-router-dom';
import { Shield, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

export const AdminMenu = () => {
  const { isSuperAdmin, isAdmin } = useAuth();

  if (!isAdmin && !isSuperAdmin) return null;

  return (
    <div className="px-3 py-2">
      <h3 className="mb-2 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Administración
      </h3>
      <div className="space-y-1">
        {isSuperAdmin && (
          <Link
            to="/admin/users"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all hover:bg-accent"
          >
            <Shield className="h-4 w-4" />
            <span>Usuarios</span>
          </Link>
        )}
        {isAdmin && (
          <Link
            to="/admin/permissions"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all hover:bg-accent"
          >
            <Users className="h-4 w-4" />
            <span>Roles y permisos</span>
          </Link>
        )}
      </div>
    </div>
  );
};
