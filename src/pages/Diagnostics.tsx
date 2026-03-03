import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sidebar } from "@/components/dashboard/Sidebar";
import {
  Activity, CheckCircle, XCircle, Loader2, RefreshCw, Copy,
  Server, Router, Wifi, Users, Gauge, ListChecks, CreditCard, Database, AlertCircle
} from "lucide-react";
import { getApiBaseUrl } from "@/lib/api-client";
import { toast } from "sonner";

interface EndpointTest {
  key: string;
  label: string;
  icon: React.ElementType;
  endpoint: string;
  needsDevice: boolean;
  status: "idle" | "testing" | "ok" | "fail" | "skipped";
  latency?: number;
  error?: string;
  statusCode?: number;
}

const ENDPOINTS: Omit<EndpointTest, "status">[] = [
  { key: "health", label: "API Health", icon: Server, endpoint: "/health", needsDevice: false },
  { key: "devices", label: "Dispositivos MikroTik", icon: Router, endpoint: "/devices", needsDevice: false },
  { key: "system", label: "System Resource", icon: Activity, endpoint: "/system/{id}/resource", needsDevice: true },
  { key: "pppoe", label: "PPPoE Secrets", icon: Wifi, endpoint: "/pppoe/{id}/secrets", needsDevice: true },
  { key: "hotspot", label: "Hotspot Users", icon: Users, endpoint: "/hotspot/{id}/users", needsDevice: true },
  { key: "queues", label: "Simple Queues", icon: Gauge, endpoint: "/queues/{id}", needsDevice: true },
  { key: "address-list", label: "Address List", icon: ListChecks, endpoint: "/address-list/{id}", needsDevice: true },
  { key: "service-options", label: "Service Options", icon: CreditCard, endpoint: "/service-options?mikrotik_id={id}", needsDevice: true },
  { key: "billing", label: "Billing Config", icon: Database, endpoint: "/billing/{id}/config", needsDevice: true },
];

