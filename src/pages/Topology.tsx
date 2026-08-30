import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NetworkMap } from "@/components/network/NetworkMap";
import { TopologyTree } from "@/components/network/TopologyTree";
import { AdvancedWeb } from "@/components/network/AdvancedWeb";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";

export default function Topology() {
  const navigate = useNavigate();
  const mikrotikId = localStorage.getItem("mikrotik_device_id") || "";
  const [advanced, setAdvanced] = useState<{ ip: string; name: string; proxy_path: string } | null>(null);
  const [tab, setTab] = useState("mapa");

  const handleAdvanced = (device: { ip: string; name: string; proxy_path: string }) => {
    setAdvanced(device);
    setTab("avanzado");
  };

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Mapa de red</h1>
          <p className="text-sm text-muted-foreground">
            Topología por sectores: MikroTik → AP/antena → cliente, con la señal de cada enlace.
          </p>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="mapa">Mapa</TabsTrigger>
            <TabsTrigger value="arbol">Árbol</TabsTrigger>
            <TabsTrigger value="avanzado">Sistema avanzado</TabsTrigger>
          </TabsList>

          <TabsContent value="mapa" className="mt-4">
            <NetworkMap
              mikrotikId={mikrotikId}
              onManage={(ip) => navigate(`/onu-web?ip=${encodeURIComponent(ip)}`)}
              onAdvanced={handleAdvanced}
            />
          </TabsContent>

          <TabsContent value="arbol" className="mt-4">
            <TopologyTree
              mikrotikId={mikrotikId}
              onManage={(ip) => navigate(`/onu-web?ip=${encodeURIComponent(ip)}`)}
              onAdvanced={handleAdvanced}
            />
          </TabsContent>

          <TabsContent value="avanzado" className="mt-4">
            <AdvancedWeb initialDevice={advanced ?? undefined} />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
