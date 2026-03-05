import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { hotspotApi } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSelectedDeviceId } from "@/lib/mikrotik";
import { Search, Globe } from "lucide-react";

export function HmonHosts() {
  const deviceId = getSelectedDeviceId() || "";
  const [search, setSearch] = useState("");

  const { data: hosts = [], isLoading } = useQuery({
    queryKey: ["hmon-hosts", deviceId],
    queryFn: () => deviceId ? hotspotApi.hosts(deviceId) : [],
    enabled: !!deviceId,
    refetchInterval: 10000,
  });

  const filtered = useMemo(() => {
    if (!search) return hosts;
    const s = search.toLowerCase();
    return hosts.filter((h: any) =>
      (h["mac-address"] || "").toLowerCase().includes(s) ||
      (h.address || "").includes(s) ||
      (h["to-address"] || "").includes(s)
    );
  }, [hosts, search]);

  if (!deviceId) return <div className="text-center py-12 text-muted-foreground text-sm">No hay dispositivo conectado</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold">Hosts</h2>
          <Badge variant="outline" className="text-[10px]">{hosts.length}</Badge>
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
                  <TableHead className="text-[10px]">MAC</TableHead>
                  <TableHead className="text-[10px]">IP</TableHead>
                  <TableHead className="text-[10px]">To Address</TableHead>
                  <TableHead className="text-[10px]">Server</TableHead>
                  <TableHead className="text-[10px]">Autorizado</TableHead>
                  <TableHead className="text-[10px]">Bypass</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-xs text-muted-foreground">Cargando...</TableCell></TableRow>
                ) : filtered.length > 0 ? filtered.map((h: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs font-mono">{h["mac-address"] || "-"}</TableCell>
                    <TableCell className="text-xs font-mono">{h.address || "-"}</TableCell>
                    <TableCell className="text-xs font-mono">{h["to-address"] || "-"}</TableCell>
                    <TableCell className="text-xs">{h.server || "-"}</TableCell>
                    <TableCell><Badge variant={h.authorized === "true" ? "default" : "secondary"} className="text-[9px]">{h.authorized === "true" ? "Sí" : "No"}</Badge></TableCell>
                    <TableCell><Badge variant={h.bypassed === "true" ? "default" : "outline"} className="text-[9px]">{h.bypassed === "true" ? "Sí" : "No"}</Badge></TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-xs">Sin hosts</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
