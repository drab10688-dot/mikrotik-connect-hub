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
import { Textarea } from "@/components/ui/textarea";
import { Building2, Copy, Plus, Save, Trash2, Antenna, ExternalLink, Megaphone } from "lucide-react";
import { mergeLanding, type LandingContent } from "@/lib/landing";

interface Isp {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  primary_color: string | null;
  acs_token: string | null;
  onu_limit: number | null;
  user_limit: number | null;
  is_active: boolean;
  enable_onus?: boolean;
  enable_mikrotik?: boolean;
  enable_tr069?: boolean;
  enable_onu_web?: boolean;
  web_ports?: Record<string, { port: number; protocol: 'http' | 'https' }> | null;
  landing?: any;
  onu_networks?: string | null;
  vpn_subnet?: string | null;
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
    user_limit: "",
    admin_email: "",
    admin_password: "",
    onu_networks: "192.168.0.0/16",
  });

  const { data: isps = [], isLoading } = useQuery<Isp[]>({
    queryKey: ["admin-isps"],
    queryFn: () => tenantsApi.list() as Promise<Isp[]>,
    refetchInterval: 30_000,
  });

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.admin_email.trim());
  const passwordOk = form.admin_password.length >= 10;

  const createIsp = useMutation({
    mutationFn: () =>
      tenantsApi.create({
        name: form.name,
        slug: form.slug || undefined,
        onu_limit: form.onu_limit ? Number(form.onu_limit) : undefined,
        user_limit: form.user_limit ? Number(form.user_limit) : undefined,
        admin_email: form.admin_email || undefined,
        admin_password: form.admin_password || undefined,
        onu_networks: form.onu_networks || undefined,
      }),
    onSuccess: () => {
      toast.success("ISP creado con su propio enlace TR-069");
      setForm({ name: "", slug: "", onu_limit: "", user_limit: "", admin_email: "", admin_password: "", onu_networks: "192.168.0.0/16" });
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

  /** Acepta logos grandes (hasta 8 MB) y los reescala en el navegador. */
  const uploadLogo = async (isp: Isp, file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("El archivo debe ser una imagen");
      return;
    }
    if (file.size > 8_000_000) {
      toast.error("El logo debe pesar menos de 8 MB");
      return;
    }
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });

      // SVG y archivos pequeños se suben tal cual (sin pérdida)
      if (file.type === "image/svg+xml" || file.size <= 300_000) {
        updateIsp.mutate({ id: isp.id, data: { logo_url: dataUrl } });
        return;
      }

      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Imagen inválida"));
        el.src = dataUrl;
      });

      const MAX = 1024; // lado máximo: suficiente para pantallas retina
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No se pudo procesar la imagen");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // PNG conserva transparencia; si pesa mucho se pasa a WebP
      let out = canvas.toDataURL("image/png");
      if (out.length > 400_000) out = canvas.toDataURL("image/webp", 0.9);
      if (out.length > 400_000) out = canvas.toDataURL("image/webp", 0.75);

      updateIsp.mutate({ id: isp.id, data: { logo_url: out } });
    } catch (e: any) {
      toast.error(e?.message || "No se pudo procesar el logo");
    }
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
              <div className="space-y-1.5">
                <Label>Límite de usuarios del panel</Label>
                <Input
                  type="number"
                  min={0}
                  placeholder="0 = ilimitado"
                  value={form.user_limit}
                  onChange={(e) => setForm({ ...form, user_limit: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  Email del administrador <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="email"
                  required
                  placeholder="admin@tuisp.com"
                  value={form.admin_email}
                  onChange={(e) => setForm({ ...form, admin_email: e.target.value })}
                />
                {form.admin_email && !emailOk && (
                  <p className="text-xs text-destructive">Escribe un correo válido</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>
                  Contraseña del administrador <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="password"
                  required
                  placeholder="Mínimo 10 caracteres"
                  value={form.admin_password}
                  onChange={(e) => setForm({ ...form, admin_password: e.target.value })}
                />
                {form.admin_password && !passwordOk && (
                  <p className="text-xs text-destructive">Debe tener al menos 10 caracteres</p>
                )}
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>Red de ONUs / antenas (detrás de la MikroTik)</Label>
                <Input
                  placeholder="192.168.0.0/16"
                  value={form.onu_networks}
                  onChange={(e) => setForm({ ...form, onu_networks: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Subredes a las que el VPS llegará por la VPN. Separa varias con coma. Define el enrutamiento del navegador remoto y el panel.
                </p>
              </div>
              <div className="md:col-span-2 space-y-2">
                <p className="text-xs text-muted-foreground">
                  El correo y la contraseña del administrador son obligatorios: con ellos entra al ISP y recibe el enlace de restablecimiento.
                </p>
                <Button
                  disabled={!form.name || !emailOk || !passwordOk || createIsp.isPending}
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
  const [userLimit, setUserLimit] = useState(String(isp.user_limit ?? ""));
  const [color, setColor] = useState(isp.primary_color || "#0EA5A4");
  const [mkPort, setMkPort] = useState(String(isp.web_ports?.mikrotik?.port ?? 80));
  const [ubntPort, setUbntPort] = useState(String(isp.web_ports?.ubiquiti?.port ?? 443));
  const [onuNetworks, setOnuNetworks] = useState(isp.onu_networks || "192.168.0.0/16");
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
          <span className="text-muted-foreground">
            {isp.users_count}
            {isp.user_limit && isp.user_limit > 0 ? ` / ${isp.user_limit}` : ""} usuarios
          </span>
          {!!isp.user_limit && isp.user_limit > 0 && Number(isp.users_count) >= isp.user_limit && (
            <Badge variant="destructive">Cupo de usuarios lleno</Badge>
          )}
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
            <Label className="text-xs">Límite de usuarios (0 = ilimitado)</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                min={0}
                value={userLimit}
                onChange={(e) => setUserLimit(e.target.value)}
              />
              <Button variant="secondary" onClick={() => onSave({ user_limit: Number(userLimit || 0) })}>
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

        <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
          <Label className="text-xs font-medium">Red de ONUs / antenas (detrás de la MikroTik)</Label>
          <div className="flex gap-2">
            <Input
              placeholder="192.168.0.0/16"
              value={onuNetworks}
              onChange={(e) => setOnuNetworks(e.target.value)}
            />
            <Button variant="secondary" onClick={() => onSave({ onu_networks: onuNetworks })}>
              <Save className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Subredes a las que el VPS llega por la VPN. Separa varias con coma (ej: 192.168.0.0/24,192.168.1.0/24).
            Al cambiarla, regenera la VPN del ISP para que el VPS instale las rutas nuevas.
          </p>
        </div>

        <div className="rounded-lg border p-3 space-y-3">
          <p className="text-xs font-medium text-muted-foreground">Módulos habilitados para este ISP</p>
          <div className="flex items-center justify-between">
            <Label className="text-sm font-normal">Gestión de ONUs</Label>
            <Switch
              checked={isp.enable_onus !== false}
              onCheckedChange={(v) => onSave({ enable_onus: v })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-sm font-normal">Conexión MikroTik (PPPoE / WebFig)</Label>
            <Switch
              checked={isp.enable_mikrotik !== false}
              onCheckedChange={(v) => onSave({ enable_mikrotik: v })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-sm font-normal">TR-069 / ACS (GenieACS)</Label>
            <Switch
              checked={isp.enable_tr069 !== false}
              onCheckedChange={(v) => onSave({ enable_tr069: v })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-sm font-normal">Acceso web directo a ONUs (sin TR-069)</Label>
            <Switch
              checked={isp.enable_onu_web !== false}
              onCheckedChange={(v) => onSave({ enable_onu_web: v })}
            />
          </div>
        </div>

        <div className="rounded-lg border p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Puertos web por marca (para abrir equipos dentro del panel)
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">MikroTik (WebFig)</Label>
              <Input
                type="number"
                min={1}
                value={mkPort}
                onChange={(e) => setMkPort(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Ubiquiti (airOS)</Label>
              <Input
                type="number"
                min={1}
                value={ubntPort}
                onChange={(e) => setUbntPort(e.target.value)}
              />
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              onSave({
                web_ports: {
                  ...(isp.web_ports || {}),
                  mikrotik: { port: Number(mkPort) || 80, protocol: Number(mkPort) === 443 ? 'https' : 'http' },
                  ubiquiti: { port: Number(ubntPort) || 443, protocol: Number(ubntPort) === 80 ? 'http' : 'https' },
                },
              })
            }
          >
            <Save className="w-4 h-4 mr-2" /> Guardar puertos
          </Button>
        </div>

        <LandingEditor isp={isp} onSave={onSave} />

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

/** Editor de la publicidad que ve el cliente en /isp/:slug */
function LandingEditor({ isp, onSave }: { isp: Isp; onSave: (data: any) => void }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<LandingContent>(() => mergeLanding(isp.landing));

  const setField = (key: keyof LandingContent, value: string) =>
    setData((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Megaphone className="w-3.5 h-3.5" />
          Publicidad de la página de inicio
        </span>
        <span className="text-xs text-muted-foreground">{open ? "Ocultar" : "Editar"}</span>
      </button>

      {open && (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Etiqueta superior</Label>
              <Input value={data.badge} onChange={(e) => setField("badge", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Texto del botón</Label>
              <Input value={data.cta} onChange={(e) => setField("cta", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Titular</Label>
              <Input value={data.headline} onChange={(e) => setField("headline", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Palabra destacada</Label>
              <Input value={data.highlight} onChange={(e) => setField("highlight", e.target.value)} />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Descripción</Label>
            <Textarea
              rows={3}
              value={data.subheadline}
              onChange={(e) => setField("subheadline", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Indicadores (3)</p>
            {data.metrics.map((m, i) => (
              <div key={i} className="grid grid-cols-2 gap-2">
                <Input
                  value={m.value}
                  placeholder="24/7"
                  onChange={(e) =>
                    setData((prev) => ({
                      ...prev,
                      metrics: prev.metrics.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                    }))
                  }
                />
                <Input
                  value={m.label}
                  placeholder="Monitoreo"
                  onChange={(e) =>
                    setData((prev) => ({
                      ...prev,
                      metrics: prev.metrics.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                    }))
                  }
                />
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Tarjetas de beneficios (4)</p>
            {data.features.map((f, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr]">
                <Input
                  value={f.title}
                  placeholder="Título"
                  onChange={(e) =>
                    setData((prev) => ({
                      ...prev,
                      features: prev.features.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                    }))
                  }
                />
                <Input
                  value={f.text}
                  placeholder="Descripción corta"
                  onChange={(e) =>
                    setData((prev) => ({
                      ...prev,
                      features: prev.features.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)),
                    }))
                  }
                />
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => onSave({ landing: data })}>
              <Save className="w-4 h-4 mr-2" /> Guardar publicidad
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setData(mergeLanding(null))}>
              Restaurar textos por defecto
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