export default function Diagnostics() {
  const [tests, setTests] = useState<EndpointTest[]>(
    ENDPOINTS.map((e) => ({ ...e, status: "idle" as const }))
  );
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  const getDeviceId = (): string | null => localStorage.getItem("mikrotik_device_id");

  const testEndpoint = async (ep: Omit<EndpointTest, "status">, deviceId: string | null): Promise<Partial<EndpointTest>> => {
    if (ep.needsDevice && !deviceId) {
      return { status: "skipped", error: "Sin dispositivo seleccionado" };
    }

    const start = performance.now();
    try {
      const baseUrl = getApiBaseUrl();
      const token = localStorage.getItem("vps_auth_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      // Replace {id} placeholder with actual device ID
      let path = ep.endpoint;
      if (deviceId) {
        path = path.replace("{id}", deviceId);
      }

      const url = `${baseUrl}${path}`;
      const res = await fetch(url, { method: "GET", headers });
      const latency = Math.round(performance.now() - start);

      if (res.ok) {
        return { status: "ok", latency, statusCode: res.status };
      }
      const body = await res.text().catch(() => "");
      // Try to extract error message from JSON
      let errorMsg = res.statusText;
      try {
        const json = JSON.parse(body);
        errorMsg = json.error || json.message || res.statusText;
      } catch {
        if (body.length < 100 && !body.includes("<")) errorMsg = body;
      }
      return { status: "fail", latency, statusCode: res.status, error: errorMsg };
    } catch (err: any) {
      const latency = Math.round(performance.now() - start);
      return { status: "fail", latency, error: err.message || "Network error" };
    }
  };

  const runAll = useCallback(async () => {
    setRunning(true);
    setProgress(0);
    const deviceId = getDeviceId();

    setTests((prev) => prev.map((t) => ({ ...t, status: "testing" as const, latency: undefined, error: undefined, statusCode: undefined })));

    for (let i = 0; i < ENDPOINTS.length; i++) {
      const ep = ENDPOINTS[i];
      setTests((prev) => prev.map((t) => t.key === ep.key ? { ...t, status: "testing" } : t));

      const result = await testEndpoint(ep, deviceId);

      setTests((prev) => prev.map((t) => t.key === ep.key ? { ...t, ...result } : t));
      setProgress(Math.round(((i + 1) / ENDPOINTS.length) * 100));
    }

    setRunning(false);
  }, []);

  useEffect(() => { runAll(); }, []);

  const passed = tests.filter((t) => t.status === "ok").length;
  const failed = tests.filter((t) => t.status === "fail").length;
  const skipped = tests.filter((t) => t.status === "skipped").length;
  const total = tests.length;
  const deviceId = getDeviceId();

  const copyReport = async () => {
    const report = {
      generated_at: new Date().toISOString(),
      api_base_url: getApiBaseUrl(),
      mikrotik_device_id: deviceId,
      summary: { total, passed, failed, skipped },
      tests: tests.map(({ key, label, status, latency, statusCode, error, endpoint }) => ({
        key, label, status, latency_ms: latency, status_code: statusCode, error, endpoint,
      })),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      toast.success("Reporte copiado al portapapeles");
    } catch {
      toast.error("No se pudo copiar");
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 p-4 md:p-8 md:ml-64">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Activity className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold">Diagnóstico API VPS</h1>
                <p className="text-sm text-muted-foreground">Prueba automática de endpoints críticos</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={copyReport} disabled={running}>
                <Copy className="h-4 w-4 mr-2" />Copiar Reporte
              </Button>
              <Button size="sm" onClick={runAll} disabled={running}>
                {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                {running ? "Probando..." : "Re-ejecutar"}
              </Button>
            </div>
          </div>

          {/* Device warning */}
          {!deviceId && (
            <Card className="border-yellow-500/30 bg-yellow-500/5">
              <CardContent className="py-3 flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-yellow-500 shrink-0" />
                <p className="text-sm">No hay dispositivo MikroTik seleccionado. Ve a <strong>Configuración</strong> y conecta un dispositivo para probar todos los endpoints.</p>
              </CardContent>
            </Card>
          )}

          {/* Summary */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium">Progreso: {progress}%</span>
                <div className="flex gap-2">
                  <Badge variant="default">{passed} OK</Badge>
                  {failed > 0 && <Badge variant="destructive">{failed} Falla</Badge>}
                  {skipped > 0 && <Badge variant="secondary">{skipped} Omitido</Badge>}
                </div>
              </div>
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground mt-2">
                Base URL: {getApiBaseUrl()}
                {deviceId && <> · Device: <code className="text-xs">{deviceId.slice(0, 8)}...</code></>}
              </p>
            </CardContent>
          </Card>

          {/* Endpoint Results */}
          <div className="grid gap-3">
            {tests.map((test) => {
              const Icon = test.icon;
              const bgColor = test.status === "ok" ? "bg-green-500/10"
                : test.status === "fail" ? "bg-destructive/10"
                : test.status === "skipped" ? "bg-yellow-500/10"
                : "bg-muted";
              const textColor = test.status === "ok" ? "text-green-500"
                : test.status === "fail" ? "text-destructive"
                : test.status === "skipped" ? "text-yellow-500"
                : "text-muted-foreground";
              const borderColor = test.status === "ok" ? "border-green-500/30"
                : test.status === "fail" ? "border-destructive/30"
                : test.status === "skipped" ? "border-yellow-500/20"
                : "";

              return (
                <Card key={test.key} className={borderColor}>
                  <CardContent className="py-4 flex items-center gap-4">
                    <div className={`p-2 rounded-lg ${bgColor}`}>
                      <Icon className={`h-5 w-5 ${textColor}`} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{test.label}</span>
                        <code className="text-xs text-muted-foreground hidden sm:inline">{test.endpoint}</code>
                      </div>
                      {test.error && (
                        <p className="text-xs text-destructive/80 mt-1 truncate">{test.error}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      {test.latency !== undefined && (
                        <span className="text-xs text-muted-foreground">{test.latency}ms</span>
                      )}
                      {test.statusCode && (
                        <Badge variant={test.status === "ok" ? "secondary" : "destructive"} className="text-xs">
                          {test.statusCode}
                        </Badge>
                      )}
                      {test.status === "testing" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                      {test.status === "ok" && <CheckCircle className="h-5 w-5 text-green-500" />}
                      {test.status === "fail" && <XCircle className="h-5 w-5 text-destructive" />}
                      {test.status === "skipped" && <AlertCircle className="h-5 w-5 text-yellow-500" />}
                      {test.status === "idle" && <div className="h-5 w-5 rounded-full bg-muted" />}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
