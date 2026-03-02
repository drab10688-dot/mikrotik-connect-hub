import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  ExternalLink, Server, Database, BarChart3, Wifi, CreditCard,
  Cloud, Globe, CheckCircle2, Settings2, Copy, Save
} from "lucide-react";
import { toast } from "sonner";

interface VpsService {
  name: string;
  description: string;
  port: number;
  subdomain: string;
  path?: string;
  icon: React.ElementType;
  color: string;
  defaultCreds?: string;
}

export function VpsServicesCard() {
  const [cloudflareDomain, setCloudflareDomain] = useState("");
  const [domainInput, setDomainInput] = useState("");
  const [useDomain, setUseDomain] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  const vpsIp = localStorage.getItem('vps_api_url')?.replace(/https?:\/\//, '').replace(/:\d+.*/, '')
    || localStorage.getItem('vps_ip')
    || window.location.hostname;

  useEffect(() => {
    const saved = localStorage.getItem('cloudflare_domain');
    const enabled = localStorage.getItem('cloudflare_domain_enabled') === 'true';
    if (saved) {
      setCloudflareDomain(saved);
      setDomainInput(saved);
      setUseDomain(enabled);
    }
  }, []);

  const services: VpsService[] = [
    {
      name: "OmniSync Panel",
      description: "Panel principal de gestión ISP",
      port: 80,
      subdomain: "panel",
      icon: Server,
      color: "text-primary",
    },
    {
      name: "API Backend",
      description: "API REST del servidor",
      port: 3000,
      subdomain: "api",
      path: "/api/health",
      icon: Database,
      color: "text-blue-500",
    },
    {
      name: "daloRADIUS",
      description: "Gestión RADIUS - Autenticación multi-vendedor",
      port: 8000,
      subdomain: "radius",
      icon: Wifi,
      color: "text-green-500",
      defaultCreds: "administrator / radius",
    },
    {
      name: "PHPNuxBill",
      description: "Billing Hotspot - Gestión de cobros",
      port: 8080,
      subdomain: "billing",
      icon: CreditCard,
      color: "text-amber-500",
    },
    {
      name: "Netdata",
      description: "Monitoreo del servidor en tiempo real",
      port: 19999,
      subdomain: "monitor",
      icon: BarChart3,
      color: "text-purple-500",
    },
  ];

  const getServiceUrl = (service: VpsService) => {
    if (useDomain && cloudflareDomain) {
      return `https://${service.subdomain}.${cloudflareDomain}${service.path || ''}`;
    }
    return `http://${vpsIp}:${service.port}${service.path || ''}`;
  };

  const openService = (service: VpsService) => {
    window.open(getServiceUrl(service), '_blank');
  };

  const saveDomain = () => {
    if (!domainInput.trim()) {
      toast.error("Ingresa un dominio válido");
      return;
    }
    const clean = domainInput.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    setCloudflareDomain(clean);
    setUseDomain(true);
    localStorage.setItem('cloudflare_domain', clean);
    localStorage.setItem('cloudflare_domain_enabled', 'true');
    toast.success("Dominio guardado. Los servicios ahora usan subdominios HTTPS.");
  };

  const toggleDomain = (enabled: boolean) => {
    setUseDomain(enabled);
    localStorage.setItem('cloudflare_domain_enabled', String(enabled));
    toast.info(enabled ? "Usando dominio Cloudflare" : "Usando IP directa");
  };

  const copyNginxConfig = () => {
    const config = services.map(s =>
      `# ${s.name}\nserver {\n    listen 80;\n    server_name ${s.subdomain}.${cloudflareDomain || 'tudominio.com'};\n    location / {\n        proxy_pass http://localhost:${s.port};\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n    }\n}\n`
    ).join('\n');
    navigator.clipboard.writeText(config);
    toast.success("Configuración Nginx copiada al portapapeles");
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              Servicios del Servidor
            </CardTitle>
            <CardDescription>
              Acceso rápido a todos los servicios instalados en el VPS
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowConfig(!showConfig)}
            className={showConfig ? "text-primary" : ""}
          >
            <Settings2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Cloudflare Domain Config */}
        {showConfig && (
          <div className="p-4 rounded-lg border border-primary/20 bg-primary/5 space-y-4">
            <div className="flex items-center gap-2">
              <Cloud className="h-5 w-5 text-primary" />
              <span className="font-medium">Dominio Cloudflare</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Configura un dominio de Cloudflare para acceder a todos los servicios vía HTTPS con subdominios 
              (ej: <code className="bg-muted px-1 rounded">radius.tudominio.com</code> en vez de <code className="bg-muted px-1 rounded">IP:8000</code>)
            </p>
            <div className="flex gap-2">
              <Input
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                placeholder="tudominio.com"
                className="flex-1"
              />
              <Button onClick={saveDomain} disabled={!domainInput.trim()}>
                <Save className="h-4 w-4 mr-1" />
                Guardar
              </Button>
            </div>

            {cloudflareDomain && (
              <>
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Usar dominio Cloudflare</Label>
                  <Switch checked={useDomain} onCheckedChange={toggleDomain} />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">Subdominios configurados:</Label>
                  <div className="grid grid-cols-1 gap-1">
                    {services.map(s => (
                      <div key={s.subdomain} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-background border">
                        <span className="font-mono">{s.subdomain}.{cloudflareDomain}</span>
                        <span className="text-muted-foreground">→ localhost:{s.port}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <Button variant="outline" size="sm" onClick={copyNginxConfig} className="w-full">
                  <Copy className="h-3 w-3 mr-2" />
                  Copiar configuración Nginx para el VPS
                </Button>
                <p className="text-[10px] text-muted-foreground">
                  ⚠️ Pega esta config en <code className="bg-muted px-1 rounded">/etc/nginx/conf.d/services.conf</code> de tu VPS y reinicia Nginx.
                  Luego en Cloudflare, agrega registros DNS tipo A para cada subdominio apuntando a la IP del VPS.
                </p>
              </>
            )}
          </div>
        )}

        {/* Active domain badge */}
        {useDomain && cloudflareDomain && !showConfig && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-green-500/10 border border-green-500/20">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <span className="text-xs text-green-700 dark:text-green-400">
              Usando <span className="font-mono font-medium">{cloudflareDomain}</span> vía Cloudflare
            </span>
            <Globe className="h-3 w-3 text-green-500 ml-auto" />
          </div>
        )}

        {/* Services Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {services.map((service) => (
            <button
              key={service.name}
              onClick={() => openService(service)}
              className="flex items-start gap-3 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors text-left group"
            >
              <div className={`mt-0.5 ${service.color}`}>
                <service.icon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm">{service.name}</p>
                  <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{service.description}</p>
                {useDomain && cloudflareDomain ? (
                  <Badge variant="outline" className="mt-1.5 text-[10px] font-mono border-green-500/30 text-green-600">
                    <Globe className="h-2.5 w-2.5 mr-1" />
                    {service.subdomain}.{cloudflareDomain}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="mt-1.5 text-[10px] font-mono">
                    :{service.port}
                  </Badge>
                )}
              </div>
            </button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          💡 {useDomain && cloudflareDomain
            ? `Servicios accesibles vía HTTPS en subdominios de ${cloudflareDomain}`
            : `Servicios en ${vpsIp}. Usa ⚙️ para configurar un dominio Cloudflare`
          }.
          {' '}Credenciales daloRADIUS: <span className="font-mono">administrator / radius</span>
        </p>
      </CardContent>
    </Card>
  );
}
