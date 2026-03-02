import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { devicesApi, secretariesApi, apiGet } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { toast } from "sonner";
import { saveSelectedDevice, cleanupLegacyStorage, clearSelectedDevice } from "@/lib/mikrotik";
import { Router, Wifi } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { AddDeviceDialog } from "@/components/settings/AddDeviceDialog";
import { EditDeviceDialog } from "@/components/settings/EditDeviceDialog";
import { CloudflareConfig } from "@/components/settings/CloudflareConfig";
import { VpsDockerManager } from "@/components/settings/VpsDockerManager";

export default function Settings() {
  const navigate = useNavigate();
  const { user, isSuperAdmin, isAdmin, isSecretary } = useAuth();
  const [selectedDevice, setSelectedDevice] = useState<string>("");

  useEffect(() => { cleanupLegacyStorage(); }, []);

  const { data: devices, isLoading } = useQuery({
    queryKey: ['mikrotik-devices-select', user?.id, isSecretary],
    queryFn: async () => {
      if (isSecretary) {
        const assignments = await secretariesApi.myAssignments();
        return assignments.map((a: any) => a.mikrotik_devices || a.device).filter((d: any) => d && d.status === 'active');
      }
      const allDevices = await devicesApi.list();
      if (isSuperAdmin) return allDevices.filter((d: any) => d.status === 'active');
      if (isAdmin) return allDevices.filter((d: any) => d.status === 'active');
      return allDevices.filter((d: any) => d.created_by === user?.id && ['active', 'pending'].includes(d.status));
    },
    enabled: !!user,
  });

  useEffect(() => {
    if (isLoading || !devices) return;
    const storedDeviceId = localStorage.getItem("mikrotik_device_id");
    if (storedDeviceId) {
      const hasAccess = devices.some((d: any) => d.id === storedDeviceId);
      if (!hasAccess) { clearSelectedDevice(); toast.info("Selecciona un dispositivo disponible"); }
    }
  }, [devices, isLoading]);

  useEffect(() => {
    if (isLoading || !devices) return;
    const activeDevices = devices.filter((d: any) => d.status === 'active');
    if (activeDevices.length === 1 && !selectedDevice) setSelectedDevice(activeDevices[0].id);
  }, [devices, isLoading, selectedDevice]);

  const handleConnect = () => {
    if (!selectedDevice) { toast.error("Selecciona un dispositivo MikroTik"); return; }
    const device = devices?.find((d: any) => d.id === selectedDevice);
    if (!device) { toast.error("Dispositivo no encontrado"); return; }
    if (device.status !== 'active') { toast.error("Dispositivo no disponible"); return; }

    saveSelectedDevice({ id: device.id, name: device.name, host: device.host, port: device.port.toString(), version: device.version });
    toast.success(`Conectado a ${device.name}`);
    navigate("/dashboard");
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 p-4 md:p-8 md:ml-64">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <div><h1 className="text-3xl font-bold">Configuración</h1><p className="text-muted-foreground">Selecciona el dispositivo MikroTik</p></div>
            {!isAdmin && !isSecretary && <AddDeviceDialog />}
          </div>
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10"><Router className="h-6 w-6 text-primary" /></div>
                <div><CardTitle>Dispositivo MikroTik</CardTitle><CardDescription>{isSuperAdmin ? 'Selecciona cualquier router para gestionar' : 'Selecciona uno de tus routers'}</CardDescription></div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoading ? <div className="text-center py-8">Cargando dispositivos...</div>
              : !devices || devices.length === 0 ? (
                <div className="text-center py-8"><Wifi className="h-12 w-12 mx-auto mb-4 opacity-50" /><p className="text-muted-foreground">No hay dispositivos disponibles</p></div>
              ) : (
                <>
                  <Select value={selectedDevice} onValueChange={setSelectedDevice}>
                    <SelectTrigger><SelectValue placeholder="Selecciona un dispositivo" /></SelectTrigger>
                    <SelectContent>{devices.map((device: any) => (
                      <SelectItem key={device.id} value={device.id} disabled={device.status !== 'active'}>
                        {device.name} ({device.host}){device.status === 'pending' && ' - 🕐 Pendiente'}
                      </SelectItem>
                    ))}</SelectContent>
                  </Select>
                  {selectedDevice && (() => {
                    const device = devices.find((d: any) => d.id === selectedDevice);
                    return device ? (
                      <div className="p-4 bg-muted rounded-lg space-y-2">
                        <div className="flex items-center justify-between mb-3 pb-2 border-b"><span className="text-sm font-medium">Información del Dispositivo</span><EditDeviceDialog device={device} /></div>
                        <div className="flex justify-between text-sm"><span className="text-muted-foreground">Host:</span><span className="font-medium">{device.host}</span></div>
                        <div className="flex justify-between text-sm"><span className="text-muted-foreground">Puerto:</span><span className="font-medium">{device.port}</span></div>
                        <div className="flex justify-between text-sm"><span className="text-muted-foreground">Versión:</span><span className="font-medium">{device.version}</span></div>
                      </div>
                    ) : null;
                  })()}
                  <Button onClick={handleConnect} className="w-full" disabled={!selectedDevice || devices.find((d: any) => d.id === selectedDevice)?.status !== 'active'}>
                    <Router className="h-4 w-4 mr-2" />Conectar
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
          <CloudflareConfig mikrotikId={selectedDevice || null} mikrotikDevice={null} />
          <VpsDockerManager mikrotikId={selectedDevice || null} />
        </div>
      </div>
    </div>
  );
}
