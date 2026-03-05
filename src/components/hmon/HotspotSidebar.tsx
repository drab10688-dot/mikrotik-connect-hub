import { cn } from "@/lib/utils";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  LayoutDashboard, Users, UserPlus, Ticket, UserCircle, Layers, Plus,
  MonitorSmartphone, Globe, Link2, Cookie, Printer, ScrollText, FileText,
  Terminal, Timer, Power, PowerOff, Network, Activity, BarChart3, Settings,
  Lock, Shield, Upload, ChevronDown, ArrowLeft, Wifi
} from "lucide-react";
import { useState } from "react";

interface MenuItem {
  icon: any;
  label: string;
  section: string;
}

interface MenuGroup {
  icon: any;
  label: string;
  children: MenuItem[];
  defaultOpen?: boolean;
}

type MenuEntry = MenuItem | MenuGroup;

const isGroup = (entry: MenuEntry): entry is MenuGroup => "children" in entry;

const menuStructure: MenuEntry[] = [
  { icon: LayoutDashboard, label: "Tablero", section: "dashboard" },
  {
    icon: Users, label: "Usuarios", defaultOpen: true,
    children: [
      { icon: Users, label: "Lista de Usuarios", section: "users" },
      { icon: UserPlus, label: "Añadir Usuario", section: "add-user" },
      { icon: Ticket, label: "Generar Voucher", section: "generate-voucher" },
      { icon: UserCircle, label: "Perfil del Usuario", section: "user-profile" },
    ],
  },
  {
    icon: Layers, label: "Perfiles",
    children: [
      { icon: Layers, label: "Lista de Perfiles", section: "profiles" },
      { icon: Plus, label: "Añadir Perfil", section: "add-profile" },
    ],
  },
  { icon: MonitorSmartphone, label: "Usuarios en Línea", section: "online" },
  { icon: Globe, label: "Hosts", section: "hosts" },
  { icon: Link2, label: "IP Bindings", section: "ip-bindings" },
  { icon: Cookie, label: "Cookies", section: "cookies" },
  { icon: Ticket, label: "Vouchers", section: "vouchers" },
  { icon: Printer, label: "Impresión rápida", section: "quick-print" },
  {
    icon: ScrollText, label: "Log",
    children: [
      { icon: ScrollText, label: "Hotspot Log", section: "hotspot-log" },
      { icon: FileText, label: "Usuarios Log", section: "users-log" },
      { icon: Terminal, label: "Sistema Log", section: "system-log" },
    ],
  },
  {
    icon: Settings, label: "Sistema",
    children: [
      { icon: Timer, label: "Programador", section: "scheduler" },
      { icon: Power, label: "Reiniciar", section: "reboot" },
      { icon: PowerOff, label: "Apagar", section: "shutdown" },
    ],
  },
  { icon: Network, label: "Arrendamientos DHCP", section: "dhcp-leases" },
  { icon: Activity, label: "Tráfico Monitor", section: "traffic" },
  { icon: BarChart3, label: "Reporte", section: "report" },
  { icon: Settings, label: "Ajustes", section: "settings" },
  { icon: Lock, label: "Config. de Sesión", section: "session-config" },
  { icon: Shield, label: "Config. de Admin", section: "admin-config" },
  { icon: Upload, label: "Cargar Logo", section: "upload-logo" },
];

export function HotspotSidebar() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const currentSection = searchParams.get("section") || "dashboard";
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(["Usuarios"]));

  const goTo = (section: string) => setSearchParams({ section });

  const toggleGroup = (label: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  };

  const isActiveGroup = (group: MenuGroup) =>
    group.children.some(c => c.section === currentSection);

  return (
    <div className="w-56 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col h-full shrink-0 hidden md:flex">
      {/* Header */}
      <div className="p-3 border-b border-sidebar-border">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-xs text-sidebar-foreground/70 hover:text-sidebar-foreground"
          onClick={() => navigate("/dashboard")}
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-2" />
          Volver al Panel
        </Button>
        <div className="flex items-center gap-2 mt-2 px-2">
          <Wifi className="h-4 w-4 text-primary" />
          <span className="font-bold text-sm">Hotspot Monitor</span>
        </div>
      </div>

      {/* Menu */}
      <ScrollArea className="flex-1">
        <nav className="p-2 space-y-0.5">
          {menuStructure.map((entry, i) => {
            if (isGroup(entry)) {
              const isOpen = openGroups.has(entry.label) || isActiveGroup(entry);
              return (
                <Collapsible key={i} open={isOpen} onOpenChange={() => toggleGroup(entry.label)}>
                  <CollapsibleTrigger className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs transition-colors",
                    isActiveGroup(entry)
                      ? "text-sidebar-foreground font-medium"
                      : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/40"
                  )}>
                    <entry.icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="flex-1 text-left">{entry.label}</span>
                    <ChevronDown className={cn("h-3 w-3 transition-transform", isOpen && "rotate-180")} />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pl-4 space-y-0.5 mt-0.5">
                    {entry.children.map(child => (
                      <button
                        key={child.section}
                        onClick={() => goTo(child.section)}
                        className={cn(
                          "w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-[11px] transition-colors",
                          currentSection === child.section
                            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                            : "text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/30"
                        )}
                      >
                        <child.icon className="h-3 w-3 shrink-0" />
                        <span>{child.label}</span>
                      </button>
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              );
            }

            return (
              <button
                key={entry.section}
                onClick={() => goTo(entry.section)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs transition-colors",
                  currentSection === entry.section
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/40"
                )}
              >
                <entry.icon className="h-3.5 w-3.5 shrink-0" />
                <span>{entry.label}</span>
              </button>
            );
          })}
        </nav>
      </ScrollArea>
    </div>
  );
}
