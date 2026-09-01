import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { devicesApi, pppoeApi, usersApi } from "@/lib/api-client";
import { UserPermissionsDialog } from "@/components/admin/UserPermissionsDialog";
import { useAuth } from "@/hooks/useAuth";
import { useMyPermissions } from "@/hooks/usePermissions";
import { toast } from "sonner";
import { KeyRound, UserPlus, Users, Trash2, RefreshCw, Save, ShieldCheck, Layers, Share2, Send, MessageCircle, Copy } from "lucide-react";

/** "YERSON  PEPITO PERES" -> "yerson.pepito.peres" (igual que en la MikroTik) */
export const sanitizeUsername = (raw: string) =>
  String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ñ/g, "n")
    .replace(/Ñ/g, "N")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, ".")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.\-_]+|[.\-_]+$/g, "")
    .slice(0, 60);

type CreatedUser = { name: string; password?: string; remoteAddress?: string | null };


export default function PppoeUsers() {
  const qc = useQueryClient();
  const { isAdmin, isSuperAdmin } = useAuth();
  const { canEdit } = useMyPermissions();
  const canManage = canEdit("pppoe") || isAdmin || isSuperAdmin;

  const [deviceId, setDeviceId] = useState<string>(() => localStorage.getItem("mikrotik_device_id") || "");
  const [permUser, setPermUser] = useState<{ id: string; label: string } | null>(null);

  const { data: devices = [] } = useQuery({ queryKey: ["pppoe-devices"], queryFn: () => devicesApi.list() });

  useEffect(() => {
    if (!deviceId && devices.length) setDeviceId(devices[0].id);
  }, [devices, deviceId]);

  useEffect(() => {
    if (deviceId) localStorage.setItem("mikrotik_device_id", deviceId);
  }, [deviceId]);

  const { data: settings } = useQuery({
    queryKey: ["pppoe-settings", deviceId],
    queryFn: () => pppoeApi.getSettings(deviceId),
    enabled: !!deviceId,
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["pppoe-profiles", deviceId],
    queryFn: () => pppoeApi.profiles(deviceId),
    enabled: !!deviceId,
  });

  const { data: secrets = [], isFetching, refetch } = useQuery({
    queryKey: ["pppoe-secrets", deviceId],
    queryFn: () => pppoeApi.secrets(deviceId),
    enabled: !!deviceId,
    refetchInterval: 30_000,
  });

  // ─── Configuración global ───
  const [cfg, setCfg] = useState({
    global_password: "",
    use_global_password: true,
    default_profile: "",
    default_service: "pppoe",
    username_prefix: "",
    auto_assign_ip: true,
    ip_pool_start: "",
    ip_pool_end: "",
  });

  useEffect(() => {
    if (!settings) return;
    setCfg({
      global_password: settings.global_password || "",
      use_global_password: settings.use_global_password !== false,
      default_profile: settings.default_profile || "",
      default_service: settings.default_service || "pppoe",
      username_prefix: settings.username_prefix || "",
      auto_assign_ip: settings.auto_assign_ip !== false,
      ip_pool_start: settings.ip_pool_start || "",
      ip_pool_end: settings.ip_pool_end || "",
    });
  }, [settings]);

  const saveCfg = useMutation({
    mutationFn: () => pppoeApi.saveSettings(deviceId, cfg),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pppoe-settings", deviceId] });
      toast.success("Configuración PPPoE guardada");
    },
    onError: (e: any) => toast.error(e.message || "No se pudo guardar"),
  });

  // ─── Alta individual ───
  const [form, setForm] = useState({ name: "", password: "", profile: "", remoteAddress: "", comment: "" });
  const [bulk, setBulk] = useState("");
  const [created, setCreated] = useState<CreatedUser[]>([]);
  const [sharePhone, setSharePhone] = useState("");

  const createUsers = useMutation({
    mutationFn: (users: any[]) => pppoeApi.createUsers(deviceId, users),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["pppoe-secrets", deviceId] });
      const results = res?.results || [];
      const failed = results.filter((r: any) => !r.ok);
      setCreated(results.filter((r: any) => r.ok));
      if (res?.created) toast.success(`${res.created} usuario(s) PPPoE creados`);
      failed.forEach((f: any) => toast.error(`${f.name}: ${f.error}`));
      if (!res?.created && !failed.length) toast.error("No se creó ningún usuario");
    },
    onError: (e: any) => toast.error(e.message || "Error creando usuarios"),
  });

  // Solo se comparte el nombre de usuario: nunca la clave ni la IP.
  const shareText = useMemo(() => {
    if (!created.length) return "";
    const lines = created.map((u) => `👤 Usuario: ${u.name}`);
    return (
      `Datos de tu conexión a Internet (PPPoE):\n\n${lines.join("\n")}\n\n` +
      `🔒 La contraseña y la IP son internas y no se envían por este medio.\n` +
      `— Creado por OmniSync`
    );
  }, [created]);


  const shareWhatsApp = () => {
    const phone = sharePhone.replace(/\D/g, "");
    window.open(
      `https://wa.me/${phone}?text=${encodeURIComponent(shareText)}`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  const shareTelegram = () => {
    window.open(
      `https://t.me/share/url?url=${encodeURIComponent("")}&text=${encodeURIComponent(shareText)}`,
      "_blank",
      "noopener,noreferrer"
    );
  };


  const removeSecret = useMutation({
    mutationFn: (id: string) => pppoeApi.deleteSecret(deviceId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pppoe-secrets", deviceId] });
      toast.success("Usuario PPPoE eliminado");
    },
    onError: (e: any) => toast.error(e.message || "No se pudo eliminar"),
  });

  const submitSingle = () => {
    if (!form.name.trim()) return toast.error("Escribe el nombre de usuario");
    createUsers.mutate([
      {
        name: form.name.trim(),
        password: form.password.trim() || undefined,
        profile: form.profile || undefined,
        remoteAddress: form.remoteAddress.trim() || undefined,
        comment: form.comment.trim() || undefined,
      },
    ]);
    setForm({ name: "", password: "", profile: "", remoteAddress: "", comment: "" });
  };

  const bulkList = useMemo(
    () =>
      bulk
        .split(/[\n,;]+/)
        .map((l) => l.trim())
        .filter(Boolean),
    [bulk]
  );

  const submitBulk = () => {
    if (!bulkList.length) return toast.error("Agrega al menos un nombre");
    createUsers.mutate(bulkList.map((name) => ({ name })));
    setBulk("");
  };

  // ─── Permisos por usuario del panel ───
  const { data: panelUsers = [] } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => usersApi.list(),
    enabled: isAdmin || isSuperAdmin,
  });

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="relative flex-1 min-w-0 overflow-auto p-4 md:p-8 md:ml-64 space-y-6">
        <header className="glass-panel hairline-top flex flex-wrap items-center justify-between gap-4 p-5 animate-fade-in-up">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/25">
              <Users className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-xl font-bold tracking-tight md:text-2xl">Usuarios PPPoE</h1>
              <p className="text-sm text-muted-foreground">
                Crea secretos PPPoE con una contraseña global del ISP y controla quién puede hacerlo.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={deviceId} onValueChange={setDeviceId}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Selecciona MikroTik" />
              </SelectTrigger>
              <SelectContent>
                {devices.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </header>

        <Tabs defaultValue="crear" className="space-y-5">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-2 bg-card/60 p-1.5 backdrop-blur">
            <TabsTrigger value="crear"><UserPlus className="mr-2 h-4 w-4" />Crear usuarios</TabsTrigger>
            <TabsTrigger value="lista"><Users className="mr-2 h-4 w-4" />Usuarios PPPoE</TabsTrigger>
            <TabsTrigger value="config"><KeyRound className="mr-2 h-4 w-4" />Contraseña global</TabsTrigger>
            <TabsTrigger value="permisos"><ShieldCheck className="mr-2 h-4 w-4" />Permisos por usuario</TabsTrigger>
          </TabsList>

          {/* Crear */}
          <TabsContent value="crear" className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Nuevo usuario PPPoE</CardTitle>
                <CardDescription>
                  {cfg.use_global_password && cfg.global_password
                    ? "Si dejas la contraseña vacía se usará la contraseña global del ISP."
                    : "Define una contraseña individual (no hay contraseña global activa)."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Nombre del cliente</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="YERSON PEPITO PERES"
                  />
                  <p className="text-xs text-muted-foreground">
                    En la MikroTik quedará como{" "}
                    <span className="font-mono text-primary">
                      {(cfg.username_prefix || "") + (sanitizeUsername(form.name) || "…")}
                    </span>
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label>Contraseña (opcional)</Label>
                  <Input
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="Usar contraseña global"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Perfil</Label>
                  <Select value={form.profile} onValueChange={(v) => setForm({ ...form, profile: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder={cfg.default_profile || "Perfil por defecto"} />
                    </SelectTrigger>
                    <SelectContent>
                      {profiles.map((p: any) => (
                        <SelectItem key={p[".id"] || p.name} value={p.name}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>IP remota (opcional)</Label>
                  <Input
                    value={form.remoteAddress}
                    onChange={(e) => setForm({ ...form, remoteAddress: e.target.value })}
                    placeholder={cfg.auto_assign_ip ? "Automática (siguiente libre del rango)" : "10.10.0.25"}
                  />
                  {cfg.auto_assign_ip && (
                    <p className="text-xs text-muted-foreground">
                      Si lo dejas vacío se asigna sola la siguiente IP libre
                      {cfg.ip_pool_start ? ` desde ${cfg.ip_pool_start}` : " (configura el rango en Contraseña global)"}.
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>Comentario</Label>
                  <Input
                    value={form.comment}
                    onChange={(e) => setForm({ ...form, comment: e.target.value })}
                    placeholder="Nombre del cliente"
                  />
                </div>
                <Button
                  className="w-full bg-gradient-primary text-primary-foreground"
                  onClick={submitSingle}
                  disabled={!deviceId || !canManage || createUsers.isPending}
                >
                  <UserPlus className="mr-2 h-4 w-4" />
                  Crear usuario
                </Button>
                {!canManage && (
                  <p className="text-xs text-destructive">No tienes permiso de edición en la sección PPPoE.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Layers className="h-4 w-4" /> Alta masiva
                </CardTitle>
                <CardDescription>
                  Un nombre por línea. Todos se crean con la contraseña y el perfil global.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  rows={10}
                  value={bulk}
                  onChange={(e) => setBulk(e.target.value)}
                  placeholder={"cliente001\ncliente002\ncliente003"}
                />
                <div className="flex items-center justify-between">
                  <Badge variant="secondary">{bulkList.length} usuario(s)</Badge>
                  <Button onClick={submitBulk} disabled={!deviceId || !canManage || createUsers.isPending}>
                    Crear todos
                  </Button>
                </div>
              </CardContent>
            </Card>

            {created.length > 0 && (
              <Card className="lg:col-span-2 border-primary/30">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Share2 className="h-4 w-4" /> Compartir usuario
                  </CardTitle>
                  <CardDescription>
                    {created.length} usuario(s) creados. Al compartir solo se envía el nombre de usuario
                    (la clave y la IP nunca salen del panel), firmado como “Creado por OmniSync”.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    {created.map((u) => (
                      <div
                        key={u.name}
                        className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border/60 px-3 py-2 text-sm"
                      >
                        <span className="font-mono font-medium">{u.name}</span>
                        <span className="text-muted-foreground">Clave: •••••••• (no se comparte)</span>
                        {u.remoteAddress && <Badge variant="secondary">IP {u.remoteAddress} (interna)</Badge>}
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[200px] flex-1 space-y-1.5">
                      <Label>WhatsApp del cliente (con indicativo)</Label>
                      <Input
                        value={sharePhone}
                        onChange={(e) => setSharePhone(e.target.value)}
                        placeholder="573001234567"
                      />
                    </div>
                    <Button onClick={shareWhatsApp} disabled={sharePhone.replace(/\D/g, "").length < 8}>
                      <MessageCircle className="mr-2 h-4 w-4" /> WhatsApp
                    </Button>
                    <Button variant="outline" onClick={shareTelegram}>
                      <Send className="mr-2 h-4 w-4" /> Telegram
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        navigator.clipboard?.writeText(shareText);
                        toast.success("Credenciales copiadas");
                      }}
                    >
                      <Copy className="mr-2 h-4 w-4" /> Copiar
                    </Button>
                    <Button variant="ghost" onClick={() => setCreated([])}>
                      Ocultar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>


          {/* Lista */}
          <TabsContent value="lista">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Secretos PPPoE en la MikroTik</CardTitle>
                <CardDescription>{secrets.length} usuario(s) configurados</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Usuario</TableHead>
                      <TableHead>Perfil</TableHead>
                      <TableHead>Servicio</TableHead>
                      <TableHead>Comentario</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {secrets.map((s: any) => (
                      <TableRow key={s[".id"] || s.name}>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell>{s.profile || "-"}</TableCell>
                        <TableCell>{s.service || "pppoe"}</TableCell>
                        <TableCell className="max-w-[220px] truncate">{s.comment || "-"}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!canManage}
                            onClick={() => {
                              if (window.confirm(`¿Eliminar el usuario PPPoE "${s.name}"?`))
                                removeSecret.mutate(s[".id"]);
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!secrets.length && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                          Sin usuarios PPPoE
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Configuración global */}
          <TabsContent value="config">
            <Card className="max-w-2xl">
              <CardHeader>
                <CardTitle className="text-base">Contraseña global del ISP</CardTitle>
                <CardDescription>
                  Se aplica a los usuarios PPPoE creados desde el panel para este MikroTik.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between rounded-lg border border-border/60 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">Usar contraseña global</p>
                    <p className="text-xs text-muted-foreground">Si se desactiva, cada alta pedirá su contraseña.</p>
                  </div>
                  <Switch
                    checked={cfg.use_global_password}
                    disabled={!isAdmin && !isSuperAdmin}
                    onCheckedChange={(v) => setCfg({ ...cfg, use_global_password: v })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Contraseña global</Label>
                  <Input
                    value={cfg.global_password}
                    disabled={!isAdmin && !isSuperAdmin}
                    onChange={(e) => setCfg({ ...cfg, global_password: e.target.value })}
                    placeholder="Contraseña compartida"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Perfil por defecto</Label>
                    <Select
                      value={cfg.default_profile}
                      onValueChange={(v) => setCfg({ ...cfg, default_profile: v })}
                      disabled={!isAdmin && !isSuperAdmin}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="default" />
                      </SelectTrigger>
                      <SelectContent>
                        {profiles.map((p: any) => (
                          <SelectItem key={p[".id"] || p.name} value={p.name}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Prefijo de usuario (opcional)</Label>
                    <Input
                      value={cfg.username_prefix}
                      disabled={!isAdmin && !isSuperAdmin}
                      onChange={(e) => setCfg({ ...cfg, username_prefix: e.target.value })}
                      placeholder="isp-"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border/60 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">Asignar IP automáticamente</p>
                    <p className="text-xs text-muted-foreground">
                      Toma la siguiente IP libre del rango al crear cada usuario PPPoE.
                    </p>
                  </div>
                  <Switch
                    checked={cfg.auto_assign_ip}
                    disabled={!isAdmin && !isSuperAdmin}
                    onCheckedChange={(v) => setCfg({ ...cfg, auto_assign_ip: v })}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>IP inicial del rango</Label>
                    <Input
                      value={cfg.ip_pool_start}
                      disabled={!isAdmin && !isSuperAdmin}
                      onChange={(e) => setCfg({ ...cfg, ip_pool_start: e.target.value })}
                      placeholder="10.10.0.2"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>IP final (opcional)</Label>
                    <Input
                      value={cfg.ip_pool_end}
                      disabled={!isAdmin && !isSuperAdmin}
                      onChange={(e) => setCfg({ ...cfg, ip_pool_end: e.target.value })}
                      placeholder="10.10.7.254"
                    />
                  </div>
                </div>

                <Button
                  onClick={() => saveCfg.mutate()}
                  disabled={!deviceId || saveCfg.isPending || (!isAdmin && !isSuperAdmin)}
                  className="bg-gradient-primary text-primary-foreground"
                >
                  <Save className="mr-2 h-4 w-4" />
                  {saveCfg.isPending ? "Guardando…" : "Guardar configuración"}
                </Button>
                {!isAdmin && !isSuperAdmin && (
                  <p className="text-xs text-muted-foreground">
                    Solo el administrador del ISP puede cambiar la contraseña global.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Permisos por usuario del panel */}
          <TabsContent value="permisos">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Permisos por usuario del panel</CardTitle>
                <CardDescription>
                  Define quién puede ver y crear usuarios PPPoE (y el resto de secciones) dentro de este ISP.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {!isAdmin && !isSuperAdmin ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Solo el administrador del ISP puede gestionar permisos.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Usuario</TableHead>
                        <TableHead>Correo</TableHead>
                        <TableHead>Rol</TableHead>
                        <TableHead className="text-right">Permisos</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {panelUsers.map((u: any) => (
                        <TableRow key={u.id}>
                          <TableCell className="font-medium">{u.full_name || "Sin nombre"}</TableCell>
                          <TableCell>{u.email}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{u.role || "user"}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setPermUser({ id: u.id, label: u.full_name || u.email })}
                            >
                              <ShieldCheck className="mr-2 h-4 w-4" />
                              Editar
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <UserPermissionsDialog
          userId={permUser?.id || null}
          userLabel={permUser?.label}
          open={!!permUser}
          onOpenChange={(o) => !o && setPermUser(null)}
        />
      </main>
    </div>
  );
}
