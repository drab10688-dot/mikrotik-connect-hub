import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { toast } from "sonner";
import { saveMikroTikCredentials } from "@/lib/mikrotik";
import { Router, Wifi } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export default function Settings() {
  const navigate = useNavigate();
  const { user, isSuperAdmin, isAdmin } = useAuth();
  const [selectedDevice, setSelectedDevice] = useState<string>("");

  const { data: devices, isLoading } = useQuery({
    queryKey: ['mikrotik-devices-select', user?.id],
    queryFn: async () => {
      if (isSuperAdmin) {
        // Super admins see all active devices
        const { data, error } = await supabase
          .from('mikrotik_devices')
          .select('*')
          .eq('status', 'active')
          .order('name');

        if (error) throw error;
        return data;
      } else if (isAdmin) {
        // Regular admins only see assigned active devices
        const { data, error } = await supabase
          .from('user_mikrotik_access')
          .select('mikrotik_devices!inner(*)')
          .eq('user_id', user?.id)
          .eq('mikrotik_devices.status', 'active');

        if (error) throw error;
        return data.map((access: any) => access.mikrotik_devices).filter(Boolean);
      } else {
        // Regular users see their own active devices
        const { data, error } = await supabase
          .from('mikrotik_devices')
          .select('*')
          .eq('created_by', user?.id)
          .eq('status', 'active')
          .order('name');

        if (error) throw error;
        return data;
      }
    },
    enabled: !!user,
  });

  const handleConnect = () => {
    if (!selectedDevice) {
      toast.error("Selecciona un dispositivo MikroTik");
      return;
    }

    const device = devices?.find(d => d.id === selectedDevice);
    if (!device) return;

    saveMikroTikCredentials({
      host: device.host,
      username: device.username,
      password: device.password,
      port: device.port.toString(),
      version: device.version,
    });

    toast.success(`Conectado a ${device.name}`);
    navigate("/dashboard");
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 p-8 ml-64">
        <div className="max-w-2xl mx-auto space-y-6">
          <div>
            <h1 className="text-3xl font-bold">Configuración</h1>
            <p className="text-muted-foreground">
              Selecciona el dispositivo MikroTik
            </p>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Router className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <CardTitle>Dispositivo MikroTik</CardTitle>
                  <CardDescription>
                    {isSuperAdmin 
                      ? 'Selecciona cualquier router para gestionar'
                      : isAdmin
                      ? 'Selecciona uno de tus routers asignados'
                      : 'Selecciona uno de tus routers'
                    }
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoading ? (
                <div className="text-center py-8">Cargando dispositivos...</div>
              ) : !devices || devices.length === 0 ? (
                <div className="text-center py-8">
                  <Wifi className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="text-muted-foreground">
                    {isSuperAdmin
                      ? 'No hay dispositivos MikroTik configurados'
                      : isAdmin 
                      ? 'No tienes dispositivos MikroTik asignados'
                      : 'No has creado dispositivos MikroTik aún'
                    }
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    {isSuperAdmin || !isAdmin ? 'Ve a Dispositivos MikroTik para crear uno' : 'Contacta al administrador'}
                  </p>
                  {!isSuperAdmin && !isAdmin && (
                    <p className="text-xs text-orange-600 mt-4 bg-orange-50 dark:bg-orange-950/20 p-3 rounded-lg inline-block">
                      Los dispositivos nuevos requieren aprobación del administrador antes de poder usarse
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <Select value={selectedDevice} onValueChange={setSelectedDevice}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona un dispositivo" />
                    </SelectTrigger>
                    <SelectContent>
                      {devices.map((device: any) => (
                        <SelectItem key={device.id} value={device.id}>
                          {device.name} ({device.host})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {selectedDevice && (
                    <div className="p-4 bg-muted rounded-lg space-y-2">
                      {(() => {
                        const device = devices.find(d => d.id === selectedDevice);
                        return device ? (
                          <>
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">Host:</span>
                              <span className="font-medium">{device.host}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">Puerto:</span>
                              <span className="font-medium">{device.port}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">Versión:</span>
                              <span className="font-medium">{device.version}</span>
                            </div>
                          </>
                        ) : null;
                      })()}
                    </div>
                  )}

                  <Button onClick={handleConnect} className="w-full" disabled={!selectedDevice}>
                    <Router className="h-4 w-4 mr-2" />
                    Conectar
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
