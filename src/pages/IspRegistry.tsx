import { useState } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Key, Save } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getSelectedDeviceId } from "@/lib/mikrotik";
import { ClientRegistrationForm } from "@/components/isp/ClientRegistrationForm";

export default function IspRegistry() {
  const mikrotikId = getSelectedDeviceId();
  const [useStandardPassword, setUseStandardPassword] = useState(true);
  const [standardPassword, setStandardPassword] = useState(
    localStorage.getItem("isp_standard_password") || ""
  );

  // Obtener usuarios PPPoE para el formulario
  const { refetch: refetchUsers } = useQuery({
    queryKey: ["isp-pppoe-users", mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) throw new Error("No hay dispositivo MikroTik seleccionado");
      
      const { data, error } = await supabase.functions.invoke("mikrotik-v6-api", {
        body: {
          mikrotikId,
          command: "ppp-secrets",
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);
      return data.data || [];
    },
    enabled: !!mikrotikId,
  });

  // Guardar contraseña estándar
  const handleSaveStandardPassword = () => {
    localStorage.setItem("isp_standard_password", standardPassword);
    toast.success("Contraseña estándar guardada");
  };

  if (!mikrotikId) {
    return (
      <div className="min-h-screen bg-background">
        <Sidebar />
        <div className="p-4 md:p-8 md:ml-64">
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <div className="text-center">
                <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">Sin conexión</h3>
                <p className="text-muted-foreground">
                  Conecta un dispositivo MikroTik desde Configuración
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="p-4 md:p-8 md:ml-64">
        <div className="mb-6 md:mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Registro ISP</h1>
          <p className="text-muted-foreground">Gestión rápida de usuarios PPPoE y colas de ancho de banda</p>
        </div>

        {/* Configuración de contraseña estándar */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Key className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">Contraseña Estándar PPPoE</CardTitle>
                <CardDescription>Configura una contraseña predeterminada para nuevos usuarios</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 items-end">
              <div className="flex-1 space-y-2">
                <Label htmlFor="standardPassword">Contraseña estándar</Label>
                <Input
                  id="standardPassword"
                  type="text"
                  placeholder="Ingresa la contraseña estándar"
                  value={standardPassword}
                  onChange={(e) => setStandardPassword(e.target.value)}
                />
              </div>
              <Button onClick={handleSaveStandardPassword} disabled={!standardPassword}>
                <Save className="w-4 h-4 mr-2" />
                Guardar
              </Button>
            </div>
          </CardContent>
        </Card>

        <ClientRegistrationForm 
          useStandardPassword={useStandardPassword}
          standardPassword={standardPassword}
          onSuccess={() => refetchUsers()}
        />
      </div>
    </div>
  );
}
