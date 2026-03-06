import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import omnisyncLogo from "@/assets/omnisync-logo.png";
import {
  LayoutDashboard, Users, Wifi, Activity, Settings, LogOut, Router,
  ShieldCheck, BarChart3, Ticket, ListChecks, Gauge, Database,
  UserPlus, ImagePlus, X, CreditCard, Monitor, PiggyBank, ScrollText,
  Server, Radio
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { useSystemResources } from "@/hooks/useMikrotikData";
import { AdminMenu } from "./AdminMenu";
import { useAuth } from "@/hooks/useAuth";
import { useUserDeviceAccess } from "@/hooks/useUserDeviceAccess";
import { useSecretaryPermissions } from "@/hooks/useSecretaryPermissions";
import { Shield } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { Receipt } from "lucide-react";


const menuItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
  { icon: Server, label: "Servicios VPS", path: "/vps-services" },
  { icon: Users, label: "Clientes", path: "/clients" },
  { icon: Wifi, label: "Gestión PPPoE", path: "/ppp" },
  { icon: ListChecks, label: "Address List", path: "/address-list" },
  { icon: Gauge, label: "Simple Queues", path: "/simple-queues" },
  { icon: CreditCard, label: "Pagos", path: "/payment-manager" },
  { icon: Receipt, label: "Facturación", path: "/payments" },
  { icon: BarChart3, label: "Reportes", path: "/reports" },
  { icon: Database, label: "Backup/Restore", path: "/backup" },
  { icon: Monitor, label: "Hotspot Monitor", path: "/hotspot-monitor" },
  
  { icon: Settings, label: "Configuración", path: "/settings" },
  { icon: Activity, label: "Diagnóstico API", path: "/diagnostics" },
];

export const Sidebar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut, isSecretary } = useAuth();
  const { hasDeviceAccess, isLoading: loadingAccess } = useUserDeviceAccess();
  const { assignments: secretaryAssignments } = useSecretaryPermissions();
  const host = localStorage.getItem("mikrotik_host") || "";
  const { data: systemInfo } = useSystemResources();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [customLogo, setCustomLogo] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState<string>("Omnisync");

  const systemData = (systemInfo as any[])?.[0];
  const version = systemData?.version?.split(' ')[0] || localStorage.getItem("mikrotik_version") || "v7";

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

  // Get current device's secretary permissions
  const currentDeviceId = localStorage.getItem("mikrotik_device_id") || "";
  const currentPerms = secretaryAssignments?.find((a: any) => a.mikrotik_id === currentDeviceId);

  const secretaryPermMap: Record<string, string> = {
    '/clients': 'can_manage_clients',
    '/payment-manager': 'can_manage_payments',
    '/payments': 'can_manage_billing',
    '/reports': 'can_manage_reports',
    '/address-list': 'can_manage_address_list',
    '/backup': 'can_manage_backup',
    '/vps-services': 'can_manage_vps_services',
  };

  const filteredMenuItems = isSecretary
    ? menuItems.filter(item => {
        // Always show dashboard
        if (item.path === '/dashboard') return true;
        // PPPoE and Queues controlled by their own flags
        if (item.path === '/ppp') return currentPerms?.can_manage_pppoe !== false;
        if (item.path === '/simple-queues') return currentPerms?.can_manage_queues !== false;
        // Module permissions
        const permKey = secretaryPermMap[item.path];
        if (permKey) return currentPerms?.[permKey] !== false;
        return false;
      })
    : menuItems;

  const handleLogout = async () => {
    await signOut();
    localStorage.removeItem("mikrotik_connected");
    localStorage.removeItem("mikrotik_config");
    localStorage.removeItem("mikrotik_host");
    localStorage.removeItem("mikrotik_version");
    toast.info("Sesión cerrada exitosamente");
    navigate("/login");
  };

  return (
    <div className="bg-sidebar text-sidebar-foreground h-screen w-64 fixed left-0 top-0 z-40 flex flex-col border-r border-sidebar-border hidden md:flex">
      {/* Logo section */}
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex justify-center">
          <div className="relative group">
            {customLogo ? (
              <div className="w-28 h-28 rounded-full overflow-hidden relative bg-sidebar-accent/30 border-2 border-sidebar-border">
                <img src={customLogo} alt="Logo" className="w-full h-full object-cover" />
                <button onClick={handleRemoveLogo} className="absolute top-0 right-0 w-6 h-6 bg-destructive rounded-full items-center justify-center hidden group-hover:flex">
                  <X className="w-3 h-3 text-destructive-foreground" />
                </button>
              </div>
            ) : (
              <div className="w-28 h-28 rounded-full overflow-hidden bg-sidebar-accent/30 border-2 border-sidebar-border flex items-center justify-center">
                <img src={omnisyncLogo} alt="Omnisync" className="w-full h-full object-cover" />
              </div>
            )}
            <button onClick={() => fileInputRef.current?.click()} className="absolute inset-0 bg-black/50 rounded-full items-center justify-center hidden group-hover:flex">
              <ImagePlus className="w-6 h-6 text-white" />
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-sidebar-foreground/70">
            <Router className="w-4 h-4" />
            <span>{host}</span>
          </div>
          <NotificationCenter />
        </div>
        <div className="mt-2 px-2 py-1 bg-sidebar-accent rounded text-xs text-sidebar-accent-foreground text-center">
          RouterOS {version}
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {loadingAccess ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          </div>
        ) : !hasDeviceAccess ? (
          <div className="px-4 py-6 space-y-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Shield className="w-5 h-5" />
              <span className="text-sm font-medium">Sin acceso</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              No tienes dispositivos MikroTik asignados. Contacta al administrador.
            </p>
          </div>
        ) : (
          <>
            {filteredMenuItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 px-4 py-3 rounded-lg transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  )
                }
              >
                <item.icon className="w-5 h-5" />
                <span>{item.label}</span>
              </NavLink>
            ))}




            {!isSecretary && (
              <div className="pt-4 mt-4 border-t border-sidebar-border">
                <AdminMenu />
              </div>
            )}
          </>
        )}
      </nav>

      <div className="p-4 border-t border-sidebar-border">
        <Button
          variant="ghost"
          className="w-full justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
          onClick={handleLogout}
        >
          <LogOut className="w-5 h-5 mr-3" />
          Cerrar Sesión
        </Button>
      </div>
    </div>
  );
};
