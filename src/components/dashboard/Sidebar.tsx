import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import omnisyncBrand from "@/assets/omnisync-logo-full.png.asset.json";
const omnisyncLogo = omnisyncBrand.url;
import {
  LayoutDashboard, Activity, Settings, LogOut, Router,
  ImagePlus, X, Radio, Antenna, Building2, Globe, Network, ShieldCheck, Users, KeyRound, UserPlus,
  Mail, DatabaseBackup, Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { MobileNav } from "./MobileNav";

import { useAuth } from "@/hooks/useAuth";
import { useMyTenant } from "@/hooks/useTenantBranding";
import { useSecretaryPermissions } from "@/hooks/useSecretaryPermissions";
import { useMyPermissions } from "@/hooks/usePermissions";
import { ChangePasswordDialog } from "@/components/account/ChangePasswordDialog";
import { useState, useEffect, useRef } from "react";

type MenuEntry = {
  icon: any;
  label: string;
  path: string;
  module?: "onus" | "mikrotik" | "onu_web";
  section?: string;
  group: string;
};

const menuItems: MenuEntry[] = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard", section: "dashboard", group: "Operación" },
  { icon: Antenna, label: "Gestión de ONUs", path: "/onus", module: "onus", section: "onus", group: "Operación" },
  { icon: Router, label: "Conexión MikroTik", path: "/mikrotik", module: "mikrotik", section: "mikrotik", group: "Operación" },
  { icon: UserPlus, label: "Usuarios PPPoE", path: "/pppoe", module: "mikrotik", section: "pppoe", group: "Operación" },
  
  { icon: Globe, label: "Mini-panel de equipos", path: "/onu-web", module: "onu_web", section: "onu_web", group: "Operación" },
  { icon: Network, label: "Mapa de red", path: "/topology", module: "mikrotik", section: "topology", group: "Operación" },
  { icon: Radio, label: "Credenciales y VPN", path: "/acs", section: "vpn", group: "Infraestructura" },
  { icon: Settings, label: "Configuración", path: "/settings", section: "configuracion", group: "Infraestructura" },
  { icon: Activity, label: "Diagnóstico API", path: "/diagnostics", section: "diagnostico", group: "Infraestructura" },
  { icon: Users, label: "Usuarios", path: "/admin/users", section: "usuarios", group: "Administración" },
  { icon: KeyRound, label: "Roles y permisos", path: "/admin/permissions", section: "roles", group: "Administración" },
  { icon: Mail, label: "Correo (SMTP)", path: "/admin/correo", section: "correo", group: "Administración" },
  { icon: DatabaseBackup, label: "Copias de seguridad", path: "/admin/respaldos", section: "respaldos", group: "Administración" },
];

