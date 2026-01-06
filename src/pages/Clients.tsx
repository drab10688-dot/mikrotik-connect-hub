import { Sidebar } from "@/components/dashboard/Sidebar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useValidatedDevice } from "@/hooks/useValidatedDevice";
import { ClientsManager } from "@/components/clients/ClientsManager";
import { saveSelectedDevice, MikroTikDeviceConfig } from "@/lib/mikrotik";

export default function Clients() {
  const { device, availableDevices, isValidating } = useValidatedDevice();

  const handleDeviceChange = (deviceId: string) => {
    const selected = availableDevices.find((d: any) => d.id === deviceId);
    if (selected) {
      const config: MikroTikDeviceConfig = {
        id: selected.id,
        name: selected.name,
        host: selected.host,
        port: selected.port,
        version: selected.version,
      };
      saveSelectedDevice(config);
      window.location.reload();
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="p-4 md:p-8 md:ml-64 w-full">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6 md:mb-8">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-foreground">Gestión de Clientes</h1>
            <p className="text-muted-foreground">
              Administra la información de tus clientes registrados
            </p>
          </div>
        </div>

        <div className="mb-6">
          <Select 
            value={device?.id || ""} 
            onValueChange={handleDeviceChange}
          >
            <SelectTrigger className="w-full md:w-[300px]">
              <SelectValue placeholder="Seleccionar dispositivo MikroTik" />
            </SelectTrigger>
            <SelectContent>
              {availableDevices.map((d: any) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name} ({d.host})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <ClientsManager mikrotikId={device?.id || null} mikrotikVersion={device?.version} />
      </div>
    </div>
  );
}
