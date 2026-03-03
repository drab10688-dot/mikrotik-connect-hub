import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { vpsApi } from "@/lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  ExternalLink, Server, Database, BarChart3, Wifi, CreditCard,
  Cloud, Globe, CheckCircle2, Copy, Save, Settings2,
  Terminal, Key, Play, Square, RefreshCw, Download, Loader2,
  AlertCircle, Monitor, Palette
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { generateVpsInstallScript } from "@/lib/vps-install-script";
import { PortalTemplateSelector } from "@/components/settings/PortalTemplateSelector";

interface VpsServicesCardProps {
  mikrotikId?: string | null;
}

interface VpsService {
  name: string;
  description: string;
  port: number;
  subdomain: string;
  path?: string;
  proxyPath?: string;
  icon: React.ElementType;
  color: string;
  defaultCreds?: string;
}

function generateSecret() {
  return crypto.randomUUID().replace(/-/g, "");
}

export function VpsServicesCard({ mikrotikId }: VpsServicesCardProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Domain state
  const [cloudflareDomain, setCloudflareDomain] = useState("");
  const [domainInput, setDomainInput] = useState("");
  const [useDomain, setUseDomain] = useState(false);
  const [showDomainConfig, setShowDomainConfig] = useState(false);

  // Tunnel state
  const [vpsIp, setVpsIp] = useState("");
  const [vpsPort, setVpsPort] = useState("3847");
  const [apiToken, setApiToken] = useState("");
  const [domain, setDomain] = useState("");
  const [tunnelName, setTunnelName] = useState("");

  const vpsHost = localStorage.getItem('vps_api_url')?.replace(/https?:\/\//, '').replace(/:\d+.*/, '')
    || localStorage.getItem('vps_ip')
    || window.location.hostname;

  const portalUrl = `${window.location.origin}/portal`;

  // Load domain config
  useEffect(() => {
    const saved = localStorage.getItem('cloudflare_domain');
    const enabled = localStorage.getItem('cloudflare_domain_enabled') === 'true';
    if (saved) { setCloudflareDomain(saved); setDomainInput(saved); setUseDomain(enabled); }
  }, []);

  // Load Cloudflare tunnel config (works with or without mikrotikId)
  const cloudflareConfigId = mikrotikId || localStorage.getItem("vps_cloudflare_id") || "default";
  
  const { data: config } = useQuery({
    queryKey: ["cloudflare-config", cloudflareConfigId],
    queryFn: () => vpsApi.getCloudflareConfig(cloudflareConfigId),
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

  const services: VpsService[] = [
    { name: "OmniSync Panel", description: "Panel principal de gestión ISP", port: 80, subdomain: "panel", proxyPath: "/", icon: Server, color: "text-primary" },
    { name: "API Backend", description: "API REST del servidor", port: 3000, subdomain: "api", path: "/api/health", proxyPath: "/api/health", icon: Database, color: "text-blue-500" },
    { name: "daloRADIUS", description: "Gestión RADIUS - Auth multi-vendedor", port: 8000, subdomain: "radius", proxyPath: "/daloradius/", icon: Wifi, color: "text-green-500", defaultCreds: "administrator / radius" },
    { name: "PHPNuxBill", description: "Billing Hotspot - Gestión de cobros", port: 8080, subdomain: "billing", proxyPath: "/nuxbill/", icon: CreditCard, color: "text-amber-500" },
  ];

  const getServiceUrl = (service: VpsService) => {
    if (useDomain && cloudflareDomain) {
      return `https://${service.subdomain}.${cloudflareDomain}${service.path || ''}`;
    }

    const isSameHost = vpsHost === window.location.hostname;
    if (isSameHost && service.proxyPath) {
      return `${window.location.origin}${service.proxyPath}`;
    }

    return `http://${vpsHost}:${service.port}${service.path || ''}`;
  };

  // ─── Domain helpers ─────────────────────────────
  const saveDomain = () => {
    const clean = domainInput.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!clean) { toast.error("Ingresa un dominio válido"); return; }
    setCloudflareDomain(clean); setUseDomain(true);
    localStorage.setItem('cloudflare_domain', clean);
    localStorage.setItem('cloudflare_domain_enabled', 'true');
    toast.success("Dominio guardado");
  };

  const toggleDomain = (enabled: boolean) => {
    setUseDomain(enabled);
    localStorage.setItem('cloudflare_domain_enabled', String(enabled));
  };

  const copyNginxConfig = () => {
    const cfg = services.map(s =>
      `# ${s.name}\nserver {\n    listen 80;\n    server_name ${s.subdomain}.${cloudflareDomain};\n    location / {\n        proxy_pass http://localhost:${s.port};\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n    }\n}\n`
    ).join('\n');
    navigator.clipboard.writeText(cfg);
    toast.success("Config Nginx copiada");
  };

  // ─── Tunnel mutations ───────────────────────────
  const buildAgentScript = useCallback((secret: string, port: number) => {
    return generateVpsInstallScript({ secret, port, portalUrl });
  }, [portalUrl]);

  const saveAgentMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Falta datos");
      if (!vpsIp.trim()) throw new Error("Ingresa la IP de tu VPS");
      const effectiveId = mikrotikId || cloudflareConfigId;
      const secret = config?.agent_secret || generateSecret();
      await vpsApi.updateCloudflareConfig({
        id: config?.id, mikrotik_id: effectiveId, mode: "free",
        agent_host: vpsIp.trim(), agent_port: parseInt(vpsPort) || 3847,
        agent_secret: secret, created_by: user.id, updated_at: new Date().toISOString(),
      });
      return { secret, port: parseInt(vpsPort) || 3847 };
    },
    onSuccess: ({ secret, port }) => {
      queryClient.invalidateQueries({ queryKey: ["cloudflare-config", cloudflareConfigId] });
      navigator.clipboard.writeText(buildAgentScript(secret, port));
      toast.success("Script copiado. Pégalo en tu VPS.");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const agentActionMutation = useMutation({
    mutationFn: (action: string) => vpsApi.tunnelAgent(cloudflareConfigId, action),
    onSuccess: (data, action) => {
      queryClient.invalidateQueries({ queryKey: ["cloudflare-config", cloudflareConfigId] });
      if (action === "start" && data?.url) toast.success(`Tunnel activo: ${data.url}`);
      else if (action === "stop") toast.success("Tunnel detenido");
      else if (action === "status") toast.info(`Estado: ${data?.status || "desconocido"}`);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const savePaidMutation = useMutation({
    mutationFn: async () => {
      if (!user || !apiToken.trim()) throw new Error("Datos incompletos");
      const effectiveId = mikrotikId || cloudflareConfigId;
      await vpsApi.updateCloudflareConfig({
        id: config?.id, mikrotik_id: effectiveId, mode: "paid",
        api_token: apiToken, domain: domain || null, tunnel_name: tunnelName || null,
        is_active: true, created_by: user.id, updated_at: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cloudflare-config", cloudflareConfigId] });
      toast.success("Config Pro guardada");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const isRunning = config?.is_active && config?.tunnel_url;
  const agentConfigured = config?.agent_host && config?.agent_secret;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-5 w-5" />
          Servicios del Servidor
        </CardTitle>
        <CardDescription>Gestión de servicios VPS, Cloudflare Tunnel y Portal Cautivo</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="services" className="space-y-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="services" className="flex items-center gap-1.5 text-xs">
              <Server className="h-3.5 w-3.5" />
              Servicios
            </TabsTrigger>
            <TabsTrigger value="cloudflare" className="flex items-center gap-1.5 text-xs">
              <Cloud className="h-3.5 w-3.5" />
              Cloudflare
              {isRunning && <span className="w-2 h-2 rounded-full bg-green-500" />}
            </TabsTrigger>
            <TabsTrigger value="portal" className="flex items-center gap-1.5 text-xs">
              <Globe className="h-3.5 w-3.5" />
              Portal
            </TabsTrigger>
            <TabsTrigger value="templates" className="flex items-center gap-1.5 text-xs">
              <Palette className="h-3.5 w-3.5" />
              Diseños
            </TabsTrigger>
          </TabsList>

          {/* ═══ TAB: SERVICIOS ═══ */}
          <TabsContent value="services" className="space-y-4">
            {/* Domain toggle */}
            <div className="flex items-center justify-between">
              {useDomain && cloudflareDomain ? (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="text-xs font-mono">{cloudflareDomain}</span>
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">Usando IP: {vpsHost}</span>
              )}
              <Button variant="ghost" size="sm" onClick={() => setShowDomainConfig(!showDomainConfig)}>
                <Settings2 className="h-3.5 w-3.5 mr-1" />
                <span className="text-xs">Dominio</span>
              </Button>
            </div>

            {showDomainConfig && (
              <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Configura un dominio Cloudflare para acceder vía subdominios HTTPS
                </p>
                <div className="flex gap-2">
                  <Input value={domainInput} onChange={(e) => setDomainInput(e.target.value)} placeholder="tudominio.com" className="flex-1 h-8 text-sm" />
                  <Button onClick={saveDomain} size="sm" disabled={!domainInput.trim()}>
                    <Save className="h-3 w-3 mr-1" />Guardar
                  </Button>
                </div>
                {cloudflareDomain && (
                  <>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Usar subdominios HTTPS</Label>
                      <Switch checked={useDomain} onCheckedChange={toggleDomain} />
                    </div>
                    <Button variant="outline" size="sm" onClick={copyNginxConfig} className="w-full">
                      <Copy className="h-3 w-3 mr-1" />Copiar config Nginx
                    </Button>
                    <div className="grid grid-cols-1 gap-1">
                      {services.map(s => (
                        <div key={s.subdomain} className="flex items-center justify-between text-[10px] py-0.5 px-2 rounded bg-background border">
                          <span className="font-mono">{s.subdomain}.{cloudflareDomain}</span>
                          <span className="text-muted-foreground">→ :{s.port}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Services grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {services.map((service) => (
                <button key={service.name} onClick={() => window.open(getServiceUrl(service), '_blank')}
                  className="flex items-start gap-3 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors text-left group">
                  <div className={`mt-0.5 ${service.color}`}><service.icon className="h-5 w-5" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{service.name}</p>
                      <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{service.description}</p>
                    {useDomain && cloudflareDomain ? (
                      <Badge variant="outline" className="mt-1.5 text-[10px] font-mono border-green-500/30 text-green-600">
                        <Globe className="h-2.5 w-2.5 mr-1" />{service.subdomain}.{cloudflareDomain}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="mt-1.5 text-[10px] font-mono">:{service.port}</Badge>
                    )}
                    {service.defaultCreds && (
                      <p className="text-[10px] text-muted-foreground mt-1">🔑 {service.defaultCreds}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </TabsContent>

          {/* ═══ TAB: CLOUDFLARE TUNNEL ═══ */}
          <TabsContent value="cloudflare" className="space-y-4">
              <>
                {/* Active tunnel banner */}
                {isRunning && (
                  <div className="p-3 rounded-lg border border-green-500/20 bg-green-500/5 space-y-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <span className="font-medium text-sm text-green-700 dark:text-green-400">Tunnel Activo</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs bg-background px-2 py-1.5 rounded border truncate">{config?.tunnel_url}</code>
                      <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => { navigator.clipboard.writeText(config?.tunnel_url || ""); toast.success("Copiado"); }}>
                        <Copy className="h-3 w-3" />
                      </Button>
                      <Button variant="outline" size="icon" className="h-7 w-7" asChild>
                        <a href={config?.tunnel_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3 w-3" /></a>
                      </Button>
                    </div>
                  </div>
                )}

                <Tabs defaultValue={config?.mode || "free"} className="space-y-3">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="free" className="text-xs"><Terminal className="h-3.5 w-3.5 mr-1" />Quick Tunnel (Gratis)</TabsTrigger>
                    <TabsTrigger value="paid" className="text-xs"><Key className="h-3.5 w-3.5 mr-1" />API Token (Pro)</TabsTrigger>
                  </TabsList>

                  {/* Free tunnel */}
                  <TabsContent value="free" className="space-y-3">
                    <div className="space-y-2">
                      <Label className="text-xs font-medium">Paso 1: IP del VPS</Label>
                      <div className="grid grid-cols-[1fr,80px] gap-2">
                        <Input value={vpsIp} onChange={(e) => setVpsIp(e.target.value)} placeholder="123.456.789.0" className="h-8 text-sm" />
                        <Input value={vpsPort} onChange={(e) => setVpsPort(e.target.value)} placeholder="3847" className="h-8 text-sm" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-medium">Paso 2: Instalar agente</Label>
                      <Button onClick={() => saveAgentMutation.mutate()} disabled={saveAgentMutation.isPending || !vpsIp.trim()} variant="outline" size="sm" className="w-full">
                        {saveAgentMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
                        Copiar script de instalación
                      </Button>
                    </div>
                    {agentConfigured && (
                      <div className="space-y-2">
                        <Label className="text-xs font-medium">Paso 3: Control</Label>
                        <div className="grid grid-cols-3 gap-2">
                          <Button size="sm" onClick={() => agentActionMutation.mutate("start")} disabled={agentActionMutation.isPending || !!isRunning}>
                            {agentActionMutation.isPending && agentActionMutation.variables === "start" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                            Iniciar
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => agentActionMutation.mutate("stop")} disabled={agentActionMutation.isPending || !isRunning}>
                            {agentActionMutation.isPending && agentActionMutation.variables === "stop" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5 mr-1" />}
                            Detener
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => agentActionMutation.mutate("status")} disabled={agentActionMutation.isPending}>
                            {agentActionMutation.isPending && agentActionMutation.variables === "status" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                            Estado
                          </Button>
                        </div>
                      </div>
                    )}
                    <p className="text-[10px] text-muted-foreground">⚠️ Abre el puerto {vpsPort || "3847"} en el firewall. La URL del Quick Tunnel cambia al reiniciar.</p>
                  </TabsContent>

                  {/* Paid tunnel */}
                  <TabsContent value="paid" className="space-y-3">
                    <div className="p-3 rounded-lg border border-primary/20 bg-primary/5">
                      <div className="flex items-center gap-2 mb-1">
                        <Globe className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium text-primary">Named Tunnel - Dominio Personalizado</span>
                      </div>
                      <p className="text-xs text-muted-foreground">HTTPS permanente con tu propio dominio.</p>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">API Token de Cloudflare</Label>
                      <Input type="password" value={apiToken} onChange={(e) => setApiToken(e.target.value)} placeholder="Tu API token" className="h-8 text-sm" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Nombre del Tunnel</Label>
                      <Input value={tunnelName} onChange={(e) => setTunnelName(e.target.value)} placeholder="omnisync-portal" className="h-8 text-sm" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Dominio personalizado</Label>
                      <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="portal.tudominio.com" className="h-8 text-sm" />
                    </div>
                    <Button onClick={() => savePaidMutation.mutate()} disabled={savePaidMutation.isPending || !apiToken.trim()} size="sm" className="w-full">
                      {savePaidMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Key className="h-3.5 w-3.5 mr-1" />}
                      Guardar configuración Pro
                    </Button>
                  </TabsContent>
                </Tabs>
              </>
          </TabsContent>

          {/* ═══ TAB: PORTAL CAUTIVO ═══ */}
          <TabsContent value="portal" className="space-y-4">
            <div className="p-4 rounded-lg border bg-muted/50 space-y-3">
              <div className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-primary" />
                <span className="font-medium">Portal de Acceso WiFi</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Portal cautivo HTTPS donde los clientes inician sesión para acceder a Internet.
                Al activar el tunnel de Cloudflare se genera una URL HTTPS segura automáticamente.
              </p>

              {/* Portal URL */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">URL Local del Portal</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-background px-3 py-2 rounded border truncate">{portalUrl}</code>
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => { navigator.clipboard.writeText(portalUrl); toast.success("URL copiada"); }}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Tunnel URL if active */}
              {isRunning && config?.tunnel_url && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                    🔒 URL HTTPS (Cloudflare Tunnel)
                  </Label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-background px-3 py-2 rounded border truncate text-green-600">{config.tunnel_url}</code>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => { navigator.clipboard.writeText(config.tunnel_url); toast.success("URL copiada"); }}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <p className="text-[10px] text-green-600 font-medium">
                    ✅ HTTPS activo — Usa esta URL en el MikroTik
                  </p>
                </div>
              )}

              {/* MikroTik Configuration Guide */}
              <div className="p-3 rounded-lg bg-background border space-y-3">
                <p className="text-xs font-medium flex items-center gap-1.5">
                  <Terminal className="h-3.5 w-3.5" />
                  Configuración en MikroTik (Terminal)
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Copia y pega estos comandos en la terminal de tu MikroTik para redirigir a los clientes al portal:
                </p>
                
                {/* Script 1: Walled Garden */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px] font-medium text-muted-foreground">1. Walled Garden (permitir acceso al portal)</Label>
                    <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => {
                      const vpsIpLocal = vpsHost || "TU_IP_VPS";
                      const script = `/ip hotspot walled-garden\nadd dst-host=${vpsIpLocal} action=allow comment="OmniSync Portal"\nadd dst-host=*.trycloudflare.com action=allow comment="Cloudflare Tunnel HTTPS"`;
                      navigator.clipboard.writeText(script);
                      toast.success("Script Walled Garden copiado");
                    }}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                  <pre className="text-[10px] bg-muted p-2 rounded border overflow-x-auto whitespace-pre font-mono">
{`/ip hotspot walled-garden
add dst-host=${vpsHost || "TU_IP_VPS"} action=allow comment="OmniSync Portal"
add dst-host=*.trycloudflare.com action=allow comment="Cloudflare Tunnel HTTPS"`}
                  </pre>
                </div>

                {/* Script 2: Walled Garden IP List */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px] font-medium text-muted-foreground">2. Walled Garden IP List (permitir IP del VPS)</Label>
                    <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => {
                      const vpsIpLocal = vpsHost || "TU_IP_VPS";
                      const script = `/ip hotspot walled-garden ip\nadd dst-address=${vpsIpLocal} action=accept comment="OmniSync VPS"`;
                      navigator.clipboard.writeText(script);
                      toast.success("Script IP List copiado");
                    }}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                  <pre className="text-[10px] bg-muted p-2 rounded border overflow-x-auto whitespace-pre font-mono">
{`/ip hotspot walled-garden ip
add dst-address=${vpsHost || "TU_IP_VPS"} action=accept comment="OmniSync VPS"`}
                  </pre>
                </div>

                {/* Script 3: Login Page */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px] font-medium text-muted-foreground">3. Login Page (redirigir al portal)</Label>
                    <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => {
                      const loginUrl = isRunning && config?.tunnel_url ? config.tunnel_url + "/portal" : `http://${vpsHost || "TU_IP_VPS"}/portal`;
                      const script = `/ip hotspot profile set [find default=yes] login-by=http-chap,http-pap html-directory=hotspot login-page="${loginUrl}"`;
                      navigator.clipboard.writeText(script);
                      toast.success("Script Login Page copiado");
                    }}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                  <pre className="text-[10px] bg-muted p-2 rounded border overflow-x-auto whitespace-pre font-mono">
{`/ip hotspot profile set [find default=yes] \\
  login-by=http-chap,http-pap \\
  html-directory=hotspot \\
  login-page="${isRunning && config?.tunnel_url ? config.tunnel_url + "/portal" : `http://${vpsHost || "TU_IP_VPS"}/portal`}"`}
                  </pre>
                </div>

                {/* Script 4: DNS */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px] font-medium text-muted-foreground">4. DNS estático (opcional, mejor rendimiento)</Label>
                    <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => {
                      const vpsIpLocal = vpsHost || "TU_IP_VPS";
                      const script = `/ip dns static\nadd name=portal.omnisync.local address=${vpsIpLocal} comment="OmniSync Portal"`;
                      navigator.clipboard.writeText(script);
                      toast.success("Script DNS copiado");
                    }}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                  <pre className="text-[10px] bg-muted p-2 rounded border overflow-x-auto whitespace-pre font-mono">
{`/ip dns static
add name=portal.omnisync.local address=${vpsHost || "TU_IP_VPS"} comment="OmniSync Portal"`}
                  </pre>
                </div>
              </div>

              {/* Quick note */}
              <div className="p-2 rounded-lg border border-primary/20 bg-primary/5">
                <p className="text-[10px] text-muted-foreground">
                  <strong>💡 Tip:</strong> Activa el Cloudflare Tunnel en la pestaña "Cloudflare" para obtener una URL HTTPS 
                  automática. Luego los scripts de arriba se actualizarán con la URL segura.
                </p>
              </div>

              {/* Open portal preview */}
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" asChild>
                  <a href={portalUrl} target="_blank" rel="noopener noreferrer">
                    <Monitor className="h-3.5 w-3.5 mr-1" />
                    Vista previa del Portal
                  </a>
                </Button>
                {isRunning && config?.tunnel_url && (
                  <Button size="sm" className="flex-1" asChild>
                    <a href={config.tunnel_url} target="_blank" rel="noopener noreferrer">
                      <Globe className="h-3.5 w-3.5 mr-1" />
                      Abrir vía HTTPS
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ═══ TAB: DISEÑOS / PLANTILLAS ═══ */}
          <TabsContent value="templates">
            <PortalTemplateSelector />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
