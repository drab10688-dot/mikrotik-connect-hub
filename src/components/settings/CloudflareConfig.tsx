import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Cloud, Key, ExternalLink, Copy, CheckCircle2, AlertCircle, Shield, Loader2, Terminal, Globe } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface CloudflareConfigProps {
  mikrotikId: string | null;
}

export function CloudflareConfig({ mikrotikId }: CloudflareConfigProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [apiToken, setApiToken] = useState("");
  const [domain, setDomain] = useState("");
  const [tunnelName, setTunnelName] = useState("");
  const [copied, setCopied] = useState(false);

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
  });

  useEffect(() => {
    if (config) {
      setApiToken(config.api_token || "");
      setDomain(config.domain || "");
      setTunnelName(config.tunnel_name || "");
    }
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: async ({ mode, token, dom, name }: { mode: string; token?: string; dom?: string; name?: string }) => {
      if (!mikrotikId || !user) throw new Error("Missing data");

      const payload = {
        mikrotik_id: mikrotikId,
        mode,
        api_token: token || null,
        domain: dom || null,
        tunnel_name: name || null,
        is_active: true,
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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cloudflare-config", mikrotikId] });
      toast.success("Configuración de Cloudflare guardada");
    },
    onError: (err: any) => {
      toast.error("Error al guardar: " + err.message);
    },
  });

  const handleSaveFree = () => {
    saveMutation.mutate({ mode: "free" });
  };

  const handleSavePaid = () => {
    if (!apiToken.trim()) {
      toast.error("Ingresa el API Token de Cloudflare");
      return;
    }
    saveMutation.mutate({ mode: "paid", token: apiToken, dom: domain, name: tunnelName });
  };

  const handleCopyCommand = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopied(true);
    toast.success("Comando copiado");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyPortalUrl = () => {
    navigator.clipboard.writeText(portalUrl);
    toast.success("URL del portal copiada");
  };

  const quickTunnelCommand = `cloudflared tunnel --url ${portalUrl}`;
  const namedTunnelCommands = [
    `cloudflared tunnel create ${tunnelName || "omnisync-portal"}`,
    `cloudflared tunnel route dns ${tunnelName || "omnisync-portal"} ${domain || "portal.tudominio.com"}`,
    `cloudflared tunnel run ${tunnelName || "omnisync-portal"}`,
  ];

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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg" style={{ background: "hsl(38 92% 50% / 0.1)" }}>
            <Cloud className="h-6 w-6" style={{ color: "hsl(38 92% 50%)" }} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <CardTitle>Cloudflare Tunnel</CardTitle>
              {config?.is_active && (
                <Badge variant="outline" className="text-xs border-green-500/30 text-green-600">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Activo
                </Badge>
              )}
            </div>
            <CardDescription>
              Expón tu portal cautivo de forma segura con HTTPS a través de Cloudflare
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Portal URL */}
        <div className="p-4 rounded-lg border bg-muted/50 space-y-2">
          <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            URL del Portal Cautivo
          </Label>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-sm bg-background px-3 py-2 rounded border truncate">
              {portalUrl}
            </code>
            <Button variant="outline" size="icon" onClick={handleCopyPortalUrl}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Configura el MikroTik para redirigir a esta URL en el Walled Garden
          </p>
        </div>

        <Tabs defaultValue={config?.mode || "free"} className="space-y-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="free" className="flex items-center gap-2">
              <Terminal className="h-4 w-4" />
              Tunnel Gratis
            </TabsTrigger>
            <TabsTrigger value="paid" className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              API Token (Pro)
            </TabsTrigger>
          </TabsList>

          {/* Free Tunnel Tab */}
          <TabsContent value="free" className="space-y-4">
            <div className="p-4 rounded-lg border border-green-500/20 bg-green-500/5 space-y-3">
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-green-600" />
                <span className="font-medium text-green-700 dark:text-green-400">
                  Quick Tunnel - Gratis
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Cloudflare asigna una URL temporal con HTTPS automáticamente. 
                No requiere cuenta ni token. Ideal para pruebas rápidas.
              </p>
            </div>

            <div className="space-y-3">
              <Label className="text-sm font-medium">1. Instala cloudflared</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-muted px-3 py-2.5 rounded border font-mono overflow-x-auto">
                  curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared && chmod +x cloudflared
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() => handleCopyCommand("curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared && chmod +x cloudflared")}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-sm font-medium">2. Ejecuta el tunnel</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-muted px-3 py-2.5 rounded border font-mono overflow-x-auto">
                  {quickTunnelCommand}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() => handleCopyCommand(quickTunnelCommand)}
                >
                  {copied ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-muted/50 border">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>Cloudflare te dará una URL como <code className="bg-background px-1 rounded">https://abc123.trycloudflare.com</code></p>
                  <p>Configura el MikroTik Walled Garden para redirigir a esa URL</p>
                  <p>La URL cambia cada vez que reinicies el tunnel</p>
                </div>
              </div>
            </div>

            <Button onClick={handleSaveFree} disabled={saveMutation.isPending} className="w-full">
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              Marcar como configurado
            </Button>
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
                  <a
                    href="https://dash.cloudflare.com/profile/api-tokens"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    dash.cloudflare.com <ExternalLink className="h-3 w-3" />
                  </a>
                </p>
              </div>

              <div className="space-y-2">
                <Label>Nombre del Tunnel</Label>
                <Input
                  value={tunnelName}
                  onChange={(e) => setTunnelName(e.target.value)}
                  placeholder="omnisync-portal"
                />
              </div>

              <div className="space-y-2">
                <Label>Dominio personalizado</Label>
                <Input
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="portal.tudominio.com"
                />
              </div>
            </div>

            {apiToken && (
              <div className="space-y-3 pt-2">
                <Label className="text-sm font-medium">Comandos para configurar:</Label>
                {namedTunnelCommands.map((cmd, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-5 shrink-0">{i + 1}.</span>
                    <code className="flex-1 text-xs bg-muted px-3 py-2 rounded border font-mono overflow-x-auto">
                      {cmd}
                    </code>
                    <Button variant="ghost" size="icon" className="shrink-0" onClick={() => handleCopyCommand(cmd)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <Button onClick={handleSavePaid} disabled={saveMutation.isPending || !apiToken.trim()} className="w-full">
              {saveMutation.isPending ? (
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
