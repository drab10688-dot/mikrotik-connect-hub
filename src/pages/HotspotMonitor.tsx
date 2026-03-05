import { useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { HotspotSidebar } from "@/components/hmon/HotspotSidebar";
import { HmonDashboard } from "@/components/hmon/HmonDashboard";
import { HmonUsers } from "@/components/hmon/HmonUsers";
import { HmonAddUser } from "@/components/hmon/HmonAddUser";
import { HmonProfiles } from "@/components/hmon/HmonProfiles";
import { HmonOnlineUsers } from "@/components/hmon/HmonOnlineUsers";
import { HmonHosts } from "@/components/hmon/HmonHosts";
import { HmonIpBindings } from "@/components/hmon/HmonIpBindings";
import { HmonCookies } from "@/components/hmon/HmonCookies";
import { HmonVouchers } from "@/components/hmon/HmonVouchers";
import { HmonQuickPrint } from "@/components/hmon/HmonQuickPrint";
import { HmonLog } from "@/components/hmon/HmonLog";
import { HmonDhcpLeases } from "@/components/hmon/HmonDhcpLeases";
import { HmonTraffic } from "@/components/hmon/HmonTraffic";
import { HmonAccounting } from "@/components/hmon/HmonAccounting";
import { HmonSystem } from "@/components/hmon/HmonSystem";
import { HmonSettings } from "@/components/hmon/HmonSettings";

const sectionLabels: Record<string, string> = {
  dashboard: "Tablero",
  users: "Lista de Usuarios",
  "add-user": "Añadir Usuario",
  "generate-voucher": "Generar Voucher",
  "user-profile": "Perfil del Usuario",
  profiles: "Lista de Perfiles",
  "add-profile": "Añadir Perfil",
  online: "Usuarios en Línea",
  hosts: "Hosts",
  "ip-bindings": "IP Bindings",
  cookies: "Cookies",
  vouchers: "Vouchers",
  "quick-print": "Impresión Rápida",
  "hotspot-log": "Hotspot Log",
  "users-log": "Usuarios Log",
  "system-log": "Sistema Log",
  scheduler: "Programador",
  reboot: "Reiniciar",
  shutdown: "Apagar",
  "dhcp-leases": "Arrendamientos DHCP",
  traffic: "Tráfico Monitor",
  report: "Reporte",
  settings: "Ajustes",
  "session-config": "Config. de Sesión",
  "admin-config": "Config. de Admin",
  "upload-logo": "Cargar Logo",
};

export default function HotspotMonitor() {
  const [searchParams] = useSearchParams();
  const section = searchParams.get("section") || "dashboard";
  const label = sectionLabels[section] || "Tablero";

  const renderContent = () => {
    switch (section) {
      case "dashboard": return <HmonDashboard />;
      case "users": return <HmonUsers />;
      case "add-user": return <HmonAddUser />;
      case "generate-voucher": return <HmonVouchers />;
      case "user-profile": return <HmonUsers />;
      case "profiles": return <HmonProfiles />;
      case "add-profile": return <HmonProfiles />;
      case "online": return <HmonOnlineUsers />;
      case "hosts": return <HmonHosts />;
      case "ip-bindings": return <HmonIpBindings />;
      case "cookies": return <HmonCookies />;
      case "vouchers": return <HmonVouchers />;
      case "quick-print": return <HmonQuickPrint />;
      case "hotspot-log":
      case "users-log":
      case "system-log":
        return <HmonLog />;
      case "scheduler":
      case "reboot":
      case "shutdown":
        return <HmonSystem section={section} />;
      case "dhcp-leases": return <HmonDhcpLeases />;
      case "traffic": return <HmonTraffic />;
      case "report": return <HmonAccounting />;
      case "settings":
      case "session-config":
      case "admin-config":
      case "upload-logo":
        return <HmonSettings section={section} />;
      default: return <HmonDashboard />;
    }
  };

  return (
    <div className="flex min-h-screen w-full bg-background">
      <HotspotSidebar />
      <div className="flex-1 overflow-x-hidden">
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-2 flex items-center justify-between">
          <h1 className="text-sm font-bold text-foreground">HMON • {label}</h1>
          <Badge variant="outline" className="gap-1 text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            En vivo
          </Badge>
        </div>
        <div className="p-4">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
