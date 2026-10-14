import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { netAccessApi } from "@/lib/api-client";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NetworkMap } from "@/components/network/NetworkMap";
import { TopologyTree } from "@/components/network/TopologyTree";
import { AdvancedWeb, type AdvancedTarget } from "@/components/network/AdvancedWeb";
import { ApsPanel } from "@/components/network/ApsPanel";
import { useMyPermissions } from "@/hooks/usePermissions";
import { Network } from "lucide-react";

export default function Topology() {
  const navigate = useNavigate();
  const mikrotikId = localStorage.getItem("mikrotik_device_id") || "";
  const [advanced, setAdvanced] = useState<AdvancedTarget | null>(null);
  const [tab, setTab] = useState("mapa");
  // APs de torre (antes "APs / Señal" en Conexión MikroTik): permiso "Antenas y APs"
  const canAps = useMyPermissions().can("red");
  const proxyActive = tab === "avanzado" && Boolean(advanced);

  const { data: devicesData } = useQuery({
    queryKey: ["netaccess-devices", mikrotikId],
    queryFn: () => netAccessApi.devices(mikrotikId),
    enabled: !!mikrotikId && !proxyActive,
    refetchOnWindowFocus: false,
  });
  const devices = devicesData?.devices || [];

  const handleAdvanced = (device: AdvancedTarget) => {
    setAdvanced(device);
    setTab("avanzado");
  };

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="p-4 md:p-8 md:ml-64 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Network className="h-6 w-6 text-primary" /> Mapa de red
          </h1>
          <p className="text-sm text-muted-foreground">
            Topología por torres: MikroTik → torre → enlace PtP y sectores → clientes, con la señal de cada enlace.
            En "APs y señal" se detectan los APs, se guardan en el mapa y se ve la señal de sus clientes.
          </p>
        </header>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="mapa">Mapa</TabsTrigger>
            <TabsTrigger value="arbol">Árbol</TabsTrigger>
            {canAps && <TabsTrigger value="aps">APs y señal</TabsTrigger>}
            <TabsTrigger value="avanzado">Sistema avanzado</TabsTrigger>
          </TabsList>

          <TabsContent value="mapa" className="mt-4">
            <NetworkMap
              mikrotikId={mikrotikId}
              onAdvanced={handleAdvanced}
            />
          </TabsContent>

          <TabsContent value="arbol" className="mt-4">
            <TopologyTree
              mikrotikId={mikrotikId}
              onAdvanced={handleAdvanced}
            />
          </TabsContent>

          {canAps && (
            <TabsContent value="aps" className="mt-4">
              <ApsPanel deviceId={mikrotikId} />
            </TabsContent>
          )}

          <TabsContent value="avanzado" className="mt-4">
            <AdvancedWeb target={advanced} devices={devices} mikrotikId={mikrotikId} onSelect={setAdvanced} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
