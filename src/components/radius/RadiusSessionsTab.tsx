import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { radiusApi } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Power, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

export function RadiusSessionsTab() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("active");
  const [search, setSearch] = useState("");

  const { data: active = [], refetch: refetchActive, isFetching: la } = useQuery({
    queryKey: ["radius", "sessions", "active"],
    queryFn: radiusApi.activeSessions,
    refetchInterval: 10000,
  });

  const { data: history = [], refetch: refetchHistory, isFetching: lh } = useQuery({
    queryKey: ["radius", "sessions", "history", search],
    queryFn: () => radiusApi.sessionHistory({ username: search }),
    enabled: tab === "history",
  });

  const disconnectMut = useMutation({
    mutationFn: (id: number) => radiusApi.disconnectSession(id),
    onSuccess: (r: any) => {
      toast.success(r?.note || "Sesión cerrada");
      qc.invalidateQueries({ queryKey: ["radius", "sessions"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <div className="flex items-center justify-between mb-3 gap-2">
        <TabsList>
          <TabsTrigger value="active">Activas</TabsTrigger>
          <TabsTrigger value="history">Historial</TabsTrigger>
        </TabsList>
        <Button
          size="sm"
          variant="outline"
          onClick={() => (tab === "active" ? refetchActive() : refetchHistory())}
          disabled={la || lh}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${(la || lh) ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      <TabsContent value="active">
        <div className="border rounded-md overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuario</TableHead>
                <TableHead>NAS</TableHead>
                <TableHead>IP asignada</TableHead>
                <TableHead>MAC / Caller</TableHead>
                <TableHead>Inicio</TableHead>
                <TableHead>Tiempo</TableHead>
                <TableHead>↓ / ↑</TableHead>
                <TableHead className="text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {active.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Sin sesiones activas</TableCell></TableRow>
              ) : active.map((s: any) => (
                <TableRow key={s.radacctid}>
                  <TableCell className="font-mono">{s.username}</TableCell>
                  <TableCell className="text-xs">{s.nasipaddress}</TableCell>
                  <TableCell className="text-xs">{s.framedipaddress}</TableCell>
                  <TableCell className="text-xs">{s.callingstationid}</TableCell>
                  <TableCell className="text-xs">{new Date(s.acctstarttime).toLocaleString()}</TableCell>
                  <TableCell>{formatDuration(s.acctsessiontime)}</TableCell>
                  <TableCell className="text-xs">
                    {formatBytes(Number(s.acctoutputoctets || 0))} / {formatBytes(Number(s.acctinputoctets || 0))}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm(`¿Cerrar sesión de ${s.username}?`)) disconnectMut.mutate(s.radacctid);
                      }}
                    >
                      <Power className="w-4 h-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </TabsContent>

      <TabsContent value="history">
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrar por usuario..."
            className="pl-9"
          />
        </div>
        <div className="border rounded-md overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuario</TableHead>
                <TableHead>NAS</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Inicio</TableHead>
                <TableHead>Fin</TableHead>
                <TableHead>Duración</TableHead>
                <TableHead>↓ / ↑</TableHead>
                <TableHead>Causa</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Sin historial</TableCell></TableRow>
              ) : history.map((s: any) => (
                <TableRow key={s.radacctid}>
                  <TableCell className="font-mono">{s.username}</TableCell>
                  <TableCell className="text-xs">{s.nasipaddress}</TableCell>
                  <TableCell className="text-xs">{s.framedipaddress}</TableCell>
                  <TableCell className="text-xs">{s.acctstarttime ? new Date(s.acctstarttime).toLocaleString() : "—"}</TableCell>
                  <TableCell className="text-xs">{s.acctstoptime ? new Date(s.acctstoptime).toLocaleString() : <Badge>activa</Badge>}</TableCell>
                  <TableCell>{formatDuration(s.acctsessiontime)}</TableCell>
                  <TableCell className="text-xs">
                    {formatBytes(Number(s.acctoutputoctets || 0))} / {formatBytes(Number(s.acctinputoctets || 0))}
                  </TableCell>
                  <TableCell className="text-xs">{s.acctterminatecause || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </TabsContent>
    </Tabs>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0; let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}
function formatDuration(s: number | null): string {
  if (!s) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}
