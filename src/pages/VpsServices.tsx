import { Sidebar } from "@/components/dashboard/Sidebar";
import { VpsServicesCard } from "@/components/dashboard/VpsServicesCard";
import { VpsDockerManager } from "@/components/settings/VpsDockerManager";
import { PortalAdsManager } from "@/components/portal/PortalAdsManager";
import { VpnManager } from "@/components/vpn/VpnManager";
import { MikrotikMapView } from "@/components/maps/MikrotikMapView";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Server, Megaphone, Shield, Map, Wifi, Info, ExternalLink, Monitor, Container, Radio } from "lucide-react";
import { useState, useEffect } from "react";
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
  const [mikhmonVersion, setMikhmonVersion] = useState("version-4");

  useEffect(() => {
    const host = window.location.hostname;
    setVpsHost(host);
    const url = `${window.location.protocol}//${host}/mikhmon/`;
    fetch(url, { mode: "no-cors" })
      .then(() => setMikhmonAvailable(true))
      .catch(() => setMikhmonAvailable(false));
  }, []);

  const mikhmonBaseUrl = `${window.location.protocol}//${vpsHost}/mikhmon/`;
  const mikhmonAppUrl = `${mikhmonBaseUrl}${mikhmonVersion}/`;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Wifi className="h-5 w-5" />
            Mikhmon — Hotspot Monitor
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Gestión avanzada de Hotspot MikroTik: vouchers, reportes, impresión térmica y más.
          </p>
          <FactoryCredentials user="mikhmon" pass="1234" />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={mikhmonVersion}
            onChange={(e) => setMikhmonVersion(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="version-3">V3</option>
            <option value="version-4">V4</option>
          </select>
          <Badge variant={mikhmonAvailable ? "default" : "secondary"}>
            {mikhmonAvailable === null ? "Verificando..." : mikhmonAvailable ? "Activo" : "No disponible"}
          </Badge>
          <Button variant="outline" size="sm" asChild>
            <a href={mikhmonAppUrl} target="_blank" rel="noopener noreferrer">
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
                Actívalo desde Servicios VPS → Docker → Servicios opcionales → Mikhmon → Iniciar
              </p>
            </div>
          </div>
        ) : (
          <iframe
            src={mikhmonAppUrl}
            className="w-full border-0 rounded-lg"
            style={{ height: "75vh" }}
            title="Mikhmon"
          />
        )}
      </CardContent>
    </Card>
  );
}

function GenieacsPanel() {
  const [vpsHost, setVpsHost] = useState("");
  const [acsAvailable, setAcsAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    const host = window.location.hostname;
    setVpsHost(host);
    fetch(`http://${host}:3001/`, { mode: "no-cors" })
      .then(() => setAcsAvailable(true))
      .catch(() => setAcsAvailable(false));
  }, []);

  const acsUrl = `http://${vpsHost}:3001`;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Monitor className="h-5 w-5" />
            GenieACS — Gestión ONU multi-marca (TR-069)
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Aprovisionamiento y configuración remota de ONUs Zyxel, V-SOL, Latic, Huawei, C-Data y cualquier CPE TR-069: WiFi, PPPoE, señal óptica y firmware.
          </p>
          <FactoryCredentials user="admin" pass="admin" label="GenieACS UI" />
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={acsAvailable ? "default" : "secondary"}>
            {acsAvailable === null ? "Verificando..." : acsAvailable ? "Activo" : "No disponible"}
          </Badge>
          <Button variant="outline" size="sm" asChild>
            <a href={acsUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-1" />
              Abrir GenieACS
            </a>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {acsAvailable === false ? (
          <div className="text-center py-12 space-y-4">
            <Monitor className="h-12 w-12 mx-auto text-muted-foreground" />
            <div>
              <p className="text-lg font-medium text-foreground">GenieACS no está activo</p>
              <p className="text-muted-foreground text-sm mt-1">Levántalo en tu VPS con:</p>
              <code className="block mt-2 bg-muted px-3 py-2 rounded text-xs font-mono">
                cd /opt/omnisync &amp;&amp; docker compose up -d mongo genieacs
              </code>
              <p className="text-muted-foreground text-xs mt-2">
                Las ONUs deben apuntar su ACS URL a <code className="bg-muted px-1 rounded">http://{vpsHost}:7547</code>
              </p>
            </div>
          </div>
        ) : (
          <iframe
            src={acsUrl}
            className="w-full border-0 rounded-lg"
            style={{ height: "75vh" }}
            title="GenieACS"
          />
        )}
      </CardContent>
    </Card>
  );
}


