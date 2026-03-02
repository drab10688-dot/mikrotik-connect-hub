import { Sidebar } from "@/components/dashboard/Sidebar";
import { VpsServicesCard } from "@/components/dashboard/VpsServicesCard";
import { useValidatedDevice } from "@/hooks/useValidatedDevice";

export default function VpsServices() {
  const { device } = useValidatedDevice(true);
  const mikrotikId = device?.id || localStorage.getItem("mikrotik_device_id");

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="p-4 md:p-8 md:ml-64 space-y-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Servicios VPS</h1>
          <p className="text-muted-foreground">
            Acceso directo a daloRADIUS, PHPNuxBill y configuración de Cloudflare.
          </p>
        </div>

        <VpsServicesCard mikrotikId={mikrotikId} />
      </div>
    </div>
  );
}
