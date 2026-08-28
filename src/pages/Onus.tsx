import { Sidebar } from "@/components/dashboard/Sidebar";
import SimpleOnuPanel from "@/components/tr069/SimpleOnuPanel";
import { Antenna } from "lucide-react";

const Onus = () => {
  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="p-4 md:p-8 md:ml-64">
        <header className="mb-6 md:mb-8 flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Antenna className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-foreground">Gestión de ONUs</h1>
            <p className="text-muted-foreground">
              Equipos registrados por TR-069: señal óptica, WiFi, PPPoE y acciones remotas.
            </p>
          </div>
        </header>

        <SimpleOnuPanel />
      </div>
    </div>
  );
};

export default Onus;
