import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sidebar } from "@/components/dashboard/Sidebar";
import {
  Activity,
  CheckCircle,
  XCircle,
  Loader2,
  RefreshCw,
  Copy,
  Server,
  Router,
  Wifi,
  Users,
  Gauge,
  ListChecks,
  CreditCard,
  Database,
  AlertCircle,
} from "lucide-react";
import { getApiBaseUrl } from "@/lib/api-client";
import { toast } from "sonner";

interface EndpointConfig {
  key: string;
  label: string;
  icon: React.ElementType;
  paths: string[];
  needsDevice: boolean;
}

type TestStatus = "idle" | "testing" | "ok" | "fail" | "skipped";

interface EndpointTest extends EndpointConfig {
  status: TestStatus;
  latency?: number;
  error?: string;
  statusCode?: number;
  testedPath?: string;
}

const ENDPOINTS: EndpointConfig[] = [
  { key: "health", label: "API Health", icon: Server, paths: ["/health"], needsDevice: false },
  { key: "devices", label: "Dispositivos MikroTik", icon: Router, paths: ["/devices"], needsDevice: false },
  { key: "system", label: "System Resource", icon: Activity, paths: ["/system/{id}/resource"], needsDevice: true },
  { key: "pppoe", label: "PPPoE Secrets", icon: Wifi, paths: ["/pppoe/{id}/secrets"], needsDevice: true },
  { key: "hotspot", label: "Hotspot Users", icon: Users, paths: ["/hotspot/{id}/users"], needsDevice: true },
  { key: "queues", label: "Simple Queues", icon: Gauge, paths: ["/queues/{id}"], needsDevice: true },
  { key: "address-list", label: "Address List", icon: ListChecks, paths: ["/address-list/{id}"], needsDevice: true },
  {
    key: "service-options",
    label: "Service Options",
    paths: ["/service-options?mikrotik_id={id}", "/clients/service-options?mikrotik_id={id}"],
    icon: CreditCard,
    needsDevice: true,
  },
  { key: "billing", label: "Billing Config", icon: Database, paths: ["/billing/{id}/config"], needsDevice: true },
];

const parseErrorMessage = (raw: string, fallback: string) => {
  if (!raw) return fallback;
  try {
    const json = JSON.parse(raw);
    return json?.error || json?.message || fallback;
  } catch {
    if (raw.includes("Cannot GET")) return "Not Found";
    const clean = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return clean.slice(0, 160) || fallback;
  }
};

const copyText = async (text: string): Promise<boolean> => {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);
  return ok;
};

