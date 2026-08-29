import { NavLink, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import omnisyncBrand from "@/assets/omnisync-brand.png.asset.json";
const omnisyncLogo = omnisyncBrand.url;
import { Menu, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { AdminMenu } from "./AdminMenu";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

type MenuItem = { icon: React.ComponentType<{ className?: string }>; label: string; path: string };

interface MobileNavProps {
  items: MenuItem[];
  showAdmin: boolean;
}

export const MobileNav = ({ items, showAdmin }: MobileNavProps) => {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [logo, setLogo] = useState<string | null>(null);
  const [name, setName] = useState("Omnisync");

  useEffect(() => {
    const savedLogo = localStorage.getItem("sidebar_logo");
    const savedName = localStorage.getItem("sidebar_business_name");
    if (savedLogo) setLogo(savedLogo);
    if (savedName) setName(savedName);
  }, []);

  const handleLogout = async () => {
    await signOut();
    localStorage.removeItem("mikrotik_connected");
    localStorage.removeItem("mikrotik_config");
    toast.info("Sesión cerrada exitosamente");
    navigate("/login");
  };

  return (
    <header className="md:hidden fixed top-0 left-0 right-0 z-50 h-14 flex items-center justify-between gap-2 px-3 bg-sidebar text-sidebar-foreground border-b border-sidebar-border">
      <div className="flex items-center gap-2 min-w-0">
        <img
          src={logo ?? omnisyncLogo}
          alt={name}
          className="w-9 h-9 rounded-lg object-contain shrink-0"
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight truncate">{name}</p>
          <p className="text-[10px] text-sidebar-foreground/60 truncate">OmniACS · TR-069</p>
        </div>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Abrir menú" className="text-sidebar-foreground">
            <Menu className="w-6 h-6" />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="right"
          className="w-[85vw] max-w-xs p-0 bg-sidebar text-sidebar-foreground border-sidebar-border"
        >
          <nav className="flex flex-col h-full">
            <div className="p-4 border-b border-sidebar-border">
              <p className="text-sm font-semibold">{name}</p>
              <p className="text-[11px] text-sidebar-foreground/60">Panel de gestión</p>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 px-4 py-3 rounded-lg text-base transition-colors",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50"
                    )
                  }
                >
                  <item.icon className="w-5 h-5" />
                  <span>{item.label}</span>
                </NavLink>
              ))}

              {showAdmin && (
                <div className="pt-3 mt-3 border-t border-sidebar-border" onClick={() => setOpen(false)}>
                  <AdminMenu />
                </div>
              )}
            </div>
            <div className="p-3 border-t border-sidebar-border">
              <Button
                variant="ghost"
                className="w-full justify-start text-sidebar-foreground/70 hover:bg-sidebar-accent/50"
                onClick={handleLogout}
              >
                <LogOut className="w-5 h-5 mr-3" />
                Cerrar Sesión
              </Button>
            </div>
          </nav>
        </SheetContent>
      </Sheet>
    </header>
  );
};
