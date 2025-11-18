import { Link } from 'react-router-dom';
import { Shield, Server, UserCheck } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

export const AdminMenu = () => {
  const { isSuperAdmin } = useAuth();

  return (
    <div className="px-3 py-2">
      <h3 className="mb-2 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {isSuperAdmin ? 'Administración' : 'Configuración'}
      </h3>
      <div className="space-y-1">
        {isSuperAdmin && (
          <>
            <Link
              to="/admin/users"
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all hover:bg-accent"
            >
              <Shield className="h-4 w-4" />
              <span>Usuarios</span>
            </Link>
          </>
        )}
        <Link
          to="/admin/mikrotik-devices"
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all hover:bg-accent"
        >
          <Server className="h-4 w-4" />
          <span>{isSuperAdmin ? 'Dispositivos' : 'Mis Dispositivos'}</span>
        </Link>
        {isSuperAdmin && (
          <Link
            to="/admin/assign-devices"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all hover:bg-accent"
          >
            <UserCheck className="h-4 w-4" />
            <span>Asignar Accesos</span>
          </Link>
        )}
      </div>
    </div>
  );
};
