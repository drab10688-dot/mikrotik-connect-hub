import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Server, Database, BarChart3, Wifi, CreditCard } from "lucide-react";

interface VpsService {
  name: string;
  description: string;
  port: number;
  path?: string;
  icon: React.ElementType;
  color: string;
}

export function VpsServicesCard() {
  const vpsIp = localStorage.getItem('vps_api_url')?.replace(/https?:\/\//, '').replace(/:\d+.*/, '') 
    || localStorage.getItem('vps_ip')
    || window.location.hostname;

  const services: VpsService[] = [
    {
      name: "OmniSync Panel",
      description: "Panel principal de gestión ISP",
      port: 80,
      icon: Server,
      color: "text-primary",
    },
    {
      name: "API Backend",
      description: "API REST del servidor",
      port: 3000,
      path: "/api/health",
      icon: Database,
      color: "text-blue-500",
    },
    {
      name: "daloRADIUS",
      description: "Gestión RADIUS - Autenticación multi-vendedor",
      port: 8000,
      icon: Wifi,
      color: "text-green-500",
    },
    {
      name: "PHPNuxBill",
      description: "Billing Hotspot - Gestión de cobros",
      port: 8080,
      icon: CreditCard,
      color: "text-amber-500",
    },
    {
      name: "Netdata",
      description: "Monitoreo del servidor en tiempo real",
      port: 19999,
      icon: BarChart3,
      color: "text-purple-500",
    },
  ];

  const openService = (service: VpsService) => {
    const url = `http://${vpsIp}:${service.port}${service.path || ''}`;
    window.open(url, '_blank');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-5 w-5" />
          Servicios del Servidor
        </CardTitle>
        <CardDescription>
          Acceso rápido a todos los servicios instalados en el VPS
        </CardDescription>
      </CardHeader>
      <CardContent>
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
                <Badge variant="outline" className="mt-1.5 text-[10px] font-mono">
                  :{service.port}
                </Badge>
              </div>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-4">
          💡 Estos servicios están corriendo en <span className="font-mono">{vpsIp}</span>. 
          Credenciales por defecto de daloRADIUS: <span className="font-mono">administrator / radius</span>
        </p>
      </CardContent>
    </Card>
  );
}
