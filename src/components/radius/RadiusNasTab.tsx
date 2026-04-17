import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { radiusApi, devicesApi } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Zap, FileCode } from "lucide-react";
import { toast } from "sonner";

export function RadiusNasTab() {
  const qc = useQueryClient();
  const [openManual, setOpenManual] = useState(false);
  const [openProvision, setOpenProvision] = useState(false);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [script, setScript] = useState("");
  const [form, setForm] = useState({ nasname: "", shortname: "", secret: "testing123", description: "" });
  const [prov, setProv] = useState({
    mikrotik_id: "",
    radius_host: "",
    secret: "testing123",
    enable_hotspot: true,
    enable_ppp: true,
    register_nas: true,
  });

  const { data: nas = [], isLoading } = useQuery({ queryKey: ["radius", "nas"], queryFn: radiusApi.listNas });
  const { data: devices = [] } = useQuery({ queryKey: ["devices"], queryFn: devicesApi.list });

  const createMut = useMutation({
    mutationFn: () => radiusApi.createNas(form),
    onSuccess: () => {
      toast.success("NAS registrado");
      qc.invalidateQueries({ queryKey: ["radius"] });
      setOpenManual(false);
      setForm({ nasname: "", shortname: "", secret: "testing123", description: "" });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: number) => radiusApi.deleteNas(id),
    onSuccess: () => {
      toast.success("NAS eliminado");
      qc.invalidateQueries({ queryKey: ["radius"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const provisionMut = useMutation({
    mutationFn: () =>
      radiusApi.provisionAuto(prov.mikrotik_id, {
        radius_host: prov.radius_host,
        secret: prov.secret,
        enable_hotspot: prov.enable_hotspot,
        enable_ppp: prov.enable_ppp,
        register_nas: prov.register_nas,
      }),
    onSuccess: (res: any) => {
      toast.success("MikroTik provisionado");
      qc.invalidateQueries({ queryKey: ["radius"] });
      setOpenProvision(false);
      console.log(res?.log);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const showScript = async () => {
    if (!prov.mikrotik_id || !prov.radius_host) {
      toast.error("Selecciona MikroTik y define el host del RADIUS");
      return;
    }
    try {
      const txt = await radiusApi.provisionScript(prov.mikrotik_id, {
        radius_host: prov.radius_host,
        secret: prov.secret,
      });
      setScript(txt);
      setScriptOpen(true);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 justify-end">
        <Dialog open={openProvision} onOpenChange={setOpenProvision}>
          <DialogTrigger asChild>
            <Button variant="default"><Zap className="w-4 h-4 mr-2" />Provisionar MikroTik</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Provisionar MikroTik para RADIUS</DialogTitle>
              <DialogDescription>
                Configura el router automáticamente vía API REST o descarga el script .rsc para pegarlo a mano.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>MikroTik</Label>
                <Select value={prov.mikrotik_id} onValueChange={(v) => setProv({ ...prov, mikrotik_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecciona dispositivo" /></SelectTrigger>
                  <SelectContent>
                    {devices.map((d: any) => (
                      <SelectItem key={d.id} value={d.id}>{d.name} ({d.host})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>IP/Host del RADIUS (visible desde el MikroTik)</Label>
                <Input
                  value={prov.radius_host}
                  onChange={(e) => setProv({ ...prov, radius_host: e.target.value })}
                  placeholder="ej. 10.13.13.1 (IP del VPS en WireGuard)"
                />
              </div>
              <div>
                <Label>Secret</Label>
                <Input value={prov.secret} onChange={(e) => setProv({ ...prov, secret: e.target.value })} />
              </div>
              <div className="flex items-center justify-between">
                <Label>Habilitar para Hotspot</Label>
                <Switch checked={prov.enable_hotspot} onCheckedChange={(v) => setProv({ ...prov, enable_hotspot: v })} />
              </div>
              <div className="flex items-center justify-between">
                <Label>Habilitar para PPPoE</Label>
                <Switch checked={prov.enable_ppp} onCheckedChange={(v) => setProv({ ...prov, enable_ppp: v })} />
              </div>
              <div className="flex items-center justify-between">
                <Label>Registrar NAS automáticamente</Label>
                <Switch checked={prov.register_nas} onCheckedChange={(v) => setProv({ ...prov, register_nas: v })} />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={showScript}>
                <FileCode className="w-4 h-4 mr-2" />Ver script
              </Button>
              <Button onClick={() => provisionMut.mutate()} disabled={provisionMut.isPending}>
                <Zap className="w-4 h-4 mr-2" />
                {provisionMut.isPending ? "Provisionando..." : "Provisionar ahora"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={openManual} onOpenChange={setOpenManual}>
          <DialogTrigger asChild>
            <Button variant="outline"><Plus className="w-4 h-4 mr-2" />Agregar NAS manual</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nuevo NAS / Router RADIUS</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>NAS Name (IP o hostname)</Label>
                <Input value={form.nasname} onChange={(e) => setForm({ ...form, nasname: e.target.value })} />
              </div>
              <div>
                <Label>Short name</Label>
                <Input value={form.shortname} onChange={(e) => setForm({ ...form, shortname: e.target.value })} />
              </div>
              <div>
                <Label>Secret</Label>
                <Input value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} />
              </div>
              <div>
                <Label>Descripción</Label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>Guardar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="border rounded-md overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>NAS</TableHead>
              <TableHead>Short</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Secret</TableHead>
              <TableHead>Descripción</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8">Cargando...</TableCell></TableRow>
            ) : nas.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Sin routers RADIUS</TableCell></TableRow>
            ) : nas.map((n: any) => (
              <TableRow key={n.id}>
                <TableCell className="font-mono">{n.nasname}</TableCell>
                <TableCell>{n.shortname}</TableCell>
                <TableCell>{n.type}</TableCell>
                <TableCell className="font-mono text-xs">••••••</TableCell>
                <TableCell className="text-xs">{n.description}</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm(`¿Eliminar NAS ${n.nasname}?`)) delMut.mutate(n.id);
                    }}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={scriptOpen} onOpenChange={setScriptOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Script RouterOS</DialogTitle>
            <DialogDescription>Copia y pega en la terminal del MikroTik.</DialogDescription>
          </DialogHeader>
          <pre className="bg-muted p-4 rounded-md text-xs font-mono overflow-auto max-h-[60vh]">{script}</pre>
          <DialogFooter>
            <Button onClick={() => { navigator.clipboard.writeText(script); toast.success("Copiado"); }}>
              Copiar al portapapeles
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
