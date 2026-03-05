import { useState, useEffect, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useHotspotActiveUsers, usePPPoEActive, useInterfaces } from "@/hooks/useMikrotikData";
import { Activity, ArrowDown, ArrowUp } from "lucide-react";

const formatBytes = (bytes: number) => {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

export function HmonTraffic() {
  const { data: haData } = useHotspotActiveUsers();
  const { data: paData } = usePPPoEActive();
  const { data: ifData, isLoading } = useInterfaces();
  const ha = useMemo(() => (Array.isArray(haData) ? haData : []), [haData]);
  const pa = useMemo(() => (Array.isArray(paData) ? paData : []), [paData]);
  const interfaces = useMemo(() => (Array.isArray(ifData) ? ifData : []), [ifData]);

  const historyRef = useRef<{ time: string; rx: number; tx: number }[]>([]);
  const [history, setHistory] = useState<typeof historyRef.current>([]);

  const totalBw = useMemo(() => {
    let rx = 0, tx = 0;
    [...ha, ...pa].forEach((u: any) => { rx += parseInt(u["bytes-in"] || "0"); tx += parseInt(u["bytes-out"] || "0"); });
    return { rx, tx, total: rx + tx };
  }, [ha, pa]);

  useEffect(() => {
    const now = new Date();
    const t = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
    historyRef.current = [...historyRef.current.slice(-29), { time: t, rx: totalBw.rx, tx: totalBw.tx }];
    setHistory([...historyRef.current]);
  }, [totalBw.rx, totalBw.tx]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><Activity className="h-5 w-5 text-primary" /><h2 className="text-lg font-bold">Tráfico Monitor</h2></div>

      <div className="grid grid-cols-3 gap-3">
        <Card className="border-l-4 border-l-[hsl(var(--chart-2))]"><CardContent className="p-3"><p className="text-[10px] text-muted-foreground flex items-center gap-1"><ArrowDown className="h-3 w-3" />Download</p><p className="text-lg font-bold">{formatBytes(totalBw.rx)}</p></CardContent></Card>
        <Card className="border-l-4 border-l-[hsl(var(--chart-4))]"><CardContent className="p-3"><p className="text-[10px] text-muted-foreground flex items-center gap-1"><ArrowUp className="h-3 w-3" />Upload</p><p className="text-lg font-bold">{formatBytes(totalBw.tx)}</p></CardContent></Card>
        <Card className="border-l-4 border-l-primary"><CardContent className="p-3"><p className="text-[10px] text-muted-foreground">Total</p><p className="text-lg font-bold">{formatBytes(totalBw.total)}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-sm">Historial de Tráfico</CardTitle></CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="h-[250px]">
            {history.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history}>
                  <defs>
                    <linearGradient id="gRx" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.3} /><stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0} /></linearGradient>
                    <linearGradient id="gTx" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(var(--chart-4))" stopOpacity={0.3} /><stop offset="95%" stopColor="hsl(var(--chart-4))" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="time" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => formatBytes(v)} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "11px" }} formatter={(v: number) => formatBytes(v)} />
                  <Area type="monotone" dataKey="rx" name="Download" stroke="hsl(var(--chart-2))" fill="url(#gRx)" strokeWidth={2} />
                  <Area type="monotone" dataKey="tx" name="Upload" stroke="hsl(var(--chart-4))" fill="url(#gTx)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : <div className="flex items-center justify-center h-full text-muted-foreground text-xs">Recopilando datos...</div>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 pt-3 px-4"><CardTitle className="text-sm">Interfaces</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-[10px]">Nombre</TableHead>
                <TableHead className="text-[10px]">Tipo</TableHead>
                <TableHead className="text-[10px]">Estado</TableHead>
                <TableHead className="text-[10px] text-right">RX</TableHead>
                <TableHead className="text-[10px] text-right">TX</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-xs text-muted-foreground">Cargando...</TableCell></TableRow>
                ) : interfaces.length > 0 ? interfaces.map((iface: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs font-medium">{iface.name || "-"}</TableCell>
                    <TableCell className="text-xs">{iface.type || "-"}</TableCell>
                    <TableCell><Badge variant={iface.running === "true" ? "default" : "secondary"} className="text-[9px]">{iface.running === "true" ? "Activo" : "Inactivo"}</Badge></TableCell>
                    <TableCell className="text-[10px] text-right text-[hsl(var(--chart-2))]">{formatBytes(parseInt(iface["rx-byte"] || "0"))}</TableCell>
                    <TableCell className="text-[10px] text-right text-[hsl(var(--chart-4))]">{formatBytes(parseInt(iface["tx-byte"] || "0"))}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-xs">Sin interfaces</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
