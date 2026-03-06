import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { vpsApi } from "@/lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Cloud, Key, ExternalLink, Copy, CheckCircle2, AlertCircle,
  Loader2, Terminal, Globe, Play, Square, RefreshCw, Download
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface CloudflareConfigProps {
  mikrotikId: string | null;
  mikrotikDevice?: {
    host: string;
    port: number;
    username: string;
    password: string;
  } | null;
}

export function CloudflareConfig({ mikrotikId }: CloudflareConfigProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [apiToken, setApiToken] = useState("");
  const [domain, setDomain] = useState("");
  const [tunnelName, setTunnelName] = useState("");

  const portalUrl = `${window.location.origin}/portal${mikrotikId ? `?id=${mikrotikId}` : ""}`;

  // ─── Quick Tunnel Status (directo en la API, estilo Stream Player Pro) ───
  const { data: tunnelInfo, isLoading: tunnelLoading } = useQuery({
    queryKey: ["tunnel-status"],
    queryFn: () => vpsApi.tunnelStatus(),
    refetchInterval: 5000,
  });

  // ─── Pro Config (DB-based) ───
  const { data: config } = useQuery({
    queryKey: ["cloudflare-config", mikrotikId],
    queryFn: () => vpsApi.getCloudflareConfig(mikrotikId!),
    enabled: !!mikrotikId,
  });

  useEffect(() => {
    if (config) {
      setApiToken(config.api_token || "");
      setDomain(config.domain || "");
      setTunnelName(config.tunnel_name || "");
    }
  }, [config]);

  // ─── Tunnel Actions (directo, sin agente Python) ───
  const installMutation = useMutation({
    mutationFn: () => vpsApi.tunnelInstall(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["tunnel-status"] });
      toast.success(data.message || "cloudflared instalado");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const startMutation = useMutation({
    mutationFn: () => vpsApi.tunnelStart(80),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["tunnel-status"] });
      if (data.url) {
        toast.success(`Tunnel activo: ${data.url}`);
      } else {
        toast.info("Iniciando túnel, espera unos segundos...");
      }
    },
    onError: (err: any) => toast.error(err.message),
  });

  const stopMutation = useMutation({
    mutationFn: () => vpsApi.tunnelStop(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tunnel-status"] });
      toast.success("Tunnel detenido");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const refreshMutation = useMutation({
    mutationFn: () => vpsApi.tunnelStatus(),
    onSuccess: (data) => {
      queryClient.setQueryData(["tunnel-status"], data);
      toast.info(`Estado: ${data.status || "desconocido"}`);
    },
    onError: (err: any) => toast.error(err.message),
  });

  // ─── Pro Config Save ───
  const savePaidMutation = useMutation({
    mutationFn: async () => {
      if (!mikrotikId || !user || !apiToken.trim()) throw new Error("Datos incompletos");
      await vpsApi.updateCloudflareConfig({
        mikrotik_id: mikrotikId,
        mode: "paid",
        api_token: apiToken,
        domain: domain || null,
        tunnel_name: tunnelName || null,
        is_active: true,
        created_by: user.id,
        id: config?.id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cloudflare-config", mikrotikId] });
      toast.success("Configuración Pro guardada");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const handleCopy = async (text: string) => {
    const copied = await copyToClipboard(text);
    if (copied) toast.success("Copiado al portapapeles");
    else toast.error("No se pudo copiar");
  };

  if (!mikrotikId) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Cloud className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p className="text-muted-foreground">Selecciona un dispositivo MikroTik primero</p>
        </CardContent>
      </Card>
    );
  }

  const isRunning = tunnelInfo?.status === "running" && tunnelInfo?.url;
  const isInstalled = tunnelInfo?.installed;
  const anyPending = installMutation.isPending || startMutation.isPending || stopMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Cloud className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <CardTitle>Cloudflare Tunnel</CardTitle>
              {isRunning && (
                <Badge variant="outline" className="text-xs border-green-500/30 text-green-600">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Activo
                </Badge>
              )}
            </div>
            <CardDescription>
              Expón tu portal cautivo con HTTPS via Cloudflare
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Active Tunnel Banner */}
        {isRunning && (
          <div className="p-4 rounded-lg border border-green-500/20 bg-green-500/5 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <span className="font-medium text-green-700 dark:text-green-400">Tunnel Activo</span>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm bg-background px-3 py-2 rounded border truncate">
                {tunnelInfo.url}
              </code>
              <Button variant="outline" size="icon" onClick={() => handleCopy(tunnelInfo.url)}>
                <Copy className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" asChild>
                <a href={tunnelInfo.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Configura el MikroTik Walled Garden para redirigir a esta URL
            </p>
          </div>
        )}

        {/* Portal URL */}
        <div className="p-4 rounded-lg border bg-muted/50 space-y-2">
          <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            URL Local del Portal
          </Label>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-sm bg-background px-3 py-2 rounded border truncate">
              {portalUrl}
            </code>
            <Button variant="outline" size="icon" onClick={() => handleCopy(portalUrl)}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <Tabs defaultValue="free" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="free" className="flex items-center gap-2">
              <Terminal className="h-4 w-4" />
              Quick Tunnel (Gratis)
            </TabsTrigger>
            <TabsTrigger value="paid" className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              API Token (Pro)
            </TabsTrigger>
          </TabsList>

          {/* ─── Quick Tunnel (estilo Stream Player Pro) ─── */}
          <TabsContent value="free" className="space-y-4">
            {/* Step 1: Install cloudflared */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Download className="h-4 w-4 text-muted-foreground" />
                <Label className="font-medium">Paso 1: Instalar cloudflared</Label>
                {isInstalled && (
                  <Badge variant="outline" className="text-xs text-green-600 border-green-500/30">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Instalado
                  </Badge>
                )}
              </div>
              <Button
                onClick={() => installMutation.mutate()}
                disabled={anyPending || isInstalled}
                variant="outline"
                className="w-full"
              >
                {installMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                {isInstalled ? "cloudflared ya instalado" : "Instalar cloudflared"}
              </Button>
            </div>

            {/* Step 2: Control Panel */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Cloud className="h-4 w-4 text-muted-foreground" />
                <Label className="font-medium">Paso 2: Controla el tunnel</Label>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  onClick={() => startMutation.mutate()}
                  disabled={anyPending || !!isRunning || !isInstalled}
                  className="w-full"
                >
                  {startMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-1" />
                  )}
                  Iniciar
                </Button>
                <Button
                  onClick={() => stopMutation.mutate()}
                  disabled={anyPending || !isRunning}
                  variant="destructive"
                  className="w-full"
                >
                  {stopMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Square className="h-4 w-4 mr-1" />
                  )}
                  Detener
                </Button>
                <Button
                  onClick={() => refreshMutation.mutate()}
                  disabled={refreshMutation.isPending}
                  variant="outline"
                  className="w-full"
                >
                  {refreshMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-1" />
                  )}
                  Estado
                </Button>
              </div>
            </div>

            {/* Status info */}
            {tunnelInfo?.error && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                  <p className="text-xs text-destructive">{tunnelInfo.error}</p>
                </div>
              </div>
            )}

            <div className="p-3 rounded-lg bg-muted/50 border">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>La URL del Quick Tunnel cambia si reinicias el proceso</p>
                  <p>No necesitas configurar IP ni puertos, todo se maneja automáticamente</p>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ─── Paid Token Tab ─── */}
          <TabsContent value="paid" className="space-y-4">
            <div className="p-4 rounded-lg border border-primary/20 bg-primary/5 space-y-3">
              <div className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-primary" />
                <span className="font-medium text-primary">Named Tunnel - Dominio Personalizado</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Usa tu propio dominio con HTTPS permanente. Requiere cuenta de Cloudflare y API Token.
              </p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>API Token de Cloudflare</Label>
                <Input type="password" value={apiToken} onChange={(e) => setApiToken(e.target.value)} placeholder="Tu API token" />
                <p className="text-xs text-muted-foreground">
                  Obtenlo en{" "}
                  <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                    dash.cloudflare.com <ExternalLink className="h-3 w-3" />
                  </a>
                </p>
              </div>
              <div className="space-y-2">
                <Label>Nombre del Tunnel</Label>
                <Input value={tunnelName} onChange={(e) => setTunnelName(e.target.value)} placeholder="omnisync-portal" />
              </div>
              <div className="space-y-2">
                <Label>Dominio personalizado</Label>
                <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="portal.tudominio.com" />
              </div>
            </div>
            <Button onClick={() => savePaidMutation.mutate()} disabled={savePaidMutation.isPending || !apiToken.trim()} className="w-full">
              {savePaidMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Key className="h-4 w-4 mr-2" />}
              Guardar configuración Pro
            </Button>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
