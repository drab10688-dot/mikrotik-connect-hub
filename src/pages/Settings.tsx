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

  const handleConnect = async () => {
    if (!selectedDevice) {
      toast.error("Selecciona un dispositivo MikroTik");
      return;
    }

    const device = devices?.find(d => d.id === selectedDevice);
    if (!device) {
      toast.error("Dispositivo no encontrado");
      return;
    }

    // Verificar que el dispositivo esté activo
    if (device.status !== 'active') {
      toast.error("Dispositivo no disponible", {
        description: device.status === 'pending' 
          ? "Este dispositivo está pendiente de aprobación por el administrador"
          : "Este dispositivo ha sido rechazado y no puede ser usado"
      });
      return;
    }

    // Verificar autorización
    try {
      if (!isSuperAdmin) {
        if (isAdmin) {
          // Verificar que el admin tenga acceso asignado
          const { data: access, error } = await supabase
            .from('user_mikrotik_access')
            .select('id')
            .eq('user_id', user?.id)
            .eq('mikrotik_id', device.id)
            .single();

          if (error || !access) {
            toast.error("Acceso no autorizado", {
              description: "No tienes permiso para conectarte a este dispositivo. Contacta al administrador."
            });
            return;
          }
        } else {
          // Verificar que el usuario sea el creador
          if (device.created_by !== user?.id) {
            toast.error("Acceso no autorizado", {
              description: "Este dispositivo no te pertenece. Solo puedes conectarte a tus propios dispositivos."
            });
            return;
          }
        }
      }

      // Si pasó todas las validaciones, guardar credenciales y conectar
      saveMikroTikCredentials({
        host: device.host,
        username: device.username,
        password: device.password,
        port: device.port.toString(),
        version: device.version,
      });

      toast.success(`Conectado a ${device.name}`);
      navigate("/dashboard");
    } catch (error) {
      console.error('Error verificando autorización:', error);
      toast.error("Error al verificar autorización");
    }
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
                        <SelectItem 
                          key={device.id} 
                          value={device.id}
                          disabled={device.status !== 'active'}
                        >
                          {device.name} ({device.host})
                          {device.status === 'pending' && ' - Pendiente'}
                          {device.status === 'rejected' && ' - Rechazado'}
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
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">Estado:</span>
                              <span className={`font-medium ${
                                device.status === 'active' 
                                  ? 'text-green-600 dark:text-green-400' 
                                  : device.status === 'pending'
                                  ? 'text-orange-600 dark:text-orange-400'
                                  : 'text-red-600 dark:text-red-400'
                              }`}>
                                {device.status === 'active' && 'Activo'}
                                {device.status === 'pending' && 'Pendiente de aprobación'}
                                {device.status === 'rejected' && 'Rechazado'}
                              </span>
                            </div>
                            {device.status === 'pending' && (
                              <div className="mt-3 p-2 bg-orange-50 dark:bg-orange-950/20 rounded border border-orange-200 dark:border-orange-800">
                                <p className="text-xs text-orange-600 dark:text-orange-400">
                                  Este dispositivo está esperando aprobación del administrador
                                </p>
                              </div>
                            )}
                            {device.status === 'rejected' && (
                              <div className="mt-3 p-2 bg-red-50 dark:bg-red-950/20 rounded border border-red-200 dark:border-red-800">
                                <p className="text-xs text-red-600 dark:text-red-400">
                                  Este dispositivo ha sido rechazado y no puede ser usado
                                </p>
                              </div>
                            )}
                          </>
                        ) : null;
                      })()}
                    </div>
                  )}

                  <Button onClick={handleConnect} className="w-full" disabled={!selectedDevice || (() => {
                    const device = devices.find(d => d.id === selectedDevice);
                    return device?.status !== 'active';
                  })()}>
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
