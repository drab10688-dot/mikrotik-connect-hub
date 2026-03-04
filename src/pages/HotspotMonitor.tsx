import { Sidebar } from "@/components/dashboard/Sidebar";
import { Badge } from "@/components/ui/badge";
import { useSearchParams } from "react-router-dom";
import { HmonDashboard } from "@/components/hmon/HmonDashboard";
import { HmonUsers } from "@/components/hmon/HmonUsers";
import { HmonVouchers } from "@/components/hmon/HmonVouchers";
import { HmonProfiles } from "@/components/hmon/HmonProfiles";
import { HmonLog } from "@/components/hmon/HmonLog";
import { HmonAccounting } from "@/components/hmon/HmonAccounting";
import { LayoutDashboard, Wifi, Ticket, ScrollText, PiggyBank, Layers } from "lucide-react";

const sectionMeta: Record<string, { label: string; icon: any }> = {
  dashboard: { label: "Dashboard", icon: LayoutDashboard },
  usuarios: { label: "Usuarios", icon: Wifi },
  vouchers: { label: "Vouchers", icon: Ticket },
  perfiles: { label: "Perfiles", icon: Layers },
  log: { label: "Log", icon: ScrollText },
  contabilidad: { label: "Contabilidad", icon: PiggyBank },
};

export default function HotspotMonitor() {
  const [searchParams] = useSearchParams();
  const section = searchParams.get("section") || "dashboard";
  const meta = sectionMeta[section] || sectionMeta.dashboard;
  const Icon = meta.icon;

  const renderContent = () => {
    switch (section) {
      case "dashboard": return <HmonDashboard />;
      case "usuarios": return <HmonUsers />;
      case "vouchers": return <HmonVouchers />;
      case "perfiles": return <HmonProfiles />;
      case "log": return <HmonLog />;
      case "contabilidad": return <HmonAccounting />;
      default: return <HmonDashboard />;
    }
  };

  return (
    <div className="flex min-h-screen w-full bg-background">
      <Sidebar />
      <div className="flex-1 md:ml-64 overflow-x-hidden">
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-primary" />
            <h1 className="text-sm font-bold text-foreground">HMON • {meta.label}</h1>
          </div>
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
