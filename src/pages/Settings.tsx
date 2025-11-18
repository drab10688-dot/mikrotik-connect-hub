import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

const Settings = () => {
  const handleSave = () => {
    toast.success("Configuración guardada correctamente");
  };

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="ml-64 p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Configuración</h1>
          <p className="text-muted-foreground">Ajusta las preferencias del sistema</p>
        </div>

        <div className="space-y-6 max-w-2xl">
          <Card>
            <CardHeader>
              <CardTitle>Conexión al Router</CardTitle>
              <CardDescription>Configuración de la conexión a MikroTik</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="host">Host / IP del Router</Label>
                <Input id="host" defaultValue={localStorage.getItem("mikrotik_host") || ""} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="api-port">Puerto API</Label>
                <Input id="api-port" defaultValue="8728" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="timeout">Timeout (segundos)</Label>
                <Input id="timeout" type="number" defaultValue="10" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Hotspot</CardTitle>
              <CardDescription>Configuración del sistema de hotspot</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Auto-generar usuarios</Label>
                  <p className="text-sm text-muted-foreground">Crear usuarios automáticamente al iniciar sesión</p>
                </div>
                <Switch />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Notificaciones de conexión</Label>
                  <p className="text-sm text-muted-foreground">Recibir alertas cuando un usuario se conecta</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="space-y-2">
                <Label htmlFor="prefix">Prefijo de usuarios</Label>
                <Input id="prefix" defaultValue="user_" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Monitor de Tráfico</CardTitle>
              <CardDescription>Configuración del monitoreo de red</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Actualización automática</Label>
                  <p className="text-sm text-muted-foreground">Refrescar estadísticas en tiempo real</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="space-y-2">
                <Label htmlFor="refresh">Intervalo de actualización (segundos)</Label>
                <Input id="refresh" type="number" defaultValue="5" />
              </div>
            </CardContent>
          </Card>

          <Button onClick={handleSave} className="w-full">
            Guardar Cambios
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Settings;
