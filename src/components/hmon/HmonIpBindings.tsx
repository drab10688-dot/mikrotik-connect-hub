import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hotspotApi } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { getSelectedDeviceId } from "@/lib/mikrotik";
import { Plus, Trash2, Link2, Search } from "lucide-react";
import { toast } from "sonner";

export function HmonIpBindings() {
  const deviceId = getSelectedDeviceId() || "";
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [mac, setMac] = useState("");
  const [address, setAddress] = useState("");
  const [toAddress, setToAddress] = useState("");
  const [bindType, setBindType] = useState("regular");

  const { data: bindings = [], isLoading } = useQuery({
    queryKey: ["hmon-ip-bindings", deviceId],
    queryFn: () => deviceId ? hotspotApi.ipBindings(deviceId) : [],
    enabled: !!deviceId,
    refetchInterval: 15000,
  });

  const addMutation = useMutation({
    mutationFn: () => hotspotApi.addIpBinding(deviceId, {
      "mac-address": mac || undefined,
      address: address || undefined,
      "to-address": toAddress || undefined,
      type: bindType,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hmon-ip-bindings"] }); toast.success("IP Binding creado"); setShowAdd(false); setMac(""); setAddress(""); setToAddress(""); },
    onError: (e: any) => toast.error(e.message || "Error"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => hotspotApi.deleteIpBinding(deviceId, id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hmon-ip-bindings"] }); toast.success("Eliminado"); setDeleteId(null); },
    onError: (e: any) => toast.error(e.message || "Error"),
  });

  const filtered = useMemo(() => {
    if (!search) return bindings;
    const s = search.toLowerCase();
    return bindings.filter((b: any) => (b["mac-address"] || "").toLowerCase().includes(s) || (b.address || "").includes(s));
  }, [bindings, search]);

  if (!deviceId) return <div className="text-center py-12 text-muted-foreground text-sm">No hay dispositivo conectado</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2"><Link2 className="h-5 w-5 text-primary" /><h2 className="text-lg font-bold">IP Bindings</h2><Badge variant="outline" className="text-[10px]">{bindings.length}</Badge></div>
        <div className="flex gap-2">
          <div className="relative md:w-48"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" /><Input placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-7 h-7 text-xs" /></div>
          <Button size="sm" onClick={() => setShowAdd(!showAdd)}><Plus className="h-3.5 w-3.5 mr-1" />Agregar</Button>
        </div>
      </div>

      {showAdd && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Nuevo IP Binding</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1"><Label className="text-xs">MAC</Label><Input value={mac} onChange={(e) => setMac(e.target.value)} placeholder="AA:BB:CC:DD:EE:FF" className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">Address</Label><Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="192.168.1.10" className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">To Address</Label><Input value={toAddress} onChange={(e) => setToAddress(e.target.value)} placeholder="10.0.0.1" className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">Tipo</Label>
                <Select value={bindType} onValueChange={setBindType}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="regular" className="text-xs">Regular</SelectItem>
                    <SelectItem value="bypassed" className="text-xs">Bypassed</SelectItem>
                    <SelectItem value="blocked" className="text-xs">Blocked</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setShowAdd(false)}>Cancelar</Button>
              <Button size="sm" onClick={() => addMutation.mutate()} disabled={addMutation.isPending}>Crear</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-[10px]">MAC</TableHead>
                <TableHead className="text-[10px]">Address</TableHead>
                <TableHead className="text-[10px]">To Address</TableHead>
                <TableHead className="text-[10px]">Server</TableHead>
                <TableHead className="text-[10px]">Tipo</TableHead>
                <TableHead className="text-[10px] text-right">Acciones</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-xs text-muted-foreground">Cargando...</TableCell></TableRow>
                ) : filtered.length > 0 ? filtered.map((b: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs font-mono">{b["mac-address"] || "-"}</TableCell>
                    <TableCell className="text-xs font-mono">{b.address || "-"}</TableCell>
                    <TableCell className="text-xs font-mono">{b["to-address"] || "-"}</TableCell>
                    <TableCell className="text-xs">{b.server || "all"}</TableCell>
                    <TableCell><Badge variant={b.type === "bypassed" ? "default" : b.type === "blocked" ? "destructive" : "outline"} className="text-[9px]">{b.type || "regular"}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setDeleteId(b[".id"])}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-xs">Sin IP Bindings</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>¿Eliminar IP Binding?</AlertDialogTitle><AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteMutation.mutate(deleteId)} className="bg-destructive hover:bg-destructive/90">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
