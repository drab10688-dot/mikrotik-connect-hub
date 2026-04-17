import { useState } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Radio, Users as UsersIcon, Layers, Activity, Server } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { radiusApi } from "@/lib/api-client";
import { RadiusUsersTab } from "@/components/radius/RadiusUsersTab";
import { RadiusGroupsTab } from "@/components/radius/RadiusGroupsTab";
import { RadiusSessionsTab } from "@/components/radius/RadiusSessionsTab";
import { RadiusNasTab } from "@/components/radius/RadiusNasTab";
import { RadiusTopConsumers } from "@/components/radius/RadiusTopConsumers";
import { RadiusClientMonitor } from "@/components/radius/RadiusClientMonitor";

export default function RadiusManager() {
  const [tab, setTab] = useState("users");
  const [monitorUser, setMonitorUser] = useState<string | null>(null);

  const { data: stats } = useQuery({
    queryKey: ["radius", "stats"],
    queryFn: radiusApi.stats,
    refetchInterval: 15000,
  });

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="md:ml-64 p-4 md:p-8">
        <div className="mb-6 flex items-center gap-3">
          <Radio className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">RADIUS Manager</h1>
            <p className="text-sm text-muted-foreground">
              Gestión centralizada estilo "User Manager" — usuarios, perfiles, sesiones y NAS
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <StatCard label="Usuarios" value={stats?.total_users ?? "—"} icon={UsersIcon} />
          <StatCard label="Perfiles" value={stats?.total_groups ?? "—"} icon={Layers} />
          <StatCard label="Sesiones activas" value={stats?.active_sessions ?? "—"} icon={Activity} />
          <StatCard label="NAS / Routers" value={stats?.total_nas ?? "—"} icon={Server} />
          <StatCard
            label="Tráfico 30d"
            value={formatBytes(Number(stats?.bytes_30d || 0))}
            icon={Radio}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Administración</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="grid grid-cols-2 md:grid-cols-4 w-full">
                  <TabsTrigger value="users">Usuarios</TabsTrigger>
                  <TabsTrigger value="groups">Perfiles</TabsTrigger>
                  <TabsTrigger value="sessions">Sesiones</TabsTrigger>
                  <TabsTrigger value="nas">NAS / Routers</TabsTrigger>
                </TabsList>
                <TabsContent value="users" className="mt-4">
                  <RadiusUsersTab />
                </TabsContent>
                <TabsContent value="groups" className="mt-4">
                  <RadiusGroupsTab />
                </TabsContent>
                <TabsContent value="sessions" className="mt-4">
                  <RadiusSessionsTab />
                </TabsContent>
                <TabsContent value="nas" className="mt-4">
                  <RadiusNasTab />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <div className="lg:col-span-1">
            <RadiusTopConsumers onSelectUser={setMonitorUser} />
          </div>
        </div>

        <RadiusClientMonitor
          username={monitorUser}
          open={!!monitorUser}
          onOpenChange={(o) => { if (!o) setMonitorUser(null); }}
        />
      </main>
    </div>
  );
}

function StatCard({ label, value, icon: Icon }: { label: string; value: any; icon: any }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="p-2 rounded-md bg-primary/10">
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-lg font-bold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}
