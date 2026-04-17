import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { radiusApi } from "@/lib/api-client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from "recharts";
import {
  Activity, PowerOff, Ban, ShieldCheck, Wifi, ArrowDownUp,
  Clock, AlertTriangle, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

interface Props {
  username: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const RANGE_OPTIONS: Array<{ v: "24h"|"7d"|"30d"|"12m"; label: string; bucket: "hour"|"day"|"month" }> = [
  { v: "24h", label: "Últimas 24h", bucket: "hour" },
  { v: "7d", label: "7 días", bucket: "day" },
  { v: "30d", label: "30 días", bucket: "day" },
  { v: "12m", label: "12 meses", bucket: "month" },
];

export function RadiusClientMonitor({ username, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [range, setRange] = useState<"24h"|"7d"|"30d"|"12m">("24h");
  const bucket = RANGE_OPTIONS.find((r) => r.v === range)?.bucket || "hour";

  const enabled = !!username && open;

  const { data: traffic = [] } = useQuery({
    queryKey: ["radius", "monitor", "traffic", username, range],
    queryFn: () => radiusApi.monitorTraffic(username!, bucket, range),
    enabled,
  });
  const { data: disconnects = [] } = useQuery({
    queryKey: ["radius", "monitor", "disconnects", username],
    queryFn: () => radiusApi.monitorDisconnects(username!, 50),
    enabled,
  });
  const { data: live = [] } = useQuery({
    queryKey: ["radius", "monitor", "live", username],
    queryFn: () => radiusApi.monitorLive(username!),
    enabled,
    refetchInterval: enabled ? 5000 : false,
  });
  const { data: status } = useQuery({
    queryKey: ["radius", "monitor", "status", username],
    queryFn: () => radiusApi.monitorStatus(username!),
    enabled,
  });

  const kickMut = useMutation({
    mutationFn: () => radiusApi.monitorKick(username!),
    onSuccess: (r: any) => {
      toast.success("Cliente desconectado");
      (r?.log || []).forEach((l: string) => console.log("[kick]", l));
      qc.invalidateQueries({ queryKey: ["radius"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const blockMut = useMutation({
    mutationFn: (blocked: boolean) => radiusApi.monitorBlock(username!, blocked),
    onSuccess: () => {
      toast.success("Estado actualizado");
      qc.invalidateQueries({ queryKey: ["radius", "monitor", "status", username] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Reset range when opening different user
  useEffect(() => { if (open) setRange("24h"); }, [username, open]);

  const chartData = traffic.map((t: any) => ({
    bucket: t.bucket,
    download: Number(t.bytes_in || 0) / 1024 / 1024,
    upload: Number(t.bytes_out || 0) / 1024 / 1024,
  }));

  const totalIn = traffic.reduce((s: number, t: any) => s + Number(t.bytes_in || 0), 0);
  const totalOut = traffic.reduce((s: number, t: any) => s + Number(t.bytes_out || 0), 0);
  const totalSessions = traffic.reduce((s: number, t: any) => s + Number(t.sessions || 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-3">
            <DialogTitle className="font-mono">{username}</DialogTitle>
            {status?.blocked ? (
              <Badge variant="destructive" className="gap-1"><Ban className="w-3 h-3" />Bloqueado</Badge>
            ) : (
              <Badge variant="secondary" className="gap-1"><ShieldCheck className="w-3 h-3" />Activo</Badge>
            )}
            {live.length > 0 && (
              <Badge variant="default" className="gap-1"><Wifi className="w-3 h-3" />En línea ({live.length})</Badge>
            )}
            <div className="ml-auto flex flex-wrap gap-2">
              <Button
                size="sm" variant="outline"
                onClick={() => kickMut.mutate()}
                disabled={kickMut.isPending || live.length === 0}
              >
                <PowerOff className="w-4 h-4 mr-1" />Desconectar
              </Button>
              <Button
                size="sm" variant={status?.blocked ? "default" : "destructive"}
                onClick={() => blockMut.mutate(!status?.blocked)}
                disabled={blockMut.isPending}
              >
                <Ban className="w-4 h-4 mr-1" />
                {status?.blocked ? "Desbloquear" : "Bloquear"}
              </Button>
            </div>
          </div>
        </DialogHeader>

        <Tabs defaultValue="traffic" className="mt-4">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="traffic">Tráfico</TabsTrigger>
            <TabsTrigger value="live">En vivo</TabsTrigger>
            <TabsTrigger value="disconnects">Desconexiones</TabsTrigger>
          </TabsList>

          {/* TRÁFICO */}
          <TabsContent value="traffic" className="space-y-4 mt-4">
            <div className="flex items-center justify-between gap-3">
              <div className="grid grid-cols-3 gap-2 flex-1">
                <MiniStat icon={ArrowDownUp} label="Descarga" value={formatBytes(totalIn)} />
                <MiniStat icon={ArrowDownUp} label="Subida" value={formatBytes(totalOut)} />
                <MiniStat icon={Activity} label="Sesiones" value={String(totalSessions)} />
              </div>
              <Select value={range} onValueChange={(v: any) => setRange(v)}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RANGE_OPTIONS.map((r) => (
                    <SelectItem key={r.v} value={r.v}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Card>
              <CardContent className="pt-6 h-72">
                {chartData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                    Sin tráfico en el período
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="bucket" className="text-xs" tick={{ fontSize: 10 }} />
                      <YAxis className="text-xs" tick={{ fontSize: 10 }} unit=" MB" />
                      <Tooltip
                        contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                        formatter={(v: any) => `${Number(v).toFixed(2)} MB`}
                      />
                      <Legend />
                      <Bar dataKey="download" fill="hsl(var(--primary))" name="Descarga" />
                      <Bar dataKey="upload" fill="hsl(var(--secondary-foreground))" name="Subida" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* EN VIVO */}
          <TabsContent value="live" className="mt-4">
            {live.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Wifi className="w-10 h-10 mx-auto mb-2 opacity-40" />
                Sin sesiones activas
              </div>
            ) : (
              <div className="space-y-3">
                {live.map((s: any) => (
                  <Card key={s.radacctid}>
                    <CardContent className="pt-6 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <Field label="IP asignada" value={s.framedipaddress || "—"} />
                      <Field label="MAC" value={s.callingstationid || "—"} />
                      <Field label="NAS" value={s.nasipaddress || "—"} />
                      <Field label="Inicio" value={s.acctstarttime ? new Date(s.acctstarttime).toLocaleString() : "—"} />
                      <Field label="Uptime" value={formatDuration(Number(s.acctsessiontime || 0))} />
                      <Field label="Descargado" value={formatBytes(Number(s.acctinputoctets || 0))} />
                      <Field label="Subido" value={formatBytes(Number(s.acctoutputoctets || 0))} />
                      <Field label="Paquetes ↓/↑" value={`${s.acctinputpackets || 0} / ${s.acctoutputpackets || 0}`} />
                    </CardContent>
                  </Card>
                ))}
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" />Actualizando cada 5s
                </p>
              </div>
            )}
          </TabsContent>

          {/* DESCONEXIONES */}
          <TabsContent value="disconnects" className="mt-4">
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Inicio</TableHead>
                    <TableHead>Fin</TableHead>
                    <TableHead>Duración</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Tráfico</TableHead>
                    <TableHead>Causa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {disconnects.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        Sin desconexiones registradas
                      </TableCell>
                    </TableRow>
                  ) : disconnects.map((d: any) => (
                    <TableRow key={d.radacctid}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {d.acctstarttime ? new Date(d.acctstarttime).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {d.acctstoptime ? new Date(d.acctstoptime).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" />{formatDuration(Number(d.acctsessiontime || 0))}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs font-mono">{d.framedipaddress || "—"}</TableCell>
                      <TableCell className="text-xs">
                        ↓ {formatBytes(Number(d.acctinputoctets || 0))}
                        <br />↑ {formatBytes(Number(d.acctoutputoctets || 0))}
                      </TableCell>
                      <TableCell>
                        <Badge variant={d.acctterminatecause === "User-Request" ? "secondary" : "outline"} className="gap-1">
                          {d.acctterminatecause === "Admin-Reset" && <AlertTriangle className="w-3 h-3" />}
                          {d.acctterminatecause || "—"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function MiniStat({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-2">
        <Icon className="w-4 h-4 text-primary" />
        <div>
          <div className="text-[10px] text-muted-foreground uppercase">{label}</div>
          <div className="text-sm font-bold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="font-mono text-sm break-all">{value}</div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0; let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

function formatDuration(secs: number): string {
  if (!secs) return "0s";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}
