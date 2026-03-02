import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Cloud, Key, ExternalLink, Copy, CheckCircle2, AlertCircle, Shield, Loader2, Terminal, Globe, Play, Square, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface CloudflareConfigProps {
  mikrotikId: string | null;
}

function generateSecret() {
  return crypto.randomUUID().replace(/-/g, "");
}

export function CloudflareConfig({ mikrotikId }: CloudflareConfigProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [apiToken, setApiToken] = useState("");
  const [domain, setDomain] = useState("");
  const [tunnelName, setTunnelName] = useState("");
  const [copied, setCopied] = useState(false);

  const portalUrl = `${window.location.origin}/portal${mikrotikId ? `?id=${mikrotikId}` : ""}`;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

  const { data: config, isLoading } = useQuery({
    queryKey: ["cloudflare-config", mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return null;
      const { data, error } = await supabase
        .from("cloudflare_config")
        .select("*")
        .eq("mikrotik_id", mikrotikId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!mikrotikId,
    refetchInterval: 5000, // Poll every 5s to get tunnel URL updates from VPS
  });

  useEffect(() => {
    if (config) {
      setApiToken(config.api_token || "");
      setDomain(config.domain || "");
      setTunnelName(config.tunnel_name || "");
    }
  }, [config]);

  // Generate the script and save config with a callback secret
  const generateScriptMutation = useMutation({
    mutationFn: async () => {
      if (!mikrotikId || !user) throw new Error("Missing data");
      const secret = generateSecret();

      const payload = {
        mikrotik_id: mikrotikId,
        mode: "free",
        tunnel_id: secret, // Using tunnel_id to store the callback secret
        is_active: false,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      };

      if (config?.id) {
        const { error } = await supabase
          .from("cloudflare_config")
          .update(payload)
          .eq("id", config.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("cloudflare_config")
          .insert(payload);
        if (error) throw error;
      }

      return { secret };
    },
    onSuccess: ({ secret }) => {
      queryClient.invalidateQueries({ queryKey: ["cloudflare-config", mikrotikId] });
      const script = buildScript(secret);
      navigator.clipboard.writeText(script);
      toast.success("Script copiado al portapapeles. Pégalo y ejecútalo en tu VPS.");
    },
    onError: (err: any) => {
      toast.error("Error: " + err.message);
    },
  });

  const buildScript = useCallback((secret: string) => {
    const callbackUrl = `${supabaseUrl}/functions/v1/cloudflare-tunnel-callback`;
    const targetUrl = portalUrl;

    return `#!/bin/bash
# OmniSync - Cloudflare Tunnel Installer
# Ejecuta este script en tu VPS con Ubuntu

set -e

echo "🚀 OmniSync - Instalando Cloudflare Tunnel..."

# 1. Instalar cloudflared si no existe
if ! command -v cloudflared &> /dev/null; then
  echo "📦 Instalando cloudflared..."
  curl -fsSL -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x /usr/local/bin/cloudflared
  echo "✅ cloudflared instalado"
else
  echo "✅ cloudflared ya está instalado"
fi

# 2. Matar tunnels anteriores
pkill cloudflared 2>/dev/null || true
sleep 1

# 3. Iniciar Quick Tunnel en background
echo "🌐 Iniciando tunnel..."
cloudflared tunnel --url ${targetUrl} --no-autoupdate 2>&1 &
TUNNEL_PID=$!

# 4. Esperar y capturar la URL
TUNNEL_URL=""
for i in $(seq 1 30); do
  sleep 2
  TUNNEL_URL=$(cloudflared tunnel --url ${targetUrl} --no-autoupdate 2>&1 & sleep 5 && kill $! 2>/dev/null; wait $! 2>/dev/null || true)
  break
done

# Método alternativo: leer del proceso
sleep 8
TUNNEL_URL=$(curl -s http://localhost:45555/metrics 2>/dev/null | grep -oP 'https://[a-zA-Z0-9-]+\\.trycloudflare\\.com' | head -1 || true)

if [ -z "$TUNNEL_URL" ]; then
  # Buscar en los logs del proceso
  TUNNEL_URL=$(journalctl -u cloudflared --no-pager -n 20 2>/dev/null | grep -oP 'https://[a-zA-Z0-9-]+\\.trycloudflare\\.com' | head -1 || true)
fi

if [ -z "$TUNNEL_URL" ]; then
  # Último intento: leer de /tmp
  timeout 15 bash -c 'cloudflared tunnel --url ${targetUrl} --no-autoupdate 2>/tmp/cf_output &
  CF_PID=$!
  for i in $(seq 1 10); do
    sleep 2
    URL=$(grep -oP "https://[a-zA-Z0-9-]+\\.trycloudflare\\.com" /tmp/cf_output 2>/dev/null | head -1)
    if [ -n "$URL" ]; then
      echo "$URL" > /tmp/cf_url
      break
    fi
  done'
  TUNNEL_URL=$(cat /tmp/cf_url 2>/dev/null || true)
fi

# Reintentar con método limpio
pkill cloudflared 2>/dev/null || true
sleep 2

cloudflared tunnel --url ${targetUrl} --no-autoupdate 2>/tmp/cf_output &
CF_PID=$!

echo "⏳ Esperando URL del tunnel..."
for i in $(seq 1 15); do
  sleep 2
  TUNNEL_URL=$(grep -oP 'https://[a-zA-Z0-9-]+\\.trycloudflare\\.com' /tmp/cf_output 2>/dev/null | head -1)
  if [ -n "$TUNNEL_URL" ]; then
    break
  fi
done

if [ -z "$TUNNEL_URL" ]; then
  echo "❌ No se pudo obtener la URL del tunnel. Revisa manualmente."
  echo "   Ejecuta: cloudflared tunnel --url ${targetUrl}"
  exit 1
fi

echo "✅ Tunnel activo: $TUNNEL_URL"

# 5. Reportar URL al sistema
curl -s -X POST "${callbackUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{"mikrotik_id":"${mikrotikId}","tunnel_url":"'$TUNNEL_URL'","action":"report_url","secret":"${secret}"}'

echo ""
echo "🎉 ¡Listo! Tu portal cautivo está disponible en:"
echo "   $TUNNEL_URL"
echo ""
echo "📋 Configura tu MikroTik Walled Garden con esta URL"
echo "   El proceso está corriendo en background (PID: $CF_PID)"
echo "   Para detenerlo: kill $CF_PID"
`;
  }, [supabaseUrl, portalUrl, mikrotikId]);

  const savePaidMutation = useMutation({
    mutationFn: async () => {
      if (!mikrotikId || !user) throw new Error("Missing data");
      if (!apiToken.trim()) throw new Error("Ingresa el API Token");

      const payload = {
        mikrotik_id: mikrotikId,
        mode: "paid",
        api_token: apiToken,
        domain: domain || null,
        tunnel_name: tunnelName || null,
        is_active: true,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      };

      if (config?.id) {
        const { error } = await supabase.from("cloudflare_config").update(payload).eq("id", config.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("cloudflare_config").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cloudflare-config", mikrotikId] });
      toast.success("Configuración Pro guardada");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Copiado");
    setTimeout(() => setCopied(false), 2000);
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

  const isRunning = config?.is_active && config?.tunnel_url;

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
        {/* Active Tunnel Info */}
        {isRunning && (
          <div className="p-4 rounded-lg border border-green-500/20 bg-green-500/5 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <span className="font-medium text-green-700 dark:text-green-400">Tunnel Activo</span>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm bg-background px-3 py-2 rounded border truncate">
                {config.tunnel_url}
              </code>
              <Button variant="outline" size="icon" onClick={() => handleCopy(config.tunnel_url!)}>
                <Copy className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" asChild>
                <a href={config.tunnel_url!} target="_blank" rel="noopener noreferrer">
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

        <Tabs defaultValue={config?.mode || "free"} className="space-y-4">
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

          {/* Free Tunnel - One Button */}
          <TabsContent value="free" className="space-y-4">
            <div className="p-4 rounded-lg border border-green-500/20 bg-green-500/5 space-y-3">
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-green-600" />
                <span className="font-medium text-green-700 dark:text-green-400">
                  Quick Tunnel - Un solo comando
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Genera un script que instala cloudflared en tu VPS/Ubuntu, inicia el tunnel
                y reporta la URL automáticamente al sistema.
              </p>
            </div>

            <Button
              onClick={() => generateScriptMutation.mutate()}
              disabled={generateScriptMutation.isPending}
              className="w-full h-12 text-base"
              size="lg"
            >
              {generateScriptMutation.isPending ? (
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              ) : (
                <Play className="h-5 w-5 mr-2" />
              )}
              Generar Script de Instalación
            </Button>

            <div className="p-3 rounded-lg bg-muted/50 border">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="text-xs text-muted-foreground space-y-1">
                  <p><strong>1.</strong> Haz clic en el botón → se copia el script</p>
                  <p><strong>2.</strong> Pégalo en tu VPS: <code className="bg-background px-1 rounded">bash -c "$(xclip -o)"</code> o crea un archivo .sh</p>
                  <p><strong>3.</strong> La URL aparecerá aquí automáticamente ✨</p>
                  <p className="text-yellow-600 dark:text-yellow-400">⚠️ La URL cambia si reinicias el tunnel (modo gratis)</p>
                </div>
              </div>
            </div>

            {config?.tunnel_id && !isRunning && (
              <div className="flex items-center gap-2 p-3 rounded-lg border border-yellow-500/20 bg-yellow-500/5">
                <RefreshCw className="h-4 w-4 animate-spin text-yellow-600" />
                <span className="text-sm text-yellow-700 dark:text-yellow-400">
                  Esperando que el script reporte la URL del tunnel...
                </span>
              </div>
            )}
          </TabsContent>

          {/* Paid Token Tab */}
          <TabsContent value="paid" className="space-y-4">
            <div className="p-4 rounded-lg border border-primary/20 bg-primary/5 space-y-3">
              <div className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-primary" />
                <span className="font-medium text-primary">
                  Named Tunnel - Dominio Personalizado
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Usa tu propio dominio con HTTPS permanente.
                Requiere cuenta de Cloudflare y API Token.
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>API Token de Cloudflare</Label>
                <Input
                  type="password"
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  placeholder="Tu API token de Cloudflare"
                />
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

            <Button
              onClick={() => savePaidMutation.mutate()}
              disabled={savePaidMutation.isPending || !apiToken.trim()}
              className="w-full"
            >
              {savePaidMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Key className="h-4 w-4 mr-2" />
              )}
              Guardar configuración Pro
            </Button>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
