import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hotspotApi } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { getSelectedDeviceId } from "@/lib/mikrotik";
import { Plus, Trash2, Layers, Shield } from "lucide-react";
import { toast } from "sonner";

export function HmonProfiles() {
  const deviceId = getSelectedDeviceId() || "";
  const [showCreate, setShowCreate] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sharedUsers, setSharedUsers] = useState("1");
  const [rateLimit, setRateLimit] = useState("");
  const [sessionTimeout, setSessionTimeout] = useState("");
  const [idleTimeout, setIdleTimeout] = useState("");

  const qc = useQueryClient();

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ["hmon-profiles-manage", deviceId],
    queryFn: () => deviceId ? hotspotApi.profiles(deviceId) : [],
    enabled: !!deviceId,
    refetchInterval: 30000,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const data: any = { name, "shared-users": sharedUsers };
      if (rateLimit) data["rate-limit"] = rateLimit;
      if (sessionTimeout) data["session-timeout"] = sessionTimeout;
      if (idleTimeout) data["idle-timeout"] = idleTimeout;
      return await hotspotApi.addProfile(deviceId, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hmon-profiles-manage"] });
      toast.success("Perfil creado");
      setShowCreate(false);
      setName(""); setSharedUsers("1"); setRateLimit(""); setSessionTimeout(""); setIdleTimeout("");
    },
    onError: (e: any) => toast.error(e.message || "Error al crear perfil"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => hotspotApi.deleteProfile(deviceId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hmon-profiles-manage"] });
      toast.success("Perfil eliminado");
      setDeleteId(null);
    },
    onError: (e: any) => toast.error(e.message || "Error"),
  });

  if (!deviceId) return <div className="text-center py-12 text-muted-foreground text-sm">No hay dispositivo conectado</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><Layers className="h-5 w-5 text-primary" /><h2 className="text-lg font-bold">Perfiles Hotspot</h2></div>
        <Button size="sm" onClick={() => setShowCreate(!showCreate)}><Plus className="h-3.5 w-3.5 mr-1" /> Crear Perfil</Button>
      </div>

      {showCreate && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Nuevo Perfil</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="space-y-1"><Label className="text-xs">Nombre *</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="5mbps-1hora" className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">Usuarios Compartidos</Label><Input type="number" value={sharedUsers} onChange={(e) => setSharedUsers(e.target.value)} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">Rate Limit</Label><Input value={rateLimit} onChange={(e) => setRateLimit(e.target.value)} placeholder="5M/5M" className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">Session Timeout</Label><Input value={sessionTimeout} onChange={(e) => setSessionTimeout(e.target.value)} placeholder="1h o 3d" className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">Idle Timeout</Label><Input value={idleTimeout} onChange={(e) => setIdleTimeout(e.target.value)} placeholder="5m" className="h-8 text-xs" /></div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button>
              <Button size="sm" onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !name.trim()}>{createMutation.isPending ? "Creando..." : "Crear"}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-[10px]">Nombre</TableHead>
                <TableHead className="text-[10px]">Compartidos</TableHead>
                <TableHead className="text-[10px]">Rate Limit</TableHead>
                <TableHead className="text-[10px]">Sesión</TableHead>
                <TableHead className="text-[10px]">Inactivo</TableHead>
                <TableHead className="text-[10px] text-right">Acciones</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-6 text-xs text-muted-foreground">Cargando...</TableCell></TableRow>
                ) : profiles.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-6 text-xs text-muted-foreground">Sin perfiles</TableCell></TableRow>
                ) : profiles.map((p: any) => (
                  <TableRow key={p[".id"]}>
                    <TableCell className="text-xs font-medium">{p.name}</TableCell>
                    <TableCell className="text-xs">{p["shared-users"] || "1"}</TableCell>
                    <TableCell className="text-xs font-mono">{p["rate-limit"] || "Sin límite"}</TableCell>
                    <TableCell className="text-xs">{p["session-timeout"] || "Sin límite"}</TableCell>
                    <TableCell className="text-xs">{p["idle-timeout"] || "Sin límite"}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setDeleteId(p[".id"])} disabled={p.name === "default"}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>¿Eliminar perfil?</AlertDialogTitle><AlertDialogDescription>Los usuarios asignados a este perfil podrían verse afectados.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteMutation.mutate(deleteId)} className="bg-destructive hover:bg-destructive/90">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
