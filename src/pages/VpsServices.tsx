import { Sidebar } from "@/components/dashboard/Sidebar";
import { VpsServicesCard } from "@/components/dashboard/VpsServicesCard";
import { PortalAdsManager } from "@/components/portal/PortalAdsManager";
import { VpnManager } from "@/components/vpn/VpnManager";
import { AntennasDashboard } from "@/components/antennas/AntennasDashboard";
import { MikrotikMapView } from "@/components/maps/MikrotikMapView";
import TR069Dashboard from "@/components/tr069/TR069Dashboard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Server, Megaphone, Shield, Radio, Map, Monitor, Wifi, Info, ExternalLink } from "lucide-react";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

function FactoryCredentials({ user, pass, label }: { user: string; pass: string; label?: string }) {
  return (
    <Alert className="mt-3">
      <Info className="h-4 w-4" />
      <AlertDescription className="text-xs">
        <strong>Credenciales de fábrica{label ? ` (${label})` : ""}:</strong> Usuario: <code className="bg-muted px-1 rounded">{user}</code> — Contraseña: <code className="bg-muted px-1 rounded">{pass}</code>
      </AlertDescription>
    </Alert>
  );
}

function MikhmonPanel() {
  const [vpsHost, setVpsHost] = useState("");
  const [mikhmonAvailable, setMikhmonAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    const host = window.location.hostname;
    setVpsHost(host);
    const url = `${window.location.protocol}//${host}/mikhmon/`;
    fetch(url, { mode: "no-cors" })
      .then(() => setMikhmonAvailable(true))
      .catch(() => setMikhmonAvailable(false));
  }, []);

  const mikhmonUrl = `${window.location.protocol}//${vpsHost}/mikhmon/`;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Wifi className="h-5 w-5" />
            Mikhmon V3 — Hotspot Monitor
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Gestión avanzada de Hotspot MikroTik: vouchers, reportes, impresión térmica y más.
          </p>
          <FactoryCredentials user="mikhmon" pass="1234" />
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={mikhmonAvailable ? "default" : "secondary"}>
            {mikhmonAvailable === null ? "Verificando..." : mikhmonAvailable ? "Activo" : "No disponible"}
          </Badge>
          <Button variant="outline" size="sm" asChild>
            <a href={mikhmonUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-1" />
              Abrir externo
            </a>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {mikhmonAvailable === false ? (
          <div className="text-center py-12 space-y-4">
            <Wifi className="h-12 w-12 mx-auto text-muted-foreground" />
            <div>
              <p className="text-lg font-medium text-foreground">Mikhmon no está activo</p>
              <p className="text-muted-foreground text-sm mt-1">
                Para activar Mikhmon V3, ejecute en su VPS:
              </p>
              <code className="block mt-3 bg-muted p-3 rounded text-sm font-mono">
                cd /opt/omnisync && docker compose --profile mikhmon up -d
              </code>
              <p className="text-muted-foreground text-xs mt-2">
                Luego recargue esta página.
              </p>
            </div>
          </div>
        ) : (
          <iframe
            src={mikhmonUrl}
            className="w-full border-0 rounded-lg"
            style={{ height: "75vh" }}
            title="Mikhmon V3"
          />
        )}
      </CardContent>
    </Card>
  );
}

function OnuManagementTab() {
  const navigate = useNavigate();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Radio className="h-5 w-5" />
          Gestión de ONUs
        </CardTitle>
        <CardDescription>
          Administración multi-marca de ONUs (ZTE, Huawei, Zyxel, Latic), monitoreo de señal óptica y configuración remota.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={() => navigate("/onu-management")} className="gap-2">
          <Radio className="h-4 w-4" />
          Abrir Gestión de ONUs
        </Button>
      </CardContent>
    </Card>
  );
}
export default function VpsServices() {
  const mikrotikId = localStorage.getItem("mikrotik_device_id") || undefined;

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="p-4 md:p-8 md:ml-64 space-y-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Servicios VPS</h1>
          <p className="text-muted-foreground">
            Gestión de servicios, VPN, TR-069, antenas y publicidad.
          </p>
        </div>

        <Tabs defaultValue="services" className="space-y-4">
          <TabsList className="flex-wrap">
            <TabsTrigger value="services" className="gap-2">
              <Server className="h-4 w-4" />
              Servicios
            </TabsTrigger>
            <TabsTrigger value="mikhmon" className="gap-2">
              <Wifi className="h-4 w-4" />
              Mikhmon
            </TabsTrigger>
            <TabsTrigger value="onus" className="gap-2">
              <Radio className="h-4 w-4" />
              ONUs
            </TabsTrigger>
            <TabsTrigger value="tr069" className="gap-2">
              <Monitor className="h-4 w-4" />
              TR-069
            </TabsTrigger>
            <TabsTrigger value="vpn" className="gap-2">
              <Shield className="h-4 w-4" />
              VPN
            </TabsTrigger>
            <TabsTrigger value="antennas" className="gap-2">
              <Radio className="h-4 w-4" />
              Antenas
            </TabsTrigger>
            <TabsTrigger value="ads" className="gap-2">
              <Megaphone className="h-4 w-4" />
              Publicidad
            </TabsTrigger>
            <TabsTrigger value="map" className="gap-2">
              <Map className="h-4 w-4" />
              Mapa
            </TabsTrigger>
          </TabsList>

          <TabsContent value="services">
            <VpsServicesCard mikrotikId={mikrotikId} />
            <FactoryCredentials user="admin@omnisync.local" pass="admin" label="Panel OmniSync" />
            <FactoryCredentials user="admin" pass="admin" label="PHPNuxBill" />
          </TabsContent>

          <TabsContent value="mikhmon">
            <MikhmonPanel />
          </TabsContent>

          <TabsContent value="onus">
            <OnuManagementTab />
          </TabsContent>

          <TabsContent value="tr069">
            <TR069Dashboard />
            <FactoryCredentials user="admin" pass="admin" label="GenieACS" />
          </TabsContent>

          <TabsContent value="vpn">
            <VpnManager />
          </TabsContent>

          <TabsContent value="antennas">
            <AntennasDashboard />
          </TabsContent>

          <TabsContent value="ads">
            <PortalAdsManager />
          </TabsContent>

          <TabsContent value="map">
            <MikrotikMapView />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
