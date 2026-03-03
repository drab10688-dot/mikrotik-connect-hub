import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { devicesApi, secretariesApi } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { toast } from "sonner";
import { saveSelectedDevice, cleanupLegacyStorage, clearSelectedDevice } from "@/lib/mikrotik";
import { Router, Wifi, Loader2, CircleCheck, CircleX, AlertCircle, Copy } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { AddDeviceDialog } from "@/components/settings/AddDeviceDialog";
import { EditDeviceDialog } from "@/components/settings/EditDeviceDialog";
import { CloudflareConfig } from "@/components/settings/CloudflareConfig";
import { VpsDockerManager } from "@/components/settings/VpsDockerManager";

interface DiagnosticCheck {
  ok: boolean | null;
  message: string;
  code?: string;
  technical_error?: string;
  latency_ms?: number | null;
  ports_tried?: number[];
  sample?: unknown;
}

interface ConnectionDiagnosticResult {
  connected: boolean;
  panel_api?: { ok: boolean; message: string };
  device?: { host: string; port: number; version: string };
  checks?: {
    tcp?: DiagnosticCheck;
    credentials?: DiagnosticCheck;
    rest_api?: DiagnosticCheck;
  };
  recommendations?: string[];
  suggested_port?: number;
}

const statusBadge = (ok: boolean | null) => {
  if (ok === true) return { label: "OK", variant: "default" as const, Icon: CircleCheck };
  if (ok === false) return { label: "FALLA", variant: "destructive" as const, Icon: CircleX };
  return { label: "NO EVALUADO", variant: "secondary" as const, Icon: AlertCircle };
};

export default function Settings() {
  const navigate = useNavigate();
  const { user, isSuperAdmin, isAdmin, isSecretary } = useAuth();
  const [selectedDevice, setSelectedDevice] = useState<string>("");
  const [diagnosticResult, setDiagnosticResult] = useState<ConnectionDiagnosticResult | null>(null);

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

  useEffect(() => {
    setDiagnosticResult(null);
  }, [selectedDevice]);

  const diagnoseConnectionMutation = useMutation({
    mutationFn: async () => {
      if (!selectedDevice) throw new Error("Selecciona un dispositivo MikroTik");
      const response = await devicesApi.diagnoseConnection(selectedDevice);
      if (!response?.success) throw new Error(response?.error || "No se pudo ejecutar el diagnóstico");
      return response.data as ConnectionDiagnosticResult;
    },
    onSuccess: (data) => {
      setDiagnosticResult(data);
      if (data.connected) {
        toast.success("Conexión MikroTik verificada correctamente");
      } else {
        toast.warning("Diagnóstico completado: se detectaron fallos en la conexión");
      }
    },
    onError: (error: any) => {
      setDiagnosticResult(null);
      toast.error(error.message || 'Error al diagnosticar la conexión');
    },
  });

  const handleConnect = () => {
    if (!selectedDevice) { toast.error("Selecciona un dispositivo MikroTik"); return; }
    const device = devices?.find((d: any) => d.id === selectedDevice);
    if (!device) { toast.error("Dispositivo no encontrado"); return; }
    if (device.status !== 'active') { toast.error("Dispositivo no disponible"); return; }

    saveSelectedDevice({ id: device.id, name: device.name, host: device.host, port: device.port.toString(), version: device.version });
    toast.success(`Conectado a ${device.name}`);
    navigate("/dashboard");
  };

  const copyDiagnosticReport = async () => {
    if (!diagnosticResult) return;

    const device = devices?.find((d: any) => d.id === selectedDevice);
    const report = {
      generated_at: new Date().toISOString(),
      route: window.location.pathname,
      selected_device: device
        ? {
            id: device.id,
            name: device.name,
            host: device.host,
            port: device.port,
            version: device.version,
            status: device.status,
          }
        : null,
      diagnostic: diagnosticResult,
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      toast.success("Reporte de diagnóstico copiado");
    } catch {
      toast.error("No se pudo copiar el reporte");
    }
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Button
                      variant="outline"
                      onClick={() => diagnoseConnectionMutation.mutate()}
                      disabled={!selectedDevice || diagnoseConnectionMutation.isPending}
                    >
                      {diagnoseConnectionMutation.isPending ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Verificando...</>
                      ) : (
                        <><AlertCircle className="h-4 w-4 mr-2" />Verificar Conexión</>
                      )}
                    </Button>
                    <Button onClick={handleConnect} disabled={!selectedDevice || devices.find((d: any) => d.id === selectedDevice)?.status !== 'active'}>
                      <Router className="h-4 w-4 mr-2" />Conectar
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {diagnosticResult && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {diagnosticResult.connected ? <CircleCheck className="h-5 w-5 text-green-500" /> : <CircleX className="h-5 w-5 text-destructive" />}
                  Resultado del Diagnóstico
                </CardTitle>
                <CardDescription>
                  {diagnosticResult.connected
                    ? 'Conexión operativa: red, credenciales y API REST funcionando.'
                    : 'Se detectó un problema. Revisa el detalle y recomendaciones.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  { label: 'API del panel', data: diagnosticResult.panel_api ? { ok: diagnosticResult.panel_api.ok, message: diagnosticResult.panel_api.message } : null },
                  { label: `Conectividad TCP (${diagnosticResult.device?.port ?? '-'})`, data: diagnosticResult.checks?.tcp },
                  { label: 'Credenciales', data: diagnosticResult.checks?.credentials },
                  { label: 'API MikroTik', data: diagnosticResult.checks?.rest_api },
                ].map((item) => {
                  if (!item.data) return null;
                  const { label, variant, Icon } = statusBadge(item.data.ok);
                  return (
                    <div key={item.label} className="rounded-md border p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <Icon className="h-4 w-4" />
                          {item.label}
                        </div>
                        <Badge variant={variant}>{label}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{item.data.message}</p>
                      {'latency_ms' in item.data && typeof item.data.latency_ms === 'number' && (
                        <p className="text-xs text-muted-foreground">Latencia TCP: {item.data.latency_ms}ms</p>
                      )}
                      {'technical_error' in item.data && item.data.technical_error && (
                        <p className="text-xs font-mono text-destructive/70 bg-destructive/5 p-2 rounded">{item.data.technical_error}</p>
                      )}
                    </div>
                  );
                })}

                {diagnosticResult.recommendations && diagnosticResult.recommendations.length > 0 && (
                  <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-4 space-y-2">
                    <p className="text-sm font-medium flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-yellow-500" />
                      Recomendaciones
                    </p>
                    <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                      {diagnosticResult.recommendations.map((rec, i) => (
                        <li key={i}>{rec}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={copyDiagnosticReport}>
                    <Copy className="h-4 w-4 mr-2" />
                    Copiar reporte técnico
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <CloudflareConfig mikrotikId={selectedDevice || null} mikrotikDevice={null} />
          <VpsDockerManager mikrotikId={selectedDevice || null} />
        </div>
      </div>
    </div>
  );
}
