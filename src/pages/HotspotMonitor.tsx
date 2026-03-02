import { Sidebar } from "@/components/dashboard/Sidebar";
import { Badge } from "@/components/ui/badge";
import { useSearchParams } from "react-router-dom";
import { MonitorDashboard } from "@/components/hotspot-monitor/MonitorDashboard";
import { MonitorHotspot } from "@/components/hotspot-monitor/MonitorHotspot";
import { MonitorVouchers } from "@/components/hotspot-monitor/MonitorVouchers";
import { MonitorLog } from "@/components/hotspot-monitor/MonitorLog";
import { MonitorAccounting } from "@/components/hotspot-monitor/MonitorAccounting";
import { LayoutDashboard, Wifi, Ticket, ScrollText, PiggyBank } from "lucide-react";

const sectionMeta: Record<string, { label: string; icon: any }> = {
  dashboard: { label: "Dashboard", icon: LayoutDashboard },
  hotspot: { label: "Hotspot", icon: Wifi },
  vouchers: { label: "Vouchers", icon: Ticket },
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
      case "dashboard": return <MonitorDashboard />;
      case "hotspot": return <MonitorHotspot />;
      case "vouchers": return <MonitorVouchers />;
      case "log": return <MonitorLog />;
      case "contabilidad": return <MonitorAccounting />;
      default: return <MonitorDashboard />;
    }
  };

  return (
    <div className="flex min-h-screen w-full bg-background">
      <Sidebar />
      <div className="flex-1 md:ml-64 overflow-x-hidden">
        {/* Top bar */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-primary" />
            <h1 className="text-sm font-bold text-foreground">{meta.label}</h1>
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
