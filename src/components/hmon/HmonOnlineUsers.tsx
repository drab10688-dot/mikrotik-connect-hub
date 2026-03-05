import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useHotspotActiveUsers } from "@/hooks/useMikrotikData";
import { Search, MonitorSmartphone } from "lucide-react";

const formatBytes = (bytes: number) => {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

export function HmonOnlineUsers() {
  const [search, setSearch] = useState("");
  const { data: activeData, isLoading } = useHotspotActiveUsers();
  const active = useMemo(() => (Array.isArray(activeData) ? activeData : []), [activeData]);

  const filtered = useMemo(() => {
    if (!search) return active;
    const s = search.toLowerCase();
    return active.filter((u: any) =>
      (u.user || u.name || "").toLowerCase().includes(s) ||
      (u.address || "").includes(s) ||
      (u["mac-address"] || "").toLowerCase().includes(s)
    );
  }, [active, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <MonitorSmartphone className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold">Usuarios en Línea</h2>
          <Badge variant="outline" className="text-[10px] gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            {active.length} conectados
          </Badge>
        </div>
        <div className="relative md:w-56">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-7 h-7 text-xs" />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px]">Usuario</TableHead>
                  <TableHead className="text-[10px]">IP</TableHead>
                  <TableHead className="text-[10px]">MAC</TableHead>
                  <TableHead className="text-[10px]">Perfil</TableHead>
                  <TableHead className="text-[10px]">Uptime</TableHead>
                  <TableHead className="text-[10px] text-right">↓ DL</TableHead>
                  <TableHead className="text-[10px] text-right">↑ UL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-xs text-muted-foreground">Cargando...</TableCell></TableRow>
                ) : filtered.length > 0 ? filtered.map((u: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs font-medium">{u.user || u.name || "-"}</TableCell>
                    <TableCell className="text-[10px] font-mono">{u.address || "-"}</TableCell>
                    <TableCell className="text-[10px] font-mono text-muted-foreground">{u["mac-address"] || "-"}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[9px]">{u.profile || "default"}</Badge></TableCell>
                    <TableCell className="text-[10px] text-muted-foreground">{u.uptime || "0s"}</TableCell>
                    <TableCell className="text-[10px] text-right text-[hsl(var(--chart-2))]">{formatBytes(parseInt(u["bytes-in"] || "0"))}</TableCell>
                    <TableCell className="text-[10px] text-right text-[hsl(var(--chart-4))]">{formatBytes(parseInt(u["bytes-out"] || "0"))}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-xs">Sin usuarios en línea</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
