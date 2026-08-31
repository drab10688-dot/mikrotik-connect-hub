import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { devicesApi, netAccessApi } from "@/lib/api-client";
import { Gauge, ArrowDown, ArrowUp, Search, RefreshCw, Users } from "lucide-react";

interface QueueRow {
  id: string;
  name: string;
  client: string;
  target: string;
  profile: string | null;
  uptime: string | null;
  online: boolean;
  dynamic: boolean;
  disabled: boolean;
  max_upload_bps: number;
  max_download_bps: number;
  upload_bps: number;
  download_bps: number;
  total_upload_bytes: number;
  total_download_bytes: number;
}

const bps = (v: number) => {
  if (!v || v < 1000) return `${Math.round(v || 0)} bps`;
  if (v < 1_000_000) return `${(v / 1000).toFixed(0)} Kbps`;
  return `${(v / 1_000_000).toFixed(2)} Mbps`;
};

const bytes = (v: number) => {
  if (!v) return "0 B";
  if (v < 1024 ** 2) return `${(v / 1024).toFixed(0)} KB`;
  if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(1)} MB`;
  return `${(v / 1024 ** 3).toFixed(2)} GB`;
};

const usage = (rate: number, max: number) => (max > 0 ? Math.min(100, (rate / max) * 100) : 0);

export default function Queues() {
  const [deviceId, setDeviceId] = useState<string>(() => localStorage.getItem("mikrotik_device_id") || "");
  const [search, setSearch] = useState("");
  const [live, setLive] = useState(true);

  const { data: devices = [] } = useQuery({ queryKey: ["queue-devices"], queryFn: () => devicesApi.list() });

  useEffect(() => {
    if (!deviceId && devices.length) setDeviceId(devices[0].id);
  }, [devices, deviceId]);

  const { data = [], isLoading, isFetching, refetch } = useQuery<QueueRow[]>({
    queryKey: ["net-queues", deviceId],
    queryFn: () => netAccessApi.queues(deviceId),
    enabled: !!deviceId,
    refetchInterval: live ? 4000 : false,
    refetchOnWindowFocus: false,
    placeholderData: (prev: any) => prev,
  });

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return data;
    return data.filter((r) =>
      [r.client, r.name, r.target, r.profile].filter(Boolean).join(" ").toLowerCase().includes(term)
    );
  }, [data, search]);

  const totalDown = data.reduce((acc, r) => acc + r.download_bps, 0);
  const totalUp = data.reduce((acc, r) => acc + r.upload_bps, 0);
  const activos = data.filter((r) => r.download_bps + r.upload_bps > 0).length;

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="p-4 md:p-8 md:ml-64">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Gauge className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-foreground">Consumo en vivo</h1>
              <p className="text-muted-foreground">
                Colas simples de la MikroTik: caudal real de cada cliente PPPoE.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={deviceId} onValueChange={setDeviceId}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Router" />
              </SelectTrigger>
              <SelectContent>
                {devices.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant={live ? "default" : "outline"} size="sm" onClick={() => setLive((v) => !v)}>
              {live ? "En vivo" : "Pausado"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </header>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <Card><CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Bajada total</p>
            <p className="text-2xl font-bold text-primary">{bps(totalDown)}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Subida total</p>
            <p className="text-2xl font-bold">{bps(totalUp)}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Colas</p>
            <p className="text-2xl font-bold">{data.length}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Con tráfico</p>
            <p className="text-2xl font-bold">{activos}</p>
          </CardContent></Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2"><Users className="w-4 h-4" /> Clientes</CardTitle>
              <CardDescription>Actualización cada 4 s (lectura ligera de contadores)</CardDescription>
            </div>
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Buscar cliente, IP o perfil"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-muted-foreground py-6">Cargando…</p>
            ) : rows.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                No hay colas simples en este router. Si usas queue tree o PCQ, el consumo por cliente no aparece aquí.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead className="min-w-[170px]">Bajada</TableHead>
                    <TableHead className="min-w-[170px]">Subida</TableHead>
                    <TableHead className="text-right">Acumulado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="font-medium flex items-center gap-2">
                          {r.client || r.name}
                          {r.online && <Badge variant="secondary" className="text-[10px]">en línea</Badge>}
                          {r.disabled && <Badge variant="destructive" className="text-[10px]">deshabilitada</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {r.profile || r.name}{r.uptime ? ` · ${r.uptime}` : ""}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{r.target || "—"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-sm">
                          <ArrowDown className="w-3.5 h-3.5 text-primary" />
                          <span className="font-medium">{bps(r.download_bps)}</span>
                          {r.max_download_bps > 0 && (
                            <span className="text-xs text-muted-foreground">/ {bps(r.max_download_bps)}</span>
                          )}
                        </div>
                        <Progress value={usage(r.download_bps, r.max_download_bps)} className="h-1.5 mt-1" />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-sm">
                          <ArrowUp className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="font-medium">{bps(r.upload_bps)}</span>
                          {r.max_upload_bps > 0 && (
                            <span className="text-xs text-muted-foreground">/ {bps(r.max_upload_bps)}</span>
                          )}
                        </div>
                        <Progress value={usage(r.upload_bps, r.max_upload_bps)} className="h-1.5 mt-1" />
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        ↓ {bytes(r.total_download_bytes)}<br />↑ {bytes(r.total_upload_bytes)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
