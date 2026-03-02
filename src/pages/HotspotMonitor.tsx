import { useState, useEffect } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSystemResources } from "@/hooks/useMikrotikData";
import { getSelectedDevice } from "@/lib/mikrotik";
import omnisyncLogo from "@/assets/omnisync-logo.png";
import {
  LayoutDashboard, Wifi, Ticket, ScrollText, Router,
  ChevronLeft, ChevronRight, Clock, Server
} from "lucide-react";
import { MonitorDashboard } from "@/components/hotspot-monitor/MonitorDashboard";
import { MonitorHotspot } from "@/components/hotspot-monitor/MonitorHotspot";
import { MonitorVouchers } from "@/components/hotspot-monitor/MonitorVouchers";
import { MonitorLog } from "@/components/hotspot-monitor/MonitorLog";

const sections = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "hotspot", label: "Hotspot", icon: Wifi },
  { id: "vouchers", label: "Vouchers", icon: Ticket },
  { id: "log", label: "Log", icon: ScrollText },
];

export default function HotspotMonitor() {
  const [activeSection, setActiveSection] = useState("dashboard");
  const [collapsed, setCollapsed] = useState(false);
  const { data: systemInfo } = useSystemResources();
  const systemData = (systemInfo as any[])?.[0];
  const device = getSelectedDevice();
  const version = systemData?.version?.split(' ')[0] || localStorage.getItem("mikrotik_version") || "v7";

  const [customLogo, setCustomLogo] = useState<string | null>(null);
  useEffect(() => {
    const saved = localStorage.getItem("sidebar_logo");
    if (saved) setCustomLogo(saved);
  }, []);

  const renderContent = () => {
    switch (activeSection) {
      case "dashboard": return <MonitorDashboard />;
      case "hotspot": return <MonitorHotspot />;
      case "vouchers": return <MonitorVouchers />;
      case "log": return <MonitorLog />;
      default: return <MonitorDashboard />;
    }
  };

  return (
    <div className="flex min-h-screen w-full bg-background">
      <Sidebar />
      <div className="flex-1 md:ml-64 flex">
        {/* Internal Sidebar - Omnisync style */}
        <div className={cn(
          "bg-sidebar border-r border-sidebar-border flex flex-col transition-all duration-200 shrink-0",
          collapsed ? "w-14" : "w-52"
        )}>
          {/* Brand header */}
          <div className="p-3 border-b border-sidebar-border">
            <div className="flex items-center justify-center">
              <div className={cn("rounded-full overflow-hidden border border-sidebar-border bg-sidebar-accent/30", collapsed ? "w-8 h-8" : "w-14 h-14")}>
                <img src={customLogo || omnisyncLogo} alt="Logo" className="w-full h-full object-cover" />
              </div>
            </div>
            {!collapsed && (
              <div className="mt-2 text-center">
                <p className="text-xs font-bold text-sidebar-foreground">OMNISYNC</p>
                <p className="text-[9px] text-sidebar-foreground/60">{device?.name || "Sin dispositivo"}</p>
              </div>
            )}
          </div>

          {/* Device info */}
          {!collapsed && (
            <div className="px-3 py-2 border-b border-sidebar-border space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] text-sidebar-foreground/70">
                <Router className="w-3 h-3" />
                <span className="truncate">{device?.host || "—"}</span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-sidebar-foreground/70">
                <Server className="w-3 h-3" />
                <span>RouterOS {version}</span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-sidebar-foreground/70">
                <Clock className="w-3 h-3" />
                <span>{systemData?.uptime || "..."}</span>
              </div>
            </div>
          )}

          {/* Menu items */}
          <nav className="flex-1 p-2 space-y-0.5">
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md transition-colors text-left",
                  activeSection === section.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <section.icon className={cn("shrink-0", collapsed ? "w-5 h-5" : "w-4 h-4")} />
                {!collapsed && <span className="text-xs">{section.label}</span>}
              </button>
            ))}
          </nav>

          {/* Collapse toggle */}
          <div className="p-2 border-t border-sidebar-border">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCollapsed(!collapsed)}
              className="w-full h-7 text-sidebar-foreground/50 hover:text-sidebar-foreground"
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-x-hidden">
          {/* Top bar */}
          <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {sections.find(s => s.id === activeSection)?.icon && (
                (() => {
                  const Icon = sections.find(s => s.id === activeSection)!.icon;
                  return <Icon className="h-4 w-4 text-primary" />;
                })()
              )}
              <h1 className="text-sm font-bold text-foreground">
                {sections.find(s => s.id === activeSection)?.label}
              </h1>
            </div>
            <Badge variant="outline" className="gap-1 text-[10px]">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              En vivo
            </Badge>
          </div>

          {/* Content */}
          <div className="p-4">
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
}
