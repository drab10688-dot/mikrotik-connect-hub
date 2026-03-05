import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { hotspotApi } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSelectedDeviceId } from "@/lib/mikrotik";
import { Search, Network } from "lucide-react";

export function HmonDhcpLeases() {
  const deviceId = getSelectedDeviceId() || "";
  const [search, setSearch] = useState("");

  const { data: leases = [], isLoading } = useQuery({
    queryKey: ["hmon-dhcp-leases", deviceId],
    queryFn: () => deviceId ? hotspotApi.dhcpLeases(deviceId) : [],
    enabled: !!deviceId,
    refetchInterval: 15000,
  });

  const filtered = useMemo(() => {
    if (!search) return leases;
    const s = search.toLowerCase();
    return leases.filter((l: any) =>
      (l.address || "").includes(s) ||
      (l["mac-address"] || "").toLowerCase().includes(s) ||
      (l["host-name"] || "").toLowerCase().includes(s)
    );
  }, [leases, search]);

  if (!deviceId) return <div className="text-center py-12 text-muted-foreground text-sm">No hay dispositivo conectado</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2"><Network className="h-5 w-5 text-primary" /><h2 className="text-lg font-bold">Arrendamientos DHCP</h2><Badge variant="outline" className="text-[10px]">{leases.length}</Badge></div>
        <div className="relative md:w-56"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" /><Input placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-7 h-7 text-xs" /></div>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-[10px]">IP</TableHead>
                <TableHead className="text-[10px]">MAC</TableHead>
                <TableHead className="text-[10px]">Hostname</TableHead>
                <TableHead className="text-[10px]">Server</TableHead>
                <TableHead className="text-[10px]">Estado</TableHead>
                <TableHead className="text-[10px]">Expira</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-xs text-muted-foreground">Cargando...</TableCell></TableRow>
                ) : filtered.length > 0 ? filtered.map((l: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs font-mono">{l.address || "-"}</TableCell>
                    <TableCell className="text-xs font-mono">{l["mac-address"] || "-"}</TableCell>
                    <TableCell className="text-xs">{l["host-name"] || "-"}</TableCell>
                    <TableCell className="text-xs">{l.server || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={l.status === "bound" ? "default" : l.status === "waiting" ? "secondary" : "outline"} className="text-[9px]">
                        {l.status || "-"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-[10px] text-muted-foreground">{l["expires-after"] || "estático"}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-xs">Sin arrendamientos</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
