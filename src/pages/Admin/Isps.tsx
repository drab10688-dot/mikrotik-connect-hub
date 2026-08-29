import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { tenantsApi } from "@/lib/api-client";
import { toast } from "sonner";
import { Building2, Copy, Plus, Save, Trash2, Antenna, ExternalLink } from "lucide-react";

interface Isp {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  primary_color: string | null;
  acs_token: string | null;
  onu_limit: number | null;
  is_active: boolean;
  users_count: string | number;
  onus_used: string | number;
  onus_blocked: string | number;
  vpn_count: string | number;
}

const copy = async (value: string) => {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("Copiado");
  } catch {
    toast.error("No se pudo copiar");
  }
};

const acsLink = (token: string | null) =>
  token ? `${window.location.origin.replace(/\/$/, "")}/tr069/${token}/` : "—";

const portalLink = (slug: string) =>
  `${window.location.origin.replace(/\/$/, "")}/isp/${slug}`;

export default function Isps() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    slug: "",
    onu_limit: "",
    admin_email: "",
    admin_password: "",
  });

  const { data: isps = [], isLoading } = useQuery<Isp[]>({
    queryKey: ["admin-isps"],
    queryFn: () => tenantsApi.list() as Promise<Isp[]>,
    refetchInterval: 30_000,
  });

  const createIsp = useMutation({
    mutationFn: () =>
      tenantsApi.create({
        name: form.name,
        slug: form.slug || undefined,
        onu_limit: form.onu_limit ? Number(form.onu_limit) : undefined,
        admin_email: form.admin_email || undefined,
        admin_password: form.admin_password || undefined,
      }),
    onSuccess: () => {
      toast.success("ISP creado con su propio enlace TR-069");
      setForm({ name: "", slug: "", onu_limit: "", admin_email: "", admin_password: "" });
      setCreating(false);
      qc.invalidateQueries({ queryKey: ["admin-isps"] });
    },
    onError: (e: any) => toast.error(e.message || "No se pudo crear el ISP"),
  });

  const updateIsp = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => tenantsApi.update(id, data),
    onSuccess: () => {
      toast.success("ISP actualizado");
      qc.invalidateQueries({ queryKey: ["admin-isps"] });
    },
    onError: (e: any) => toast.error(e.message || "No se pudo actualizar"),
  });

  const removeIsp = useMutation({
    mutationFn: (id: string) => tenantsApi.remove(id),
    onSuccess: () => {
      toast.success("ISP eliminado");
      qc.invalidateQueries({ queryKey: ["admin-isps"] });
    },
    onError: (e: any) => toast.error(e.message || "No se pudo eliminar"),
  });

  const uploadLogo = (isp: Isp, file: File) => {
    if (file.size > 400_000) {
      toast.error("El logo debe pesar menos de 400 KB");
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () =>
      updateIsp.mutate({ id: isp.id, data: { logo_url: reader.result as string } });
    reader.readAsDataURL(file);
  };

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="md:ml-64 min-w-0 p-4 md:p-8 pt-20 md:pt-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Building2 className="w-6 h-6 text-primary" />
              ISPs (multi-operador)
            </h1>
            <p className="text-sm text-muted-foreground">
              Cada ISP tiene su propio enlace TR-069, sus VPN y sus ONUs aisladas.
            </p>
          </div>
          <Button onClick={() => setCreating((v) => !v)}>
            <Plus className="w-4 h-4 mr-2" /> Nuevo ISP
          </Button>
        </div>

        {creating && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Crear ISP</CardTitle>
              <CardDescription>
                Se genera automáticamente un enlace TR-069 y una subred VPN exclusivos.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Nombre del ISP</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Identificador (slug)</Label>
                <Input
                  placeholder="opcional"
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Límite de ONUs</Label>
                <Input
                  type="number"
                  min={0}
                  placeholder="0 = ilimitado"
                  value={form.onu_limit}
                  onChange={(e) => setForm({ ...form, onu_limit: e.target.value })}
                />
              </div>
              <div />
              <div className="space-y-1.5">
                <Label>Email del administrador</Label>
                <Input
                  type="email"
                  value={form.admin_email}
                  onChange={(e) => setForm({ ...form, admin_email: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Contraseña del administrador</Label>
                <Input
                  type="password"
                  value={form.admin_password}
                  onChange={(e) => setForm({ ...form, admin_password: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <Button
                  disabled={!form.name || createIsp.isPending}
                  onClick={() => createIsp.mutate()}
                >
                  <Save className="w-4 h-4 mr-2" /> Crear ISP
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <p className="text-muted-foreground">Cargando ISPs…</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {isps.map((isp) => (
              <IspCard
                key={isp.id}
                isp={isp}
                onSave={(data) => updateIsp.mutate({ id: isp.id, data })}
                onLogo={(file) => uploadLogo(isp, file)}
                onDelete={() => removeIsp.mutate(isp.id)}
              />
            ))}
            {!isps.length && (
              <p className="text-muted-foreground">Todavía no hay ISPs registrados.</p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function IspCard({
  isp,
  onSave,
  onLogo,
  onDelete,
}: {
  isp: Isp;
  onSave: (data: any) => void;
  onLogo: (file: File) => void;
  onDelete: () => void;
}) {
  const [limit, setLimit] = useState(String(isp.onu_limit ?? ""));
  const [color, setColor] = useState(isp.primary_color || "#0EA5A4");
  const used = Number(isp.onus_used || 0);
  const blocked = Number(isp.onus_blocked || 0);
  const max = isp.onu_limit && isp.onu_limit > 0 ? isp.onu_limit : null;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center overflow-hidden shrink-0">
            {isp.logo_url ? (
              <img src={isp.logo_url} alt={isp.name} className="w-full h-full object-contain" />
            ) : (
              <Building2 className="w-5 h-5 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0">
            <CardTitle className="text-lg truncate">{isp.name}</CardTitle>
            <CardDescription className="truncate">/isp/{isp.slug}</CardDescription>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={!!isp.is_active}
            onCheckedChange={(v) => onSave({ is_active: v })}
            aria-label="Activo"
          />
          <Badge variant={isp.is_active ? "default" : "secondary"}>
            {isp.is_active ? "Activo" : "Inactivo"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/40 p-3 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Enlace TR-069 exclusivo</p>
          <div className="flex items-center gap-2">
            <code className="text-xs break-all flex-1">{acsLink(isp.acs_token)}</code>
            <Button size="icon" variant="ghost" onClick={() => copy(acsLink(isp.acs_token))}>
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="rounded-lg border bg-muted/40 p-3 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            Enlace de acceso del ISP (muestra su propio logo)
          </p>
          <div className="flex items-center gap-2">
            <code className="text-xs break-all flex-1">{portalLink(isp.slug)}</code>
            <Button size="icon" variant="ghost" onClick={() => copy(portalLink(isp.slug))}>
              <Copy className="w-4 h-4" />
            </Button>
            <Button size="icon" variant="ghost" asChild>
              <a href={portalLink(isp.slug)} target="_blank" rel="noreferrer">
                <ExternalLink className="w-4 h-4" />
              </a>
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Badge variant="outline" className="gap-1">
            <Antenna className="w-3.5 h-3.5" />
            {used}
            {max ? ` / ${max}` : " ONUs"}
          </Badge>
          {blocked > 0 && (
            <Badge variant="destructive">{blocked} fuera de cupo</Badge>
          )}
          <span className="text-muted-foreground">{isp.users_count} usuarios</span>
          <span className="text-muted-foreground">{isp.vpn_count} VPN</span>
        </div>

        <Separator />

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Límite de ONUs (0 = ilimitado)</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                min={0}
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
              <Button variant="secondary" onClick={() => onSave({ onu_limit: Number(limit || 0) })}>
                <Save className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Color de marca</Label>
            <div className="flex gap-2">
              <Input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-16 p-1" />
              <Button variant="secondary" onClick={() => onSave({ primary_color: color })}>
                <Save className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Label
            htmlFor={`logo-${isp.id}`}
            className="cursor-pointer inline-flex items-center rounded-md border px-3 py-2 text-sm hover:bg-accent"
          >
            Subir logo
          </Label>
          <input
            id={`logo-${isp.id}`}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onLogo(e.target.files[0])}
          />
          {isp.logo_url && (
            <Button variant="ghost" size="sm" onClick={() => onSave({ logo_url: "" })}>
              Quitar logo
            </Button>
          )}
          <Button variant="ghost" size="sm" className="text-destructive ml-auto" onClick={onDelete}>
            <Trash2 className="w-4 h-4 mr-1" /> Eliminar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