export default function Diagnostics() {
  const [tests, setTests] = useState<EndpointTest[]>(
    ENDPOINTS.map((e) => ({ ...e, status: "idle" as const }))
  );
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  const deviceId = localStorage.getItem("mikrotik_device_id");

  const testEndpoint = async (ep: EndpointConfig): Promise<Partial<EndpointTest>> => {
    if (ep.needsDevice && !deviceId) {
      return { status: "skipped", error: "Sin dispositivo seleccionado" };
    }

    const token = localStorage.getItem("vps_auth_token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const baseUrl = getApiBaseUrl();
    let lastFailure: Partial<EndpointTest> = { status: "fail", error: "No response" };

    for (const pathTemplate of ep.paths) {
      const path = pathTemplate.replace("{id}", deviceId || "");
      const url = `${baseUrl}${path}`;
      const started = performance.now();

      try {
        const res = await fetch(url, { method: "GET", headers });
        const latency = Math.round(performance.now() - started);

        if (res.ok) {
          return { status: "ok", statusCode: res.status, latency, testedPath: path };
        }

        const body = await res.text().catch(() => "");
        const error = parseErrorMessage(body, res.statusText);

        lastFailure = { status: "fail", statusCode: res.status, latency, error, testedPath: path };

        // If current alias is missing, try next candidate path
        if (res.status === 404) continue;
        return lastFailure;
      } catch (err: any) {
        const latency = Math.round(performance.now() - started);
        lastFailure = {
          status: "fail",
          latency,
          error: err?.message || "Network error",
          testedPath: path,
        };
      }
    }

    return lastFailure;
  };

  const runAll = useCallback(async () => {
    setRunning(true);
    setProgress(0);

    setTests((prev) =>
      prev.map((t) => ({
        ...t,
        status: "testing",
        latency: undefined,
        error: undefined,
        statusCode: undefined,
        testedPath: undefined,
      }))
    );

    for (let i = 0; i < ENDPOINTS.length; i++) {
      const endpoint = ENDPOINTS[i];
      const result = await testEndpoint(endpoint);
      setTests((prev) => prev.map((t) => (t.key === endpoint.key ? { ...t, ...result } : t)));
      setProgress(Math.round(((i + 1) / ENDPOINTS.length) * 100));
    }

    setRunning(false);
  }, [deviceId]);

  useEffect(() => {
    runAll();
  }, [runAll]);

  const passed = tests.filter((t) => t.status === "ok").length;
  const failed = tests.filter((t) => t.status === "fail").length;
  const skipped = tests.filter((t) => t.status === "skipped").length;

  const copyReport = async () => {
    const report = {
      generated_at: new Date().toISOString(),
      api_base_url: getApiBaseUrl(),
      mikrotik_device_id: deviceId,
      summary: { total: tests.length, passed, failed, skipped },
      tests: tests.map(({ key, label, status, testedPath, latency, statusCode, error }) => ({
        key,
        label,
        status,
        endpoint: testedPath,
        latency_ms: latency,
        status_code: statusCode,
        error,
      })),
    };

    const ok = await copyText(JSON.stringify(report, null, 2));
    if (ok) toast.success("Reporte copiado");
    else toast.error("No se pudo copiar el reporte");
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 p-4 md:p-8 md:ml-64">
        <div className="max-w-3xl mx-auto space-y-6">
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
              <Button variant="outline" size="sm" onClick={copyReport}>
                <Copy className="h-4 w-4 mr-2" />Copiar Reporte
              </Button>
              <Button size="sm" onClick={runAll} disabled={running}>
                {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                {running ? "Probando..." : "Re-ejecutar"}
              </Button>
            </div>
          </div>

          {!deviceId && (
            <Card>
              <CardContent className="py-3 flex items-center gap-2 text-sm text-muted-foreground">
                <AlertCircle className="h-4 w-4" />
                Selecciona un dispositivo en Configuración para probar endpoints de MikroTik.
              </CardContent>
            </Card>
          )}

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
                Base URL: {getApiBaseUrl()} {deviceId ? `· Device: ${deviceId.slice(0, 8)}...` : ""}
              </p>
            </CardContent>
          </Card>

          <div className="grid gap-3">
            {tests.map((test) => {
              const Icon = test.icon;
              return (
                <Card key={test.key}>
                  <CardContent className="py-4 flex items-center gap-4">
                    <div className="p-2 rounded-lg bg-muted">
                      <Icon className="h-5 w-5 text-muted-foreground" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{test.label}</span>
                        <code className="text-xs text-muted-foreground hidden sm:inline">{test.testedPath || test.paths[0]}</code>
                      </div>
                      {test.error && <p className="text-xs text-muted-foreground mt-1 truncate">{test.error}</p>}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {test.latency !== undefined && <span className="text-xs text-muted-foreground">{test.latency}ms</span>}
                      {test.statusCode && (
                        <Badge variant={test.status === "ok" ? "secondary" : "destructive"} className="text-xs">
                          {test.statusCode}
                        </Badge>
                      )}
                      {test.status === "testing" && <Loader2 className="h-4 w-4 animate-spin" />}
                      {test.status === "ok" && <CheckCircle className="h-5 w-5" />}
                      {test.status === "fail" && <XCircle className="h-5 w-5" />}
                      {test.status === "skipped" && <AlertCircle className="h-5 w-5" />}
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
