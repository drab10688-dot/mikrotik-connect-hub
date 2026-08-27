import { Link } from 'react-router-dom';
import { Shield, Server, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { PendingDevicesBadge } from '@/components/admin/PendingDevicesBadge';
import { useRealtimePendingDevices } from '@/hooks/useRealtimePendingDevices';

export const AdminMenu = () => {
  const { isSuperAdmin, isAdmin } = useAuth();
  
  // Enable realtime notifications for super admins
  useRealtimePendingDevices();

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
          <PendingDevicesBadge />
        </Link>
        {isAdmin && (
          <Link
            to="/admin/secretaries"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all hover:bg-accent"
          >
            <Users className="h-4 w-4" />
            <span>Asistentes</span>
          </Link>
        )}
      </div>
    </div>
  );
};