function CmsPanel() {
  const [vpsHost, setVpsHost] = useState("");
  const [cmsAvailable, setCmsAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    const host = window.location.hostname;
    setVpsHost(host);
    const url = `${window.location.protocol}//${host}/cms/`;
    fetch(url, { mode: "no-cors" })
      .then(() => setCmsAvailable(true))
      .catch(() => setCmsAvailable(false));
  }, []);

  const cmsUrl = `${window.location.protocol}//${vpsHost}/cms/`;
  const cmsExternalUrl = `http://${vpsHost}:18080`;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Radio className="h-5 w-5" />
            CMS C-Data — Gestión de OLT / ONU
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Administración de OLTs y ONUs C-Data: aprovisionamiento, perfiles, señal óptica y TR-069. El canal TR-069/MQTT se enlaza por el túnel WireGuard.
          </p>
          <FactoryCredentials user="root" pass="adminisp" label="CMS C-Data" />
          <Alert className="mt-3">
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              <strong>TR-069 por WireGuard:</strong> las ONUs deben apuntar a{" "}
              <code className="bg-muted px-1 rounded">http://10.13.13.1:9909/v1/acs</code> (MQTT{" "}
              <code className="bg-muted px-1 rounded">10.13.13.1:1883</code>), no a la IP pública.
            </AlertDescription>
          </Alert>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={cmsAvailable ? "default" : "secondary"}>
            {cmsAvailable === null ? "Verificando..." : cmsAvailable ? "Activo" : "No disponible"}
          </Badge>
          <Button variant="outline" size="sm" asChild>
            <a href={cmsExternalUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-1" />
              Abrir externo
            </a>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {cmsAvailable === false ? (
          <div className="text-center py-12 space-y-4">
            <Radio className="h-12 w-12 mx-auto text-muted-foreground" />
            <div>
              <p className="text-lg font-medium text-foreground">CMS C-Data no está activo</p>
              <p className="text-muted-foreground text-sm mt-1">
                Si no lo has instalado, ejecuta en tu VPS:
              </p>
              <code className="block mt-2 bg-muted px-3 py-2 rounded text-xs font-mono">
                bash /opt/omnisync/install-cms.sh
              </code>
              <p className="text-muted-foreground text-xs mt-2">
                Puertos: Web 18080 · MySQL 3307 · Redis 6380 · ACS 9909 · MQTT 1883.
              </p>
            </div>
          </div>
        ) : (
          <iframe
            src={cmsUrl}
            className="w-full border-0 rounded-lg"
            style={{ height: "75vh" }}
            title="CMS C-Data"
          />
        )}
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
            Gestión de servicios, VPN, GenieACS, Docker y publicidad.
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
            <TabsTrigger value="acs" className="gap-2">
              <Monitor className="h-4 w-4" />
              GenieACS
            </TabsTrigger>
            <TabsTrigger value="uisp" className="gap-2">
              <Radio className="h-4 w-4" />
              UISP
            </TabsTrigger>
            <TabsTrigger value="docker" className="gap-2">
              <Container className="h-4 w-4" />
              Docker
            </TabsTrigger>
            <TabsTrigger value="vpn" className="gap-2">
              <Shield className="h-4 w-4" />
              VPN
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

          <TabsContent value="acs">
            <GenieacsPanel />
          </TabsContent>

          <TabsContent value="uisp">
            <UispPanel />
          </TabsContent>

          <TabsContent value="docker">
            <VpsDockerManager mikrotikId={mikrotikId || null} />
          </TabsContent>

          <TabsContent value="vpn">
            <VpnManager />
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
