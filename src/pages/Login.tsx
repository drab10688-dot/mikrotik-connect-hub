import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Wifi, Shield, Router, Activity } from "lucide-react";
import { toast } from "sonner";

const Login = () => {
  const navigate = useNavigate();

  // This legacy login page is no longer used - redirect to auth login
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-primary mb-4 shadow-primary">
            <Router className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-2">MikroTik Manager</h1>
          <p className="text-muted-foreground">Administra Hotspot y PPPoE (compatible con v6 y v7)</p>
        </div>

        <Card className="shadow-lg border-border/50">
          <CardHeader>
            <CardTitle>Iniciar Sesión</CardTitle>
            <CardDescription>Accede a tu cuenta para gestionar dispositivos</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              Para conectarte a un dispositivo MikroTik, primero debes iniciar sesión en tu cuenta.
            </p>
            
            <Button className="w-full" onClick={() => navigate("/auth/login")}>
              <Wifi className="w-4 h-4 mr-2" />
              Ir a Iniciar Sesión
            </Button>

            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground pt-2">
              <Shield className="w-4 h-4" />
              <span>Conexión segura</span>
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full mt-4"
              onClick={() => navigate("/diagnostics")}
            >
              <Activity className="w-4 h-4 mr-2" />
              Herramientas de Diagnóstico
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Login;
