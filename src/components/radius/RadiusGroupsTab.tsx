import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { radiusApi } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Edit } from "lucide-react";
import { toast } from "sonner";

export function RadiusGroupsTab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({
    groupname: "",
    rate_limit: "",
    session_timeout: "",
    idle_timeout: "",
    total_limit: "",
    address_list: "",
  });

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ["radius", "groups"],
    queryFn: radiusApi.listGroups,
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const attributes: any = {};
      if (form.rate_limit) attributes["Mikrotik-Rate-Limit"] = form.rate_limit;
      if (form.session_timeout) attributes["Session-Timeout"] = form.session_timeout;
      if (form.idle_timeout) attributes["Idle-Timeout"] = form.idle_timeout;
      if (form.total_limit) attributes["Mikrotik-Total-Limit"] = form.total_limit;
      if (form.address_list) attributes["Mikrotik-Address-List"] = form.address_list;

      if (editing) return radiusApi.updateGroup(editing.groupname, attributes);
      return radiusApi.createGroup(form.groupname, attributes);
    },
    onSuccess: () => {
      toast.success(editing ? "Perfil actualizado" : "Perfil creado");
      qc.invalidateQueries({ queryKey: ["radius"] });
      setOpen(false);
      setEditing(null);
      setForm({ groupname: "", rate_limit: "", session_timeout: "", idle_timeout: "", total_limit: "", address_list: "" });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (gn: string) => radiusApi.deleteGroup(gn),
    onSuccess: () => {
      toast.success("Perfil eliminado");
      qc.invalidateQueries({ queryKey: ["radius"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const startEdit = (g: any) => {
    setEditing(g);
    setForm({
      groupname: g.groupname,
      rate_limit: g.attributes?.["Mikrotik-Rate-Limit"] || "",
      session_timeout: g.attributes?.["Session-Timeout"] || "",
      idle_timeout: g.attributes?.["Idle-Timeout"] || "",
      total_limit: g.attributes?.["Mikrotik-Total-Limit"] || "",
      address_list: g.attributes?.["Mikrotik-Address-List"] || "",
    });
    setOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Los perfiles aplican atributos RADIUS a usuarios (velocidad, cuota, timeouts).
        </p>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditing(null); setForm({ groupname: "", rate_limit: "", session_timeout: "", idle_timeout: "", total_limit: "", address_list: "" }); } }}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />Nuevo perfil</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editing ? `Editar ${editing.groupname}` : "Nuevo perfil RADIUS"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Nombre del perfil</Label>
                <Input
                  value={form.groupname}
                  onChange={(e) => setForm({ ...form, groupname: e.target.value })}
                  disabled={!!editing}
                  placeholder="ej. plan-10mb"
                />
              </div>
              <div>
                <Label>Rate-Limit (subida/bajada)</Label>
                <Input
                  value={form.rate_limit}
                  onChange={(e) => setForm({ ...form, rate_limit: e.target.value })}
                  placeholder="ej. 5M/10M"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Session-Timeout (seg)</Label>
                  <Input
                    value={form.session_timeout}
                    onChange={(e) => setForm({ ...form, session_timeout: e.target.value })}
                    placeholder="ej. 3600"
                  />
                </div>
                <div>
                  <Label>Idle-Timeout (seg)</Label>
                  <Input
                    value={form.idle_timeout}
                    onChange={(e) => setForm({ ...form, idle_timeout: e.target.value })}
                    placeholder="ej. 600"
                  />
                </div>
              </div>
              <div>
                <Label>Cuota total de datos (bytes)</Label>
                <Input
                  value={form.total_limit}
                  onChange={(e) => setForm({ ...form, total_limit: e.target.value })}
                  placeholder="ej. 1073741824 (1 GB)"
                />
              </div>
              <div>
                <Label>Address-List (opcional)</Label>
                <Input
                  value={form.address_list}
                  onChange={(e) => setForm({ ...form, address_list: e.target.value })}
                  placeholder="ej. clientes-vip"
                />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                {saveMut.isPending ? "Guardando..." : "Guardar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="border rounded-md overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Perfil</TableHead>
              <TableHead>Velocidad</TableHead>
              <TableHead>Session TO</TableHead>
              <TableHead>Cuota</TableHead>
              <TableHead>Usuarios</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8">Cargando...</TableCell></TableRow>
            ) : groups.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Sin perfiles</TableCell></TableRow>
            ) : groups.map((g: any) => (
              <TableRow key={g.groupname}>
                <TableCell className="font-mono">{g.groupname}</TableCell>
                <TableCell>{g.rate_limit || "—"}</TableCell>
                <TableCell>{g.session_timeout || "—"}</TableCell>
                <TableCell>{g.total_limit || "—"}</TableCell>
                <TableCell>{g.user_count}</TableCell>
                <TableCell className="text-right space-x-1">
                  <Button size="sm" variant="ghost" onClick={() => startEdit(g)}>
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm(`¿Eliminar perfil ${g.groupname}? Los usuarios quedarán sin grupo.`)) delMut.mutate(g.groupname);
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
    </div>
  );
}
