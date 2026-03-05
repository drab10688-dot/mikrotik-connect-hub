import { Sidebar } from "@/components/dashboard/Sidebar";
import { VpsServicesCard } from "@/components/dashboard/VpsServicesCard";
import { PortalAdsManager } from "@/components/portal/PortalAdsManager";
import { VpnManager } from "@/components/vpn/VpnManager";
import { AntennasDashboard } from "@/components/antennas/AntennasDashboard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Server, Megaphone, Shield, Radio } from "lucide-react";

export default function VpsServices() {
  const mikrotikId = localStorage.getItem("mikrotik_device_id") || undefined;

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="p-4 md:p-8 md:ml-64 space-y-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Servicios VPS</h1>
          <p className="text-muted-foreground">
            Gestión de servicios, VPN, antenas y publicidad.
          </p>
        </div>

        <Tabs defaultValue="services" className="space-y-4">
          <TabsList className="flex-wrap">
            <TabsTrigger value="services" className="gap-2">
              <Server className="h-4 w-4" />
              Servicios
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
          </TabsList>

          <TabsContent value="services">
            <VpsServicesCard mikrotikId={mikrotikId} />
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
        </Tabs>
      </div>
    </div>
  );
}
