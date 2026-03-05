import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hotspotApi } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getSelectedDeviceId } from "@/lib/mikrotik";
import { UserPlus, Key } from "lucide-react";
import { toast } from "sonner";

function generatePin(length = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < length; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

export function HmonAddUser() {
  const deviceId = getSelectedDeviceId() || "";
  const qc = useQueryClient();
  const [mode, setMode] = useState<"pin" | "userpass">("pin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [selectedProfile, setSelectedProfile] = useState("default");
  const [comment, setComment] = useState("");
  const [pinCount, setPinCount] = useState(1);

  const { data: profiles = [] } = useQuery({
    queryKey: ["hmon-profiles", deviceId],
    queryFn: () => deviceId ? hotspotApi.profiles(deviceId) : [],
    enabled: !!deviceId,
  });

  const addMutation = useMutation({
    mutationFn: (data: { name: string; password: string; profile: string; comment?: string }) =>
      hotspotApi.addUser(deviceId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hotspot-users"] });
      toast.success("Usuario creado exitosamente");
      setUsername("");
      setPassword("");
      setComment("");
    },
    onError: (e: any) => toast.error(e.message || "Error al crear usuario"),
  });

  const batchMutation = useMutation({
    mutationFn: async (count: number) => {
      const created: { name: string; password: string }[] = [];
      for (let i = 0; i < count; i++) {
        const pin = generatePin(8);
        const pwd = generatePin(6);
        await hotspotApi.addUser(deviceId, { name: pin, password: pwd, profile: selectedProfile, comment: `PIN HMON ${new Date().toISOString().slice(0, 10)}` });
        created.push({ name: pin, password: pwd });
      }
      return created;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["hotspot-users"] });
      toast.success(`${data.length} PINs creados exitosamente`);
    },
    onError: (e: any) => toast.error(e.message || "Error"),
  });

  const handleAdd = () => {
    if (mode === "pin") {
      const pin = generatePin(8);
      const pwd = generatePin(6);
      addMutation.mutate({ name: pin, password: pwd, profile: selectedProfile, comment: comment || "PIN HMON" });
    } else {
      if (!username.trim() || !password.trim()) { toast.error("Ingresa usuario y contraseña"); return; }
      addMutation.mutate({ name: username.trim(), password: password.trim(), profile: selectedProfile, comment: comment || undefined });
    }
  };

  if (!deviceId) return <div className="text-center py-12 text-muted-foreground text-sm">No hay dispositivo conectado</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-primary" /><h2 className="text-lg font-bold">Añadir Usuario</h2></div>

      <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
        <TabsList className="h-8">
          <TabsTrigger value="pin" className="text-xs gap-1"><Key className="h-3 w-3" />PIN Automático</TabsTrigger>
          <TabsTrigger value="userpass" className="text-xs gap-1"><UserPlus className="h-3 w-3" />Usuario/Contraseña</TabsTrigger>
        </TabsList>

        <TabsContent value="pin" className="mt-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Generar PIN</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Perfil</Label>
                  <Select value={selectedProfile} onValueChange={setSelectedProfile}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{profiles.map((p: any) => <SelectItem key={p.name} value={p.name} className="text-xs">{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label className="text-xs">Comentario</Label><Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Opcional" className="h-8 text-xs" /></div>
              </div>
              <Button size="sm" onClick={handleAdd} disabled={addMutation.isPending}>
                <Key className="h-3.5 w-3.5 mr-1" />{addMutation.isPending ? "Creando..." : "Generar PIN"}
              </Button>
            </CardContent>
          </Card>

          <Card className="mt-3">
            <CardHeader className="pb-2"><CardTitle className="text-sm">Generación Masiva</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Cantidad</Label><Input type="number" min={1} max={50} value={pinCount} onChange={(e) => setPinCount(parseInt(e.target.value) || 1)} className="h-8 text-xs" /></div>
                <div className="space-y-1">
                  <Label className="text-xs">Perfil</Label>
                  <Select value={selectedProfile} onValueChange={setSelectedProfile}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{profiles.map((p: any) => <SelectItem key={p.name} value={p.name} className="text-xs">{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <Button size="sm" onClick={() => batchMutation.mutate(pinCount)} disabled={batchMutation.isPending}>
                <Key className="h-3.5 w-3.5 mr-1" />{batchMutation.isPending ? "Generando..." : `Generar ${pinCount} PINs`}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="userpass" className="mt-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Nuevo Usuario</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Usuario *</Label><Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="usuario123" className="h-8 text-xs" /></div>
                <div className="space-y-1"><Label className="text-xs">Contraseña *</Label><Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="******" className="h-8 text-xs" /></div>
                <div className="space-y-1">
                  <Label className="text-xs">Perfil</Label>
                  <Select value={selectedProfile} onValueChange={setSelectedProfile}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{profiles.map((p: any) => <SelectItem key={p.name} value={p.name} className="text-xs">{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label className="text-xs">Comentario</Label><Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Opcional" className="h-8 text-xs" /></div>
              </div>
              <Button size="sm" onClick={handleAdd} disabled={addMutation.isPending}>
                <UserPlus className="h-3.5 w-3.5 mr-1" />{addMutation.isPending ? "Creando..." : "Crear Usuario"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
