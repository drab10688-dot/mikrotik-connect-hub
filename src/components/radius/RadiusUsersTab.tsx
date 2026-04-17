import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { radiusApi } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Edit, Search, Activity } from "lucide-react";
import { toast } from "sonner";
import { RadiusClientMonitor } from "./RadiusClientMonitor";

export function RadiusUsersTab() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ username: "", password: "", group: "", framed_ip: "" });
  const [monitorUser, setMonitorUser] = useState<string | null>(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["radius", "users", search],
    queryFn: () => radiusApi.listUsers({ search }),
  });
  const { data: groups = [] } = useQuery({ queryKey: ["radius", "groups"], queryFn: radiusApi.listGroups });

  const saveMut = useMutation({
    mutationFn: async () => {
      const attributes: any = {};
      if (form.framed_ip) attributes["Framed-IP-Address"] = form.framed_ip;
      if (editing) {
        return radiusApi.updateUser(editing.username, {
          password: form.password || undefined,
          group: form.group,
          attributes,
        });
      }
      return radiusApi.createUser({
        username: form.username,
        password: form.password,
        group: form.group || undefined,
        attributes,
      });
    },
    onSuccess: () => {
      toast.success(editing ? "Usuario actualizado" : "Usuario creado");
      qc.invalidateQueries({ queryKey: ["radius"] });
      setOpen(false);
      setEditing(null);
      setForm({ username: "", password: "", group: "", framed_ip: "" });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (username: string) => radiusApi.deleteUser(username),
    onSuccess: () => {
      toast.success("Usuario eliminado");
      qc.invalidateQueries({ queryKey: ["radius"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const startEdit = (u: any) => {
    setEditing(u);
    setForm({ username: u.username, password: "", group: (u.groups || "").split(",")[0] || "", framed_ip: "" });
    setOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar usuario..."
            className="pl-9"
          />
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditing(null); setForm({ username: "", password: "", group: "", framed_ip: "" }); } }}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />Nuevo usuario</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? `Editar ${editing.username}` : "Nuevo usuario RADIUS"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Username</Label>
                <Input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  disabled={!!editing}
                />
              </div>
              <div>
                <Label>Password {editing && <span className="text-xs text-muted-foreground">(dejar vacío para no cambiar)</span>}</Label>
                <Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
              <div>
                <Label>Perfil / Grupo</Label>
                <Select value={form.group} onValueChange={(v) => setForm({ ...form, group: v })}>
                  <SelectTrigger><SelectValue placeholder="Sin grupo" /></SelectTrigger>
                  <SelectContent>
                    {groups.map((g: any) => (
                      <SelectItem key={g.groupname} value={g.groupname}>{g.groupname}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>IP fija (opcional)</Label>
                <Input
                  value={form.framed_ip}
                  onChange={(e) => setForm({ ...form, framed_ip: e.target.value })}
                  placeholder="ej. 10.10.10.50"
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
              <TableHead>Usuario</TableHead>
              <TableHead>Perfil</TableHead>
              <TableHead>Sesiones activas</TableHead>
              <TableHead>Última sesión</TableHead>
              <TableHead>Tráfico total</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8">Cargando...</TableCell></TableRow>
            ) : users.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Sin usuarios</TableCell></TableRow>
            ) : users.map((u: any) => (
              <TableRow key={u.id}>
                <TableCell className="font-mono">
                  <button
                    className="hover:text-primary hover:underline transition text-left"
                    onClick={() => setMonitorUser(u.username)}
                  >
                    {u.username}
                  </button>
                </TableCell>
                <TableCell>{u.groups || <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>
                  {u.active_sessions > 0
                    ? <Badge variant="default">{u.active_sessions}</Badge>
                    : <span className="text-muted-foreground">0</span>}
                </TableCell>
                <TableCell className="text-xs">{u.last_session ? new Date(u.last_session).toLocaleString() : "—"}</TableCell>
                <TableCell>{formatBytes(Number(u.total_bytes || 0))}</TableCell>
                <TableCell className="text-right space-x-1">
                  <Button size="sm" variant="ghost" onClick={() => setMonitorUser(u.username)} title="Monitor">
                    <Activity className="w-4 h-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => startEdit(u)}>
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm(`¿Eliminar ${u.username}?`)) delMut.mutate(u.username);
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

      <RadiusClientMonitor
        username={monitorUser}
        open={!!monitorUser}
        onOpenChange={(o) => { if (!o) setMonitorUser(null); }}
      />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0; let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}