export const Sidebar = () => {
  const navigate = useNavigate();
  const { signOut, isSecretary, isReseller, isSuperAdmin, isAdmin, user } = useAuth();
  const { assignments: secretaryAssignments, isLoading: loadingPermissions } = useSecretaryPermissions();
  const { can, isLoading: loadingSections } = useMyPermissions();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [customLogo, setCustomLogo] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState<string>("Omnisync");

  const { tenant } = useMyTenant();
  const displayLogo = customLogo || tenant?.logo_url || null;
  const displayName = tenant?.name || businessName;

  useEffect(() => {
    const savedLogo = localStorage.getItem("sidebar_logo");
    const savedName = localStorage.getItem("sidebar_business_name");
    if (savedLogo) setCustomLogo(savedLogo);
    if (savedName) setBusinessName(savedName);
  }, []);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 500000) { toast.error("La imagen debe ser menor a 500KB"); return; }
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setCustomLogo(base64);
        localStorage.setItem("sidebar_logo", base64);
        toast.success("Logo actualizado");
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveLogo = () => {
    setCustomLogo(null);
    localStorage.removeItem("sidebar_logo");
    toast.info("Logo eliminado");
  };

  const currentDeviceId = localStorage.getItem("mikrotik_device_id") || "";
  const currentPerms =
    secretaryAssignments?.find((a: any) => a.mikrotik_id === currentDeviceId) ||
    secretaryAssignments?.find((a: any) => !a.mikrotik_id);

  const secretaryPermMap: Record<string, string> = {
    '/onus': 'can_manage_onu',
    '/acs': 'can_manage_onu',
    '/onu-web': 'can_manage_onu',
    '/topology': 'can_manage_pppoe',
    '/mikrotik': 'can_manage_pppoe',
    '/pppoe': 'can_manage_pppoe',
    '/settings': 'can_manage_settings',
    '/diagnostics': 'can_manage_diagnostics',
  };

  // Módulos habilitados por el super admin para este ISP
  const moduleEnabled = (module?: "onus" | "mikrotik" | "onu_web") => {
    if (!module) return true;
    if (!tenant) return true;
    if (module === "onus") return tenant.enable_onus !== false;
    if (module === "onu_web") return tenant.enable_onu_web !== false;
    return tenant.enable_mikrotik !== false;
  };

  // El super admin usa el panel solo para administrar ISPs
  const superAdminMenu: MenuEntry[] = [
    { icon: Building2, label: "Panel de ISPs", path: "/admin/isps", group: "Administración" },
    { icon: Users, label: "Usuarios", path: "/admin/users", group: "Administración" },
    { icon: UserPlus, label: "Crear usuario", path: "/admin/register-user", group: "Administración" },
    { icon: Mail, label: "Correo (SMTP)", path: "/admin/correo", group: "Administración" },
    { icon: DatabaseBackup, label: "Copias de seguridad", path: "/admin/respaldos", group: "Administración" },
  ];

  const moduleMenuItems = menuItems
    .filter((item) => moduleEnabled(item.module))
    // Permisos por sección definidos para cada ISP
    .filter(
      (item) =>
        item.path === "/dashboard" ||
        // El admin del ISP nunca pierde la administración de su propio ISP
        (isAdmin && (item.section === "usuarios" || item.section === "roles")) ||
        can(item.section)
    );

  const filteredMenuItems = isSuperAdmin
    ? superAdminMenu
    : isSecretary
    ? moduleMenuItems.filter(item => {
        if (item.path === '/dashboard') return true;
        if (!currentPerms) return false;
        const permKey = secretaryPermMap[item.path];
        if (permKey) return currentPerms?.[permKey] === true;
        return false;
      })
    : moduleMenuItems;

  const groups = filteredMenuItems.reduce<Record<string, MenuEntry[]>>((acc, item) => {
    (acc[item.group] ||= []).push(item);
    return acc;
  }, {});

  const handleLogout = async () => {
    await signOut();
    localStorage.removeItem("mikrotik_connected");
    localStorage.removeItem("mikrotik_config");
    localStorage.removeItem("mikrotik_host");
    localStorage.removeItem("mikrotik_version");
    toast.info("Sesión cerrada exitosamente");
    navigate("/login");
  };

  const roleLabel = isSuperAdmin
    ? "Super admin"
    : isSecretary
    ? "Asistente"
    : isReseller
    ? "Reseller"
    : "Operador";

  return (
    <>
      <MobileNav items={filteredMenuItems} showAdmin={!isSecretary && !isReseller} />

      <aside className="hidden md:flex h-screen w-64 fixed left-0 top-0 z-40 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
        {/* Halo de marca */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-56 opacity-60"
          style={{ background: "radial-gradient(120% 70% at 50% 0%, hsl(var(--sidebar-primary) / 0.18), transparent 70%)" }}
          aria-hidden
        />

        {/* Marca */}
        <div className="relative p-4 border-b border-sidebar-border/80 shrink-0">
          <div className="relative group rounded-xl bg-sidebar-accent/40 ring-1 ring-sidebar-border/70 p-2">
            <div className="flex items-center justify-center">
              <img
                src={displayLogo || omnisyncLogo}
                alt={displayName}
                className="h-12 w-auto max-w-full object-contain drop-shadow-[0_0_14px_hsl(var(--sidebar-primary)/0.35)]"
              />
            </div>
            {displayLogo && (
              <button
                onClick={handleRemoveLogo}
                aria-label="Quitar logo"
                className="absolute -top-2 -right-2 w-5 h-5 bg-destructive rounded-full items-center justify-center hidden group-hover:flex"
              >
                <X className="w-3 h-3 text-destructive-foreground" />
              </button>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              aria-label="Cambiar logo"
              className="absolute inset-0 bg-sidebar/80 backdrop-blur-sm items-center justify-center hidden group-hover:flex rounded-xl"
            >
              <ImagePlus className="w-4 h-4 text-sidebar-primary" />
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold truncate text-sidebar-foreground">{displayName}</p>
            <span className="shrink-0 rounded-full bg-sidebar-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-primary">
              {roleLabel}
            </span>
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/50">
            <span className="status-dot text-sidebar-primary" />
            TR-069 · ACS Live
          </p>
        </div>

        {/* Navegación */}
        <nav className="relative flex-1 px-3 py-4 space-y-5 overflow-y-auto">
          {(isSecretary && loadingPermissions) || loadingSections ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-sidebar-primary mx-auto" />
            </div>
          ) : (
            <>
              {Object.entries(groups).map(([group, items]) => (
                <div key={group} className="space-y-1">
                  <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-sidebar-foreground/40">
                    {group}
                  </p>
                  {items.map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      className={({ isActive }) =>
                        cn(
                          "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-smooth overflow-hidden",
                          isActive
                            ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold shadow-[inset_0_1px_0_hsl(var(--sidebar-primary)/0.25)]"
                            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <span
                            className={cn(
                              "absolute left-0 top-1/2 h-6 -translate-y-1/2 rounded-r-full bg-sidebar-primary transition-smooth",
                              isActive ? "w-[3px] opacity-100" : "w-0 opacity-0"
                            )}
                            aria-hidden
                          />
                          <item.icon
                            className={cn(
                              "w-[18px] h-[18px] shrink-0 transition-smooth",
                              isActive ? "text-sidebar-primary" : "group-hover:text-sidebar-primary"
                            )}
                          />
                          <span className="truncate">{item.label}</span>
                        </>
                      )}
                    </NavLink>
                  ))}
                </div>
              ))}

            </>
          )}
        </nav>

        {/* Pie */}
        <div className="relative p-3 border-t border-sidebar-border/80 space-y-2">
          <div className="flex items-center gap-2 rounded-lg bg-sidebar-accent/40 px-3 py-2 ring-1 ring-sidebar-border/60">
            <ShieldCheck className="h-4 w-4 shrink-0 text-sidebar-primary" />
            <span className="min-w-0 flex-1 truncate text-[11px] text-sidebar-foreground/70">
              {user?.email || "Sesión activa"}
            </span>
          </div>
          <ChangePasswordDialog
            trigger={
              <Button
                variant="ghost"
                className="w-full justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60"
              >
                <Lock className="w-4 h-4 mr-3" />
                Cambiar contraseña
              </Button>
            }
          />
          <Button
            variant="ghost"
            className="w-full justify-start text-sidebar-foreground/70 hover:text-destructive hover:bg-destructive/10"
            onClick={handleLogout}
          >
            <LogOut className="w-4 h-4 mr-3" />
            Cerrar sesión
          </Button>

          <p className="pt-1 text-center text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/40">
            Creado por <span className="font-semibold text-sidebar-primary/80">OmniSync</span>
          </p>
        </div>
      </aside>
    </>
  );
};
