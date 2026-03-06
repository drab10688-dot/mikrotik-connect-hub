import { Sidebar } from "@/components/dashboard/Sidebar";
import { VpsServicesCard } from "@/components/dashboard/VpsServicesCard";
import { PortalAdsManager } from "@/components/portal/PortalAdsManager";
import { VpnManager } from "@/components/vpn/VpnManager";
import { AntennasDashboard } from "@/components/antennas/AntennasDashboard";
import { MikrotikMapView } from "@/components/maps/MikrotikMapView";
import TR069Dashboard from "@/components/tr069/TR069Dashboard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Server, Megaphone, Shield, Radio, Map, Monitor } from "lucide-react";


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
          </TabsContent>

          <TabsContent value="tr069">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Monitor className="h-5 w-5 text-primary" />
                      GenieACS — Servidor TR-069
                    </CardTitle>
                    <CardDescription>
                      Panel de administración ACS para gestión remota de ONUs/CPEs
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={tr069Ready ? "default" : "destructive"}>
                      {tr069Ready ? "Activo" : "Inactivo"}
                    </Badge>
                    <Button variant="outline" size="sm" onClick={() => setTr069Fullscreen(!tr069Fullscreen)}>
                      {tr069Fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                    </Button>
                    <Button variant="outline" size="sm" asChild>
                      <a href={genieacsUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4 mr-1" />
                        Abrir
                      </a>
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-3 rounded-lg border border-accent bg-accent/30 space-y-2">
                  <div className="flex items-center gap-2 text-foreground">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm font-medium">Configuración TR-069 en la ONU</span>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p><strong>ACS URL:</strong> <code className="bg-background px-1 rounded">http://{vpsHost}:7547</code></p>
                    <p><strong>Periodic Inform:</strong> Enabled — Intervalo: 300 segundos</p>
                    <p><strong>Puerto CWMP:</strong> 7547 (debe estar abierto en el firewall)</p>
                  </div>
                </div>

                {!tr069Ready && (
                  <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/10 space-y-3">
                    <p className="text-sm text-destructive-foreground">
                      TR-069 está detenido o incompleto. Estado GenieACS: <strong>{tr069Status || "desconocido"}</strong>, MongoDB: <strong>{mongoStatus || "desconocido"}</strong>
                    </p>
                    <Button onClick={() => startTr069Mutation.mutate()} disabled={startTr069Mutation.isPending}>
                      {startTr069Mutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                      Iniciar TR-069
                    </Button>
                  </div>
                )}

                <div className={`rounded-lg border overflow-hidden ${tr069Fullscreen ? 'fixed inset-0 z-50 rounded-none bg-background' : ''}`}>
                  {tr069Fullscreen && (
                    <div className="flex items-center justify-between px-4 py-2 bg-card border-b">
                      <span className="text-sm font-medium">GenieACS</span>
                      <Button variant="ghost" size="sm" onClick={() => setTr069Fullscreen(false)}>
                        <Minimize2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                  <iframe
                    src={tr069Ready ? genieacsUrl : "about:blank"}
                    className={`w-full border-0 ${tr069Fullscreen ? 'h-[calc(100vh-41px)]' : 'h-[600px]'}`}
                    title="GenieACS TR-069"
                    sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                  />
                </div>
              </CardContent>
            </Card>
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
