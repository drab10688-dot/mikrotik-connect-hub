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

export default function Settings() {
  const navigate = useNavigate();
  const [selectedDevice, setSelectedDevice] = useState<string>("");

  const { data: devices, isLoading } = useQuery({
    queryKey: ['mikrotik-devices-select'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mikrotik_devices')
        .select('*')
        .order('name');

      if (error) throw error;
      return data;
    },
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
              <CardTitle>Dispositivo MikroTik</CardTitle>
              <CardDescription>Selecciona un router</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoading ? (
                <div className="text-center py-8">Cargando...</div>
              ) : !devices?.length ? (
                <div className="text-center py-8">
                  <Wifi className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="text-muted-foreground">No hay dispositivos configurados</p>
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
