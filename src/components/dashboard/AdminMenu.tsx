import { NavLink } from 'react-router-dom';
import { Shield, KeyRound, Building2, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-smooth',
    isActive
      ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold'
      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'
  );

export const AdminMenu = () => {
  const { isSuperAdmin, isAdmin } = useAuth();

  if (!isAdmin && !isSuperAdmin) return null;

  return (
    <div className="space-y-1">
      {isSuperAdmin && (
        <NavLink to="/admin/isps" className={linkClass}>
          <Building2 className="h-[18px] w-[18px]" />
          <span>ISPs</span>
        </NavLink>
      )}
      {isSuperAdmin && (
        <NavLink to="/admin/users" className={linkClass}>
          <Shield className="h-[18px] w-[18px]" />
          <span>Usuarios</span>
        </NavLink>
      )}
      {isAdmin && (
        <NavLink to="/admin/register" className={linkClass}>
          <UserPlus className="h-[18px] w-[18px]" />
          <span>Crear usuario</span>
        </NavLink>
      )}
      {isAdmin && (
        <NavLink to="/admin/permissions" className={linkClass}>
          <KeyRound className="h-[18px] w-[18px]" />
          <span>Roles y permisos</span>
        </NavLink>
      )}
    </div>
  );
};
