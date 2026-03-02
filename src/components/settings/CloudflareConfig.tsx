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
import {
  Cloud, Key, ExternalLink, Copy, CheckCircle2, AlertCircle,
  Loader2, Terminal, Globe, Play, Square, RefreshCw, Server, Download
} from "lucide-react";
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
  const [vpsIp, setVpsIp] = useState("");
  const [vpsPort, setVpsPort] = useState("3847");
  const [apiToken, setApiToken] = useState("");
  const [domain, setDomain] = useState("");
  const [tunnelName, setTunnelName] = useState("");

  const portalUrl = `${window.location.origin}/portal${mikrotikId ? `?id=${mikrotikId}` : ""}`;

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
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (config) {
      setVpsIp(config.agent_host || "");
      setVpsPort(String(config.agent_port || 3847));
      setApiToken(config.api_token || "");
      setDomain(config.domain || "");
      setTunnelName(config.tunnel_name || "");
    }
  }, [config]);

  // Save VPS config & generate install command
  const saveAgentConfigMutation = useMutation({
    mutationFn: async () => {
      if (!mikrotikId || !user) throw new Error("Missing data");
      if (!vpsIp.trim()) throw new Error("Ingresa la IP de tu VPS");

      const secret = config?.agent_secret || generateSecret();
      const payload = {
        mikrotik_id: mikrotikId,
        mode: "free",
        agent_host: vpsIp.trim(),
        agent_port: parseInt(vpsPort) || 3847,
        agent_secret: secret,
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

      return { secret, port: parseInt(vpsPort) || 3847 };
    },
    onSuccess: ({ secret, port }) => {
      queryClient.invalidateQueries({ queryKey: ["cloudflare-config", mikrotikId] });
      const script = buildAgentScript(secret, port);
      navigator.clipboard.writeText(script);
      toast.success("Script de instalación copiado. Pégalo en tu VPS una sola vez.");
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Call the agent via our edge function
  const agentActionMutation = useMutation({
    mutationFn: async (action: string) => {
      const { data, error } = await supabase.functions.invoke("cloudflare-tunnel-agent", {
        body: { mikrotik_id: mikrotikId, action },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data, action) => {
      queryClient.invalidateQueries({ queryKey: ["cloudflare-config", mikrotikId] });
      if (action === "start" && data?.url) {
        toast.success(`Tunnel activo: ${data.url}`);
      } else if (action === "stop") {
        toast.success("Tunnel detenido");
      } else if (action === "status") {
        toast.info(`Estado: ${data?.status || "desconocido"}`);
      }
    },
    onError: (err: any) => toast.error(err.message),
  });

  const buildAgentScript = useCallback((secret: string, port: number) => {
    return `#!/bin/bash
# ============================================
# OmniSync Agent - Instalador (una sola vez)
# ============================================
set -e

AGENT_PORT=${port}
AGENT_SECRET="${secret}"
PORTAL_URL="${portalUrl}"
INSTALL_DIR="/opt/omnisync-agent"

echo "🚀 Instalando OmniSync Agent..."

# 1. Instalar cloudflared
if ! command -v cloudflared &> /dev/null; then
  echo "📦 Instalando cloudflared..."
  curl -fsSL -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x /usr/local/bin/cloudflared
  echo "✅ cloudflared instalado"
else
  echo "✅ cloudflared ya instalado"
fi

# 2. Crear directorio del agente
mkdir -p $INSTALL_DIR

# 3. Crear el agente Python
cat > $INSTALL_DIR/agent.py << 'PYEOF'
#!/usr/bin/env python3
import http.server, json, subprocess, threading, os, signal, sys, re, time

PORT = int(os.environ.get("AGENT_PORT", "3847"))
SECRET = os.environ.get("AGENT_SECRET", "")
PORTAL_URL = os.environ.get("PORTAL_URL", "")

tunnel_process = None
tunnel_url = None
tunnel_status = "stopped"

def start_tunnel():
    global tunnel_process, tunnel_url, tunnel_status
    if tunnel_process and tunnel_process.poll() is None:
        return {"status": "running", "url": tunnel_url}

    tunnel_status = "starting"
    tunnel_url = None

    tunnel_process = subprocess.Popen(
        ["cloudflared", "tunnel", "--url", PORTAL_URL, "--no-autoupdate"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )

    # Read stderr in thread to capture URL
    def read_output():
        global tunnel_url, tunnel_status
        for line in tunnel_process.stderr:
            text = line.decode("utf-8", errors="ignore")
            match = re.search(r"https://[a-zA-Z0-9-]+\\.trycloudflare\\.com", text)
            if match and not tunnel_url:
                tunnel_url = match.group(0)
                tunnel_status = "running"
                print(f"🌐 Tunnel: {tunnel_url}")

    t = threading.Thread(target=read_output, daemon=True)
    t.start()

    # Wait up to 20s for URL
    for _ in range(20):
        time.sleep(1)
        if tunnel_url:
            return {"status": "running", "url": tunnel_url}

    return {"status": tunnel_status, "url": tunnel_url, "message": "Starting..."}

def stop_tunnel():
    global tunnel_process, tunnel_url, tunnel_status
    if tunnel_process:
        tunnel_process.terminate()
        try:
            tunnel_process.wait(timeout=5)
        except:
            tunnel_process.kill()
        tunnel_process = None
    tunnel_url = None
    tunnel_status = "stopped"
    # Also kill any leftover
    os.system("pkill -f 'cloudflared tunnel' 2>/dev/null || true")
    return {"status": "stopped"}

def get_status():
    global tunnel_process, tunnel_status, tunnel_url
    if tunnel_process and tunnel_process.poll() is not None:
        tunnel_status = "stopped"
        tunnel_url = None
        tunnel_process = None
    return {
        "status": tunnel_status,
        "url": tunnel_url,
        "cloudflared_installed": os.system("which cloudflared > /dev/null 2>&1") == 0
    }

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Silenciar logs

    def _check_auth(self):
        if self.headers.get("X-Agent-Secret") != SECRET:
            self.send_response(403)
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Forbidden"}).encode())
            return False
        return True

    def _respond(self, data, code=200):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_GET(self):
        if not self._check_auth(): return
        if self.path == "/status":
            self._respond(get_status())
        elif self.path == "/health":
            self._respond({"ok": True})
        else:
            self._respond({"error": "Not found"}, 404)

    def do_POST(self):
        if not self._check_auth(): return
        if self.path == "/start":
            self._respond(start_tunnel())
        elif self.path == "/stop":
            self._respond(stop_tunnel())
        elif self.path == "/install":
            installed = os.system("which cloudflared > /dev/null 2>&1") == 0
            if installed:
                self._respond({"success": True, "message": "Ya instalado"})
            else:
                os.system("curl -fsSL -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x /usr/local/bin/cloudflared")
                self._respond({"success": True, "message": "Instalado"})
        else:
            self._respond({"error": "Not found"}, 404)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

print(f"🟢 OmniSync Agent escuchando en puerto {PORT}")
http.server.HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
PYEOF

# 4. Crear archivo de entorno
cat > $INSTALL_DIR/.env << EOF
AGENT_PORT=$AGENT_PORT
AGENT_SECRET=$AGENT_SECRET
PORTAL_URL=$PORTAL_URL
EOF

# 5. Crear servicio systemd
cat > /etc/systemd/system/omnisync-agent.service << EOF
[Unit]
Description=OmniSync Cloudflare Tunnel Agent
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=/usr/bin/python3 $INSTALL_DIR/agent.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# 6. Activar e iniciar servicio
systemctl daemon-reload
systemctl enable omnisync-agent
systemctl restart omnisync-agent

echo ""
echo "✅ OmniSync Agent instalado y corriendo"
echo "   Puerto: $AGENT_PORT"
echo "   Estado: systemctl status omnisync-agent"
echo "   Logs:   journalctl -u omnisync-agent -f"
echo ""
echo "⚠️  Asegúrate de abrir el puerto $AGENT_PORT en tu firewall:"
echo "   sudo ufw allow $AGENT_PORT/tcp"
echo ""
echo "🎉 ¡Listo! Ahora puedes controlar el tunnel desde el panel de OmniSync"
`;
  }, [portalUrl]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copiado al portapapeles");
  };

  // Save paid config
  const savePaidMutation = useMutation({
    mutationFn: async () => {
      if (!mikrotikId || !user || !apiToken.trim()) throw new Error("Datos incompletos");
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
  const agentConfigured = config?.agent_host && config?.agent_secret;

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
                {config?.tunnel_url}
              </code>
              <Button variant="outline" size="icon" onClick={() => handleCopy(config?.tunnel_url || "")}>
                <Copy className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" asChild>
                <a href={config?.tunnel_url || ""} target="_blank" rel="noopener noreferrer">
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

          {/* Free Tunnel with Agent */}
          <TabsContent value="free" className="space-y-4">
            {/* Step 1: VPS IP */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-muted-foreground" />
                <Label className="font-medium">Paso 1: Configura tu VPS</Label>
              </div>
              <div className="grid grid-cols-[1fr,100px] gap-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">IP del VPS</Label>
                  <Input
                    value={vpsIp}
                    onChange={(e) => setVpsIp(e.target.value)}
                    placeholder="123.456.789.0"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Puerto</Label>
                  <Input
                    value={vpsPort}
                    onChange={(e) => setVpsPort(e.target.value)}
                    placeholder="3847"
                  />
                </div>
              </div>
            </div>

            {/* Step 2: Install Agent (one time) */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Download className="h-4 w-4 text-muted-foreground" />
                <Label className="font-medium">Paso 2: Instala el agente (una sola vez)</Label>
              </div>
              <Button
                onClick={() => saveAgentConfigMutation.mutate()}
                disabled={saveAgentConfigMutation.isPending || !vpsIp.trim()}
                variant="outline"
                className="w-full"
              >
                {saveAgentConfigMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Copy className="h-4 w-4 mr-2" />
                )}
                Copiar script de instalación
              </Button>
              <p className="text-xs text-muted-foreground">
                Pega el script en tu VPS y ejecútalo con <code className="bg-muted px-1 rounded">sudo bash</code>. Solo necesitas hacerlo <strong>una vez</strong>.
              </p>
            </div>

            {/* Step 3: Control Panel */}
            {agentConfigured && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Cloud className="h-4 w-4 text-muted-foreground" />
                  <Label className="font-medium">Paso 3: Controla el tunnel</Label>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    onClick={() => agentActionMutation.mutate("start")}
                    disabled={agentActionMutation.isPending || !!isRunning}
                    className="w-full"
                  >
                    {agentActionMutation.isPending && agentActionMutation.variables === "start" ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4 mr-1" />
                    )}
                    Iniciar
                  </Button>
                  <Button
                    onClick={() => agentActionMutation.mutate("stop")}
                    disabled={agentActionMutation.isPending || !isRunning}
                    variant="destructive"
                    className="w-full"
                  >
                    {agentActionMutation.isPending && agentActionMutation.variables === "stop" ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Square className="h-4 w-4 mr-1" />
                    )}
                    Detener
                  </Button>
                  <Button
                    onClick={() => agentActionMutation.mutate("status")}
                    disabled={agentActionMutation.isPending}
                    variant="outline"
                    className="w-full"
                  >
                    {agentActionMutation.isPending && agentActionMutation.variables === "status" ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-1" />
                    )}
                    Estado
                  </Button>
                </div>
              </div>
            )}

            <div className="p-3 rounded-lg bg-muted/50 border">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>⚠️ Asegúrate de abrir el puerto <strong>{vpsPort || "3847"}</strong> en el firewall del VPS</p>
                  <p>La URL del Quick Tunnel cambia si reinicias el proceso</p>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Paid Token Tab */}
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
