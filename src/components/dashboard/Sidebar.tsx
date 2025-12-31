import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Users,
  Wifi,
  Activity,
  Settings,
  LogOut,
  Router,
  ShieldCheck,
  BarChart3,
  Ticket,
  ListChecks,
  Gauge,
  Database,
  UserPlus,
  ImagePlus,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { useSystemResources } from "@/hooks/useMikrotikData";
import { AdminMenu } from "./AdminMenu";
import { useAuth } from "@/hooks/useAuth";
import { useUserDeviceAccess } from "@/hooks/useUserDeviceAccess";
import { Shield } from "lucide-react";
import { useState, useEffect, useRef } from "react";

const menuItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
  { icon: UserPlus, label: "Registro ISP", path: "/isp-registry" },
  { icon: Users, label: "Usuarios Hotspot", path: "/users" },
  { icon: Wifi, label: "Gestión PPPoE", path: "/ppp" },
  { icon: Activity, label: "Vouchers", path: "/voucher-inventory" },
  { icon: Ticket, label: "Perfiles Hotspot", path: "/hotspot-profiles" },
  { icon: ShieldCheck, label: "Perfiles PPPoE", path: "/profiles" },
  { icon: ListChecks, label: "Address List", path: "/address-list" },
  { icon: Gauge, label: "Simple Queues", path: "/simple-queues" },
  { icon: BarChart3, label: "Reportes", path: "/reports" },
  { icon: Database, label: "Backup/Restore", path: "/backup" },
  { icon: Settings, label: "Configuración", path: "/settings" },
];

export const Sidebar = () => {
  const navigate = useNavigate();
  const { signOut, isSecretary } = useAuth();
  const { hasDeviceAccess, isLoading: loadingAccess } = useUserDeviceAccess();
  const host = localStorage.getItem("mikrotik_host") || "";
  const { data: systemInfo } = useSystemResources();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [customLogo, setCustomLogo] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState<string>("MikroTik");
  
  const systemData = (systemInfo as any[])?.[0];
  const version = systemData?.version?.split(' ')[0] || localStorage.getItem("mikrotik_version") || "v7";

  // Load saved logo and business name from localStorage
  useEffect(() => {
    const savedLogo = localStorage.getItem("sidebar_logo");
    const savedName = localStorage.getItem("sidebar_business_name");
    if (savedLogo) setCustomLogo(savedLogo);
    if (savedName) setBusinessName(savedName);
  }, []);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 500000) {
        toast.error("La imagen debe ser menor a 500KB");
        return;
      }
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

  // Filtrar menú para secretarias - Dashboard, PPPoE y Queues
  const filteredMenuItems = isSecretary 
    ? menuItems.filter(item => 
        item.path === '/dashboard' || item.path === '/ppp' || item.path === '/simple-queues'
      )
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
      <div className="p-6 border-b border-sidebar-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Logo container with upload option */}
            <div className="relative group">
              {customLogo ? (
                <div className="w-10 h-10 rounded-lg overflow-hidden relative">
                  <img src={customLogo} alt="Logo" className="w-full h-full object-cover" />
                  <button
                    onClick={handleRemoveLogo}
                    className="absolute -top-1 -right-1 w-4 h-4 bg-destructive rounded-full items-center justify-center hidden group-hover:flex"
                  >
                    <X className="w-3 h-3 text-destructive-foreground" />
                  </button>
                </div>
              ) : (
                <div className="w-10 h-10 rounded-lg bg-gradient-primary flex items-center justify-center">
                  <Router className="w-6 h-6 text-primary-foreground" />
                </div>
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 bg-black/50 rounded-lg items-center justify-center hidden group-hover:flex"
              >
                <ImagePlus className="w-4 h-4 text-white" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                className="hidden"
              />
            </div>
            <div>
              <h2 className="font-bold text-lg">{businessName}</h2>
              <p className="text-xs text-sidebar-foreground/70">{host}</p>
            </div>
          </div>
          <NotificationCenter />
        </div>
        <div className="mt-2 px-2 py-1 bg-sidebar-accent rounded text-xs text-sidebar-accent-foreground">
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
