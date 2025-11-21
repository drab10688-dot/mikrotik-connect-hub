import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Router, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export default function NoAccess() {
  const navigate = useNavigate();
  const { signOut } = useAuth();

  const handleLogout = async () => {
    await signOut();
    localStorage.removeItem("mikrotik_connected");
    localStorage.removeItem("mikrotik_config");
    localStorage.removeItem("mikrotik_host");
    localStorage.removeItem("mikrotik_version");
    toast.info("Sesión cerrada exitosamente");
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Shield className="w-8 h-8 text-muted-foreground" />
          </div>
          <CardTitle className="text-2xl">Sin Acceso a Dispositivos</CardTitle>
          <CardDescription className="text-base mt-2">
            Actualmente no tienes dispositivos MikroTik asignados
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted/50 rounded-lg p-4 space-y-2">
            <div className="flex items-start gap-3">
              <Router className="w-5 h-5 text-primary mt-0.5" />
              <div>
                <p className="text-sm font-medium">¿Qué necesitas hacer?</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Contacta al administrador para que te asigne un dispositivo MikroTik
                </p>
              </div>
            </div>
          </div>
          
          <div className="pt-4 space-y-2">
            <p className="text-xs text-center text-muted-foreground">
              Una vez que el administrador te asigne un dispositivo, podrás acceder al sistema completo
            </p>
          </div>

          <Button 
            onClick={handleLogout}
            variant="outline"
            className="w-full"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Cerrar Sesión
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
