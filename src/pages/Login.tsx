import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wifi, Shield, Router, Activity } from "lucide-react";
import { toast } from "sonner";
import { saveMikroTikCredentials, testMikroTikConnection } from "@/lib/mikrotik";

const Login = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    host: "",
    username: "",
    password: "",
    port: "8728",
    version: "v6"
  });

  const handleVersionChange = (value: string) => {
    const defaultPort = value === "v6" ? "8728" : "80";
    setFormData({ ...formData, version: value, port: defaultPort });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const result = await testMikroTikConnection(formData);
      
      if (result.success) {
        saveMikroTikCredentials(formData);
        toast.success("Conectado exitosamente a MikroTik");
        navigate("/dashboard");
      } else {
        toast.error(result.error || "Error al conectar");
      }
    } catch (error: any) {
      console.error("Connection error:", error);
      toast.error(error.message || "Error al conectar con el router");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-primary mb-4 shadow-primary">
            <Router className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-2">MikroTik Manager</h1>
          <p className="text-muted-foreground">Gestiona tus routers MikroTik v6 y v7</p>
        </div>

        <Card className="shadow-lg border-border/50">
          <CardHeader>
            <CardTitle>Conectar a Router</CardTitle>
            <CardDescription>Ingresa las credenciales de tu router MikroTik</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="host">Host / IP</Label>
                <Input
                  id="host"
                  type="text"
                  placeholder="192.168.88.1"
                  value={formData.host}
                  onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="version">Versión de RouterOS</Label>
                <Select value={formData.version} onValueChange={handleVersionChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona versión" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="v6">RouterOS v6 (API binaria - Puerto 8728/8729)</SelectItem>
                    <SelectItem value="v7">RouterOS v7 (REST API - Puerto 80/443)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {formData.version === "v6" 
                    ? "API binaria: Puerto 8728 (sin TLS) o 8729 (con TLS)"
                    : "REST API: Puerto 80 (HTTP) o 443 (HTTPS)"}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="username">Usuario</Label>
                  <Input
                    id="username"
                    type="text"
                    placeholder="admin"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="port">Puerto API</Label>
                  <Input
                    id="port"
                    type="text"
                    placeholder="8728"
                    value={formData.port}
                    onChange={(e) => setFormData({ ...formData, port: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Contraseña</Label>
                <Input
                  id="password"
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  required
                />
              </div>

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin mr-2" />
                    Conectando...
                  </>
                ) : (
                  <>
                    <Wifi className="w-4 h-4 mr-2" />
                    Conectar
                  </>
                )}
              </Button>

              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 p-4 mt-4">
                <p className="text-sm text-amber-800 dark:text-amber-200 font-medium mb-2">
                  ⚠️ Requisitos de conexión:
                </p>
                <ul className="text-xs text-amber-700 dark:text-amber-300 space-y-1 ml-4">
                  <li>• Habilitar servicio API: <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">/ip service enable api</code></li>
                  <li>• Permitir acceso en firewall desde tu IP</li>
                  <li>• Puerto {formData.version === "v6" ? "8728 (o 8729 SSL)" : "80 (o 443 HTTPS)"} accesible desde internet</li>
                </ul>
              </div>

              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground pt-4">
                <Shield className="w-4 h-4" />
                <span>Conexión segura vía API</span>
              </div>

              <div className="pt-4 border-t">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => navigate("/diagnostics")}
                >
                  <Activity className="w-4 h-4 mr-2" />
                  Herramientas de Diagnóstico
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Login;
