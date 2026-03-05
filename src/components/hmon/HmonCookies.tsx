import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hotspotApi } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSelectedDeviceId } from "@/lib/mikrotik";
import { Search, Cookie, Trash2 } from "lucide-react";
import { toast } from "sonner";

export function HmonCookies() {
  const deviceId = getSelectedDeviceId() || "";
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: cookies = [], isLoading } = useQuery({
    queryKey: ["hmon-cookies", deviceId],
    queryFn: () => deviceId ? hotspotApi.cookies(deviceId) : [],
    enabled: !!deviceId,
    refetchInterval: 15000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => hotspotApi.deleteCookie(deviceId, id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hmon-cookies"] }); toast.success("Cookie eliminada"); },
    onError: (e: any) => toast.error(e.message || "Error"),
  });

  const filtered = useMemo(() => {
    if (!search) return cookies;
    const s = search.toLowerCase();
    return cookies.filter((c: any) => (c.user || "").toLowerCase().includes(s) || (c["mac-address"] || "").toLowerCase().includes(s));
  }, [cookies, search]);

  if (!deviceId) return <div className="text-center py-12 text-muted-foreground text-sm">No hay dispositivo conectado</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2"><Cookie className="h-5 w-5 text-primary" /><h2 className="text-lg font-bold">Cookies</h2><Badge variant="outline" className="text-[10px]">{cookies.length}</Badge></div>
        <div className="relative md:w-56"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" /><Input placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-7 h-7 text-xs" /></div>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-[10px]">Usuario</TableHead>
                <TableHead className="text-[10px]">MAC</TableHead>
                <TableHead className="text-[10px]">Dominio</TableHead>
                <TableHead className="text-[10px]">Expira</TableHead>
                <TableHead className="text-[10px] text-right">Acciones</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-xs text-muted-foreground">Cargando...</TableCell></TableRow>
                ) : filtered.length > 0 ? filtered.map((c: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs font-medium">{c.user || "-"}</TableCell>
                    <TableCell className="text-xs font-mono">{c["mac-address"] || "-"}</TableCell>
                    <TableCell className="text-xs">{c.domain || "-"}</TableCell>
                    <TableCell className="text-[10px] text-muted-foreground">{c["expires-in"] || "-"}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(c[".id"])} disabled={deleteMutation.isPending}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-xs">Sin cookies</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
