import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Users,
  Wifi,
  Activity,
  Settings,
  LogOut,
  Router
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

const menuItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
  { icon: Users, label: "Usuarios Hotspot", path: "/users" },
  { icon: Wifi, label: "Gestión PPP", path: "/ppp" },
  { icon: Activity, label: "Monitor Tráfico", path: "/traffic" },
  { icon: Settings, label: "Configuración", path: "/settings" },
];

export const Sidebar = () => {
  const navigate = useNavigate();
  const host = localStorage.getItem("mikrotik_host") || "";
  const version = localStorage.getItem("mikrotik_version") || "v7";

  const handleLogout = () => {
    localStorage.removeItem("mikrotik_connected");
    toast.info("Desconectado del router");
    navigate("/");
  };

  return (
    <div className="bg-sidebar text-sidebar-foreground h-screen w-64 fixed left-0 top-0 flex flex-col border-r border-sidebar-border">
      <div className="p-6 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-primary flex items-center justify-center">
            <Router className="w-6 h-6 text-primary-foreground" />
          </div>
          <div>
            <h2 className="font-bold text-lg">MikroTik</h2>
            <p className="text-xs text-sidebar-foreground/70">{host}</p>
          </div>
        </div>
        <div className="mt-2 px-2 py-1 bg-sidebar-accent rounded text-xs text-sidebar-accent-foreground">
          RouterOS {version.toUpperCase()}
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {menuItems.map((item) => (
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
      </nav>

      <div className="p-4 border-t border-sidebar-border">
        <Button
          variant="ghost"
          className="w-full justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
          onClick={handleLogout}
        >
          <LogOut className="w-5 h-5 mr-3" />
          Desconectar
        </Button>
      </div>
    </div>
  );
};
