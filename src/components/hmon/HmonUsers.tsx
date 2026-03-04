import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hotspotApi, mikrotikCommandApi } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useHotspotActiveUsers, useHotspotUsers } from "@/hooks/useMikrotikData";
import { getSelectedDeviceId } from "@/lib/mikrotik";
import { Plus, Trash2, Wifi, Search, UserPlus, Key, RefreshCw } from "lucide-react";
import { toast } from "sonner";

function generatePin(length = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < length; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

export function HmonUsers() {
  const deviceId = getSelectedDeviceId() || "";
  const [tab, setTab] = useState("active");
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [authMode, setAuthMode] = useState<"pin" | "userpass">("pin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [selectedProfile, setSelectedProfile] = useState("default");
  const [comment, setComment] = useState("");
  const [pinCount, setPinCount] = useState(1);
  const [showBatchPin, setShowBatchPin] = useState(false);

  const qc = useQueryClient();
  const { data: activeData } = useHotspotActiveUsers();
  const { data: usersData } = useHotspotUsers();
  const active = Array.isArray(activeData) ? activeData : [];
  const users = Array.isArray(usersData) ? usersData : [];

  const { data: profiles = [] } = useQuery({
    queryKey: ["hmon-profiles", deviceId],
    queryFn: async () => {
      if (!deviceId) return [];
      return await hotspotApi.profiles(deviceId);
    },
    enabled: !!deviceId,
  });

  const addUserMutation = useMutation({
    mutationFn: async (data: { name: string; password: string; profile: string; comment?: string }) => {
      return await hotspotApi.addUser(deviceId, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hotspot-users"] });
      toast.success("Usuario creado");
      setShowAdd(false);
      setUsername("");
      setPassword("");
      setComment("");
    },
    onError: (e: any) => toast.error(e.message || "Error al crear usuario"),
  });

  const batchPinMutation = useMutation({
    mutationFn: async (count: number) => {
      const created: { name: string; password: string; profile: string }[] = [];
      for (let i = 0; i < count; i++) {
        const pin = generatePin(8);
        const pwd = generatePin(6);
        await hotspotApi.addUser(deviceId, { name: pin, password: pwd, profile: selectedProfile, comment: `PIN HMON ${new Date().toISOString().slice(0, 10)}` });
        created.push({ name: pin, password: pwd, profile: selectedProfile });
      }
      return created;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["hotspot-users"] });
      toast.success(`${data.length} PINs creados exitosamente`);
      setShowBatchPin(false);
      setPinCount(1);
    },
    onError: (e: any) => toast.error(e.message || "Error al crear PINs"),
  });

  const deleteUserMutation = useMutation({
    mutationFn: (userId: string) => hotspotApi.removeUser(deviceId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hotspot-users"] });
      qc.invalidateQueries({ queryKey: ["hotspot-active"] });
      toast.success("Usuario eliminado");
      setDeleteId(null);
    },
    onError: (e: any) => toast.error(e.message || "Error"),
  });

  const cleanExpiredMutation = useMutation({
    mutationFn: async () => {
      // Find users with expired comments (date-based expiration)
      const now = new Date();
      const toDelete: string[] = [];
      for (const u of users) {
        const comment = u.comment || "";
        // Check if comment contains a date that has passed
        const dateMatch = comment.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/);
        if (dateMatch) {
          try {
            const [_, dateStr, timeStr] = dateMatch;
            const [month, day, year] = dateStr.split("/");
            const expDate = new Date(`${year}-${month}-${day}T${timeStr}`);
            if (expDate < now && u[".id"]) toDelete.push(u[".id"]);
          } catch { /* skip */ }
        }
      }
      for (const id of toDelete) {
        await hotspotApi.removeUser(deviceId, id);
      }
      return toDelete.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["hotspot-users"] });
      qc.invalidateQueries({ queryKey: ["hotspot-active"] });
      toast.success(`${count} usuarios expirados eliminados`);
    },
    onError: (e: any) => toast.error(e.message || "Error al limpiar"),
  });

  const handleAddUser = () => {
    if (authMode === "pin") {
      const pin = generatePin(8);
      const pwd = generatePin(6);
      addUserMutation.mutate({ name: pin, password: pwd, profile: selectedProfile, comment: comment || `PIN HMON` });
    } else {
      if (!username.trim() || !password.trim()) { toast.error("Ingresa usuario y contraseña"); return; }
      addUserMutation.mutate({ name: username.trim(), password: password.trim(), profile: selectedProfile, comment: comment || undefined });
    }
  };

  const fActive = active.filter((u: any) => !search || (u.user || u.name || "").toLowerCase().includes(search.toLowerCase()) || (u.address || "").includes(search));
  const fUsers = users.filter((u: any) => !search || (u.name || "").toLowerCase().includes(search.toLowerCase()) || (u.comment || "").toLowerCase().includes(search.toLowerCase()));

  if (!deviceId) return <div className="text-center py-12 text-muted-foreground text-sm">No hay dispositivo conectado</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2"><Wifi className="h-5 w-5 text-primary" /><h2 className="text-lg font-bold">Usuarios Hotspot</h2></div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => cleanExpiredMutation.mutate()} disabled={cleanExpiredMutation.isPending}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${cleanExpiredMutation.isPending ? "animate-spin" : ""}`} /> Limpiar Expirados
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowBatchPin(true)}>
            <Key className="h-3.5 w-3.5 mr-1" /> Crear PINs
          </Button>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Agregar
          </Button>
        </div>
      </div>

      <div className="relative md:w-64"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" /><Input placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-7 h-7 text-xs" /></div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-8">
          <TabsTrigger value="active" className="text-xs">Activos ({active.length})</TabsTrigger>
          <TabsTrigger value="users" className="text-xs">Todos ({users.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-3">
          <Card><CardContent className="p-0"><div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-[10px]">Usuario</TableHead>
                <TableHead className="text-[10px]">IP</TableHead>
                <TableHead className="text-[10px]">MAC</TableHead>
                <TableHead className="text-[10px]">Perfil</TableHead>
                <TableHead className="text-[10px]">Uptime</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {fActive.length > 0 ? fActive.map((u: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs font-medium">{u.user || u.name || "-"}</TableCell>
                    <TableCell className="text-[10px] font-mono">{u.address || "-"}</TableCell>
                    <TableCell className="text-[10px] font-mono text-muted-foreground">{u["mac-address"] || "-"}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[9px]">{u.profile || "default"}</Badge></TableCell>
                    <TableCell className="text-[10px] text-muted-foreground">{u.uptime || "0s"}</TableCell>
                  </TableRow>
                )) : <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-xs">Sin usuarios activos</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div></CardContent></Card>
        </TabsContent>

        <TabsContent value="users" className="mt-3">
          <Card><CardContent className="p-0"><div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-[10px]">Nombre</TableHead>
                <TableHead className="text-[10px]">Perfil</TableHead>
                <TableHead className="text-[10px]">Comentario</TableHead>
                <TableHead className="text-[10px]">Estado</TableHead>
                <TableHead className="text-[10px] text-right">Acciones</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {fUsers.length > 0 ? fUsers.map((u: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs font-medium font-mono">{u.name}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[9px]">{u.profile || "default"}</Badge></TableCell>
                    <TableCell className="text-[10px] text-muted-foreground max-w-[200px] truncate">{u.comment || "-"}</TableCell>
                    <TableCell><Badge variant={u.disabled === "true" ? "destructive" : "default"} className="text-[9px]">{u.disabled === "true" ? "Deshabilitado" : "Activo"}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setDeleteId(u[".id"])}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                )) : <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-xs">Sin usuarios</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div></CardContent></Card>
        </TabsContent>
      </Tabs>

      {/* Add User Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5" /> Agregar Usuario Hotspot</DialogTitle>
            <DialogDescription>Crea un usuario con PIN automático o usuario/contraseña manual</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button variant={authMode === "pin" ? "default" : "outline"} size="sm" onClick={() => setAuthMode("pin")}><Key className="h-3.5 w-3.5 mr-1" /> PIN Automático</Button>
              <Button variant={authMode === "userpass" ? "default" : "outline"} size="sm" onClick={() => setAuthMode("userpass")}><UserPlus className="h-3.5 w-3.5 mr-1" /> Usuario/Contraseña</Button>
            </div>
            {authMode === "userpass" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Usuario *</Label><Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="usuario123" className="h-8 text-xs" /></div>
                <div className="space-y-1"><Label className="text-xs">Contraseña *</Label><Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="pass123" className="h-8 text-xs" /></div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Perfil</Label>
                <Select value={selectedProfile} onValueChange={setSelectedProfile}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{profiles.length > 0 ? profiles.map((p: any) => (
                    <SelectItem key={p[".id"]} value={p.name} className="text-xs">{p.name}{p["rate-limit"] ? ` (${p["rate-limit"]})` : ""}</SelectItem>
                  )) : <SelectItem value="default">default</SelectItem>}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label className="text-xs">Comentario</Label><Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Opcional" className="h-8 text-xs" /></div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowAdd(false)}>Cancelar</Button>
              <Button size="sm" onClick={handleAddUser} disabled={addUserMutation.isPending}>{addUserMutation.isPending ? "Creando..." : "Crear"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Batch PIN Dialog */}
      <Dialog open={showBatchPin} onOpenChange={setShowBatchPin}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Key className="h-5 w-5" /> Crear PINs en Lote</DialogTitle>
            <DialogDescription>Genera múltiples PINs aleatorios para el hotspot</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Cantidad</Label><Input type="number" min={1} max={100} value={pinCount} onChange={(e) => setPinCount(parseInt(e.target.value) || 1)} className="h-8 text-xs" /></div>
              <div className="space-y-1">
                <Label className="text-xs">Perfil</Label>
                <Select value={selectedProfile} onValueChange={setSelectedProfile}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{profiles.length > 0 ? profiles.map((p: any) => (
                    <SelectItem key={p[".id"]} value={p.name} className="text-xs">{p.name}</SelectItem>
                  )) : <SelectItem value="default">default</SelectItem>}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowBatchPin(false)}>Cancelar</Button>
              <Button size="sm" onClick={() => batchPinMutation.mutate(pinCount)} disabled={batchPinMutation.isPending}>{batchPinMutation.isPending ? `Creando ${pinCount}...` : `Crear ${pinCount} PINs`}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>¿Eliminar usuario?</AlertDialogTitle><AlertDialogDescription>Se eliminará del MikroTik. Esta acción no se puede deshacer.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteUserMutation.mutate(deleteId)} className="bg-destructive hover:bg-destructive/90">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
