import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import omnisyncLogo from "@/assets/omnisync-logo.png";
import {
  LayoutDashboard, Users, Wifi, Activity, Settings, LogOut, Router,
  ShieldCheck, BarChart3, Ticket, ListChecks, Gauge, Database,
  UserPlus, ImagePlus, X, CreditCard, Monitor, PiggyBank, ScrollText,
  Server, Radio, Antenna
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AdminMenu } from "./AdminMenu";
import { MobileNav } from "./MobileNav";

import { useAuth } from "@/hooks/useAuth";
import { useSecretaryPermissions } from "@/hooks/useSecretaryPermissions";
import { useState, useEffect, useRef } from "react";
import { Receipt } from "lucide-react";


const menuItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
  { icon: Antenna, label: "Gestión de ONUs", path: "/onus" },
  { icon: Radio, label: "Credenciales y VPN", path: "/acs" },
  { icon: Settings, label: "Configuración", path: "/settings" },
  { icon: Activity, label: "Diagnóstico API", path: "/diagnostics" },
];

export const Sidebar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut, isSecretary, isReseller } = useAuth();
  const { assignments: secretaryAssignments, isLoading: loadingPermissions } = useSecretaryPermissions();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [customLogo, setCustomLogo] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState<string>("Omnisync");

  const displayLogo = customLogo;
  const displayName = businessName;


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

  // Get current device's secretary permissions (device-specific or global assignment)
  const currentDeviceId = localStorage.getItem("mikrotik_device_id") || "";
  const currentPerms =
    secretaryAssignments?.find((a: any) => a.mikrotik_id === currentDeviceId) ||
    secretaryAssignments?.find((a: any) => !a.mikrotik_id);

  const secretaryPermMap: Record<string, string> = {
    '/onus': 'can_manage_onu',
    '/acs': 'can_manage_onu',
    '/settings': 'can_manage_settings',
    '/diagnostics': 'can_manage_diagnostics',
  };

  const filteredMenuItems = isSecretary
    ? menuItems.filter(item => {
        // Always show dashboard
        if (item.path === '/dashboard') return true;
        if (!currentPerms) return false;
        const permKey = secretaryPermMap[item.path];
        if (permKey) return currentPerms?.[permKey] === true;
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
    <>
    <MobileNav items={filteredMenuItems} showAdmin={!isSecretary && !isReseller} />
    <div className="bg-sidebar text-sidebar-foreground h-screen w-64 fixed left-0 top-0 z-40 flex-col border-r border-sidebar-border hidden md:flex">

      {/* Logo section */}
      <div className="p-3 border-b border-sidebar-border shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative group shrink-0">
            {displayLogo ? (
              <div className="w-12 h-12 rounded-lg overflow-hidden relative flex items-center justify-center">
                <img src={displayLogo} alt={displayName} className="w-full h-full object-contain" />
                <button onClick={handleRemoveLogo} className="absolute top-0 right-0 w-4 h-4 bg-destructive rounded-full items-center justify-center hidden group-hover:flex">
                  <X className="w-2.5 h-2.5 text-destructive-foreground" />
                </button>
              </div>
            ) : (
              <div className="w-12 h-12 rounded-lg overflow-hidden flex items-center justify-center">
                <img src={omnisyncLogo} alt={displayName} className="w-full h-full object-contain" />
              </div>
            )}
            <button onClick={() => fileInputRef.current?.click()} className="absolute inset-0 bg-black/50 rounded-full items-center justify-center hidden group-hover:flex">
              <ImagePlus className="w-4 h-4 text-white" />
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{displayName}</p>
            <p className="text-[11px] text-sidebar-foreground/60 truncate">OmniACS · TR-069 / ACS</p>
          </div>
        </div>
      </div>



      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {isSecretary && loadingPermissions ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
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




            {!isSecretary && !isReseller && (
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
    </>
  );

};
