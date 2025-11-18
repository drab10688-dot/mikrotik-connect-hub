import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, AlertCircle, CheckCircle, Loader2, Network, WifiOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface PortScanResult {
  port: number;
  open: boolean;
  service?: string;
}

interface TcpTestResult {
  success: boolean;
  time?: number;
  error?: string;
}

interface DiagnosticResult {
  tcpTest: TcpTestResult;
  portScan: PortScanResult[];
  host: string;
  timestamp: string;
}

export default function Diagnostics() {
  const [host, setHost] = useState("159.65.34.13");
  const [port, setPort] = useState("8728");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DiagnosticResult | null>(null);

  const runDiagnostics = async () => {
    if (!host) {
      toast.error("Por favor ingresa una dirección IP o hostname");
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const { data, error } = await supabase.functions.invoke("network-diagnostics", {
        body: {
          host,
          port: parseInt(port),
          action: "full-diagnostic",
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      setResult(data.data);
      toast.success("Diagnóstico completado");
    } catch (error) {
      console.error("Diagnostic error:", error);
      toast.error((error as Error).message || "Error al ejecutar diagnóstico");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Activity className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">Diagnóstico de Conexión</h1>
            <p className="text-muted-foreground">Prueba conectividad TCP y escanea puertos del router</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Configuración</CardTitle>
            <CardDescription>Ingresa los datos del router para diagnosticar</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <Label htmlFor="host">IP o Hostname del Router</Label>
                <Input
                  id="host"
                  placeholder="192.168.1.1"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="port">Puerto Principal</Label>
                <Input
                  id="port"
                  placeholder="8728"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                />
              </div>
            </div>

            <Button onClick={runDiagnostics} disabled={loading} className="w-full">
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Ejecutando diagnóstico...
                </>
              ) : (
                <>
                  <Network className="w-4 h-4 mr-2" />
                  Iniciar Diagnóstico
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {result && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {result.tcpTest.success ? (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-red-500" />
                  )}
                  Prueba de Conectividad TCP
                </CardTitle>
                <CardDescription>
                  Puerto {port} • {new Date(result.timestamp).toLocaleString()}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {result.tcpTest.success ? (
                  <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                    <CheckCircle className="w-5 h-5" />
                    <span>Conexión exitosa en {result.tcpTest.time}ms</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                      <WifiOff className="w-5 h-5" />
                      <span>No se pudo conectar</span>
                    </div>
                    {result.tcpTest.error && (
                      <p className="text-sm text-muted-foreground bg-muted p-3 rounded">
                        {result.tcpTest.error}
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Escaneo de Puertos</CardTitle>
                <CardDescription>Puertos comunes de MikroTik RouterOS</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {result.portScan.map((portResult) => (
                    <div
                      key={portResult.port}
                      className={`p-4 rounded-lg border ${
                        portResult.open
                          ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900"
                          : "bg-muted/50 border-border"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono font-semibold">{portResult.port}</span>
                        <Badge variant={portResult.open ? "default" : "secondary"}>
                          {portResult.open ? "ABIERTO" : "CERRADO"}
                        </Badge>
                      </div>
                      {portResult.service && (
                        <p className="text-sm text-muted-foreground">{portResult.service}</p>
                      )}
                    </div>
                  ))}
                </div>

                <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-lg">
                  <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
                    💡 Recomendaciones
                  </h4>
                  <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
                    <li>• Puerto 8728 (API) o 8729 (API-SSL) debe estar abierto para RouterOS v6</li>
                    <li>• Puerto 80 (HTTP) o 443 (HTTPS) debe estar abierto para RouterOS v7</li>
                    <li>• Puerto 8291 (WinBox) para administración gráfica</li>
                    <li>• Asegúrate de configurar el firewall para permitir tu IP</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
