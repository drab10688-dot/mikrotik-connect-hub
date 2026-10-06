import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cpeApi } from "@/lib/api-client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { AlertTriangle, KeyRound, Loader2, RefreshCw, ScanSearch, UserCog, Plus, Trash2, CheckCircle2, XCircle, PlugZap } from "lucide-react";

const QUALITY: Record<string, { label: string; className: string }> = {
  excelente: { label: "Excelente", className: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" },
  buena: { label: "Buena", className: "bg-sky-500/15 text-sky-500 border-sky-500/30" },
  regular: { label: "Regular", className: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
  mala: { label: "Mala", className: "bg-destructive/15 text-destructive border-destructive/30" },
  desconocida: { label: "Sin datos", className: "bg-muted text-muted-foreground" },
};

const BRAND_LABEL: Record<string, string> = { mikrotik: "MikroTik", ubiquiti: "Ubiquiti" };
const ACTION_LABEL: Record<string, string> = {
  identify: "Identificar",
  "pppoe-user": "Cambiar usuario PPPoE",
  password: "Cambiar clave de acceso",
  "enable-api": "Activar API (WebFig)",
  users: "Usuarios de la antena",
};

/** Credenciales de las antenas cliente de la sede, por marca. Las claves nunca se muestran. */
function CredentialsCard({ deviceId }: { deviceId: string }) {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, { username: string; ssh_port: string; api_port: string; web_port: string; add_password: string }>>({});

  const { data: creds } = useQuery({
    queryKey: ["cpe-creds", deviceId],
    queryFn: () => cpeApi.credentials(deviceId),
    enabled: !!deviceId,
  });

  useEffect(() => {
    if (!creds) return;
    const next: typeof form = {};
    for (const c of creds) next[c.brand] = { username: c.username, ssh_port: String(c.ssh_port || 22), api_port: String(c.api_port || 8728), web_port: c.web_port ? String(c.web_port) : "", add_password: "" };
    setForm(next);
  }, [creds]);

  const save = useMutation({
    mutationFn: ({ brand, clear }: { brand: string; clear?: boolean }) =>
      cpeApi.saveCredentials(deviceId, {
        brand,
        username: form[brand].username,
        ssh_port: Number(form[brand].ssh_port) || 22,
        api_port: Number(form[brand].api_port) || 8728,
        web_port: Number(form[brand].web_port) || null,
        add_password: form[brand].add_password || undefined,
        clear_passwords: clear,
      }),
    onSuccess: (_d, { clear }) => {
      toast.success(clear ? "Claves borradas" : "Credenciales guardadas");
      qc.invalidateQueries({ queryKey: ["cpe-creds", deviceId] });
    },
    onError: (e: any) => toast.error(e.message || "No se pudieron guardar"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><KeyRound className="w-4 h-4" /> Acceso a las antenas de esta sede</CardTitle>
        <CardDescription>
          Usuario, claves y puertos con que el sistema entra a las antenas de los clientes (MikroTik por API, o SSH; Ubiquiti por SSH; la web la usa el robot). Puedes guardar varias claves: se prueban
          en orden y el sistema recuerda cuál entró en cada antena. Las claves no se vuelven a mostrar.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {(creds || []).map((c: any) => {
          const f = form[c.brand] || { username: "", ssh_port: "22", api_port: "8728", web_port: "", add_password: "" };
          const set = (patch: Partial<typeof f>) => setForm({ ...form, [c.brand]: { ...f, ...patch } });
          return (
            <div key={c.brand} className="rounded-lg border p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-medium">{BRAND_LABEL[c.brand]}</p>
                <Badge variant={c.password_count ? "secondary" : "outline"}>
                  {c.password_count ? `${c.password_count} clave${c.password_count > 1 ? "s" : ""} guardada${c.password_count > 1 ? "s" : ""}` : "Sin claves"}
                </Badge>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Usuario</Label>
                <Input value={f.username} disabled={!isAdmin} onChange={(e) => set({ username: e.target.value })} />
              </div>
              {/* Todos los puertos de acceso de la sede en un solo lugar */}
              <div className={`grid gap-2 ${c.brand === "mikrotik" ? "grid-cols-3" : "grid-cols-2"}`}>
                {c.brand === "mikrotik" && (
                  <div className="space-y-1">
                    <Label className="text-xs" title="Puerto del servicio api en IP → Services (8728 de fábrica)">Puerto API</Label>
                    <Input type="number" value={f.api_port} disabled={!isAdmin} onChange={(e) => set({ api_port: e.target.value })} />
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-xs">Puerto SSH</Label>
                  <Input type="number" value={f.ssh_port} disabled={!isAdmin} onChange={(e) => set({ ssh_port: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs" title={c.brand === "mikrotik" ? "WebFig (www en IP → Services)" : "Web de airOS"}>
                    Puerto web
                  </Label>
                  <Input
                    type="number"
                    placeholder={`${c.isp_web_port ?? ""} (ISP)`}
                    value={f.web_port}
                    disabled={!isAdmin}
                    onChange={(e) => set({ web_port: e.target.value })}
                  />
                </div>
              </div>
              {isAdmin && (
                <div className="space-y-1">
                  <Label className="text-xs">Agregar clave (se probará primero)</Label>
                  <div className="flex gap-2">
                    <Input type="password" autoComplete="new-password" value={f.add_password} onChange={(e) => set({ add_password: e.target.value })} />
                    <Button size="sm" onClick={() => save.mutate({ brand: c.brand })} disabled={save.isPending || !f.username}>
                      <Plus className="w-3.5 h-3.5 mr-1" /> Guardar
                    </Button>
                  </div>
                  {c.password_count > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive h-7 px-2"
                      onClick={() => { if (window.confirm(`¿Borrar las ${c.password_count} claves de ${BRAND_LABEL[c.brand]}?`)) save.mutate({ brand: c.brand, clear: true }); }}
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" /> Borrar claves
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** Progreso de un trabajo en lote (consulta cada 2 s hasta terminar). */
function JobProgress({ deviceId, jobId, action, onDone }: { deviceId: string; jobId: string; action: string; onDone: () => void }) {
  const [shot, setShot] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["cpe-job", jobId],
    queryFn: () => cpeApi.job(deviceId, jobId),
    refetchInterval: (q) => ((q.state.data as any)?.status === "done" ? false : 2000),
  });
  const results: any[] = data?.results || [];
  const done = data?.status === "done";
  const ok = results.filter((r) => r.status === "ok").length;
  const failed = results.filter((r) => r.status === "error").length;

  useEffect(() => { if (done) onDone(); }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          {!done && <Loader2 className="w-4 h-4 animate-spin" />}
          {ACTION_LABEL[action] || action}: {done ? "terminado" : "en curso"}
        </CardTitle>
        <CardDescription>
          {ok} correctas · {failed} con error · {results.length - ok - failed} pendientes de {results.length}.
          {action === "pppoe-user" && " Cada antena se verifica cuando reconecta con el usuario nuevo (hasta 90 s)."}
          {action === "password" && " Cada antena se verifica entrando con la clave nueva."}
        </CardDescription>
      </CardHeader>
      <CardContent className="max-h-72 overflow-y-auto">
        <table className="w-full text-sm">
          <tbody>
            {results.map((r) => (
              <tr key={r.mac || r.pppoe_user} className="border-b last:border-0">
                <td className="py-1.5 pr-3 w-5">
                  {r.status === "ok" ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    : r.status === "error" ? <XCircle className="w-4 h-4 text-destructive" />
                    : <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                </td>
                <td className="py-1.5 pr-3 font-medium">{r.pppoe_user}{r.new_user ? ` → ${r.new_user}` : ""}</td>
                <td className="py-1.5 pr-3 font-mono text-xs">{r.ip}</td>
                <td className={`py-1.5 text-xs ${r.status === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                  {r.message}
                  {r.shot && (
                    <Button size="sm" variant="link" className="h-auto p-0 ml-2 text-xs" onClick={() => setShot(r.shot)}>Ver captura</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
      <Dialog open={!!shot} onOpenChange={(o) => !o && setShot(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Lo que vio el robot en WebFig</DialogTitle>
            <DialogDescription>Captura de la pantalla de la antena al terminar o al fallar.</DialogDescription>
          </DialogHeader>
          {shot && <img src={`data:image/jpeg;base64,${shot}`} alt="Captura de WebFig" className="w-full rounded border" />}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

const PROBE_STYLE: Record<string, { label: string; className: string }> = {
  ok: { label: "Entra", className: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" },
  clave: { label: "Clave no entra", className: "bg-destructive/15 text-destructive border-destructive/30" },
  cerrado: { label: "Cerrado", className: "bg-muted text-muted-foreground" },
  "sin-claves": { label: "Falta clave", className: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
  "no-probado": { label: "Responde", className: "bg-sky-500/15 text-sky-500 border-sky-500/30" },
};

/**
 * Equipo de prueba: con la IP de una antena conocida se ve qué forma de
 * entrar funciona (API, SSH, web) con las claves y puertos de la sede, antes
 * de aplicar nada en lote. Lo que entra queda aprendido para esa antena.
 */
function ProbeCard({ deviceId, onAction, busy }: {
  deviceId: string;
  onAction: (action: string, target: any) => void;
  busy: boolean;
}) {
  const { isAdmin } = useAuth();
  const [ip, setIp] = useState("");
  const probe = useMutation({
    mutationFn: () => cpeApi.probe(deviceId, ip.trim()),
    onError: (e: any) => toast.error(e.message || "No se pudo probar"),
  });
  const d = probe.data;
  const webOpen = d?.checks?.some((c: any) => c.method === "MikroTik WebFig" && c.open);
  const apiOk = d?.checks?.some((c: any) => c.method === "MikroTik API" && c.result === "ok");

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><ScanSearch className="w-4 h-4" /> Probar con un equipo conocido</CardTitle>
        <CardDescription>
          Escribe la IP de una antena que sepas que funciona. Se prueba cada forma de entrar (API, SSH y web, en los puertos de arriba)
          con las claves de la sede, sin cambiar nada. Úsalo para validar la sede antes de aplicar cambios en lote.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Input className="h-9 w-48 font-mono" placeholder="192.168.105.77" value={ip} onChange={(e) => setIp(e.target.value)} />
          <Button size="sm" className="h-9" onClick={() => probe.mutate()} disabled={probe.isPending || !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip.trim())}>
            {probe.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <ScanSearch className="w-3.5 h-3.5 mr-1" />}
            {probe.isPending ? "Probando… (hasta 1 min)" : "Probar acceso"}
          </Button>
        </div>

        {d && (
          <div className="space-y-3">
            <p className="text-sm">
              {d.identified
                ? <>✅ <b>{BRAND_LABEL[d.identified.brand]}</b> {[d.identified.model, d.identified.version].filter(Boolean).join(" · ")} — entra por <b>{d.identified.via}</b>. Quedó aprendido para esta antena.</>
                : <>⚠️ Ninguna forma de entrar funcionó todavía con las claves de la sede.</>}
              {d.target
                ? <span className="text-muted-foreground"> · Cliente PPPoE: {d.target.pppoe_user}</span>
                : <span className="text-amber-500"> · Esa IP no es de un cliente PPPoE conectado en esta sede.</span>}
            </p>
            <table className="w-full text-sm">
              <tbody>
                {d.checks.map((c: any) => {
                  const s = PROBE_STYLE[c.result] || PROBE_STYLE.cerrado;
                  return (
                    <tr key={c.method} className="border-b last:border-0">
                      <td className="py-1.5 pr-3 font-medium">{c.method}</td>
                      <td className="py-1.5 pr-3 font-mono text-xs">:{c.port}</td>
                      <td className="py-1.5 pr-3"><Badge variant="outline" className={s.className}>{s.label}</Badge></td>
                      <td className="py-1.5 text-xs text-muted-foreground">{c.message}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {d.target && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction("identify", d.target)}>
                  <ScanSearch className="w-3.5 h-3.5 mr-1" /> Identificar
                </Button>
                {isAdmin && webOpen && !apiOk && (
                  <Button size="sm" disabled={busy} onClick={() => onAction("enable-api", d.target)}>
                    <PlugZap className="w-3.5 h-3.5 mr-1" /> Activar API con el robot en esta antena
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function CpePanel({ deviceId }: { deviceId: string }) {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [weakOnly, setWeakOnly] = useState(false);
  const [brandFilter, setBrandFilter] = useState("todas");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pppoeMode, setPppoeMode] = useState(false);
  const [newUsers, setNewUsers] = useState<Record<string, string>>({});
  const [paste, setPaste] = useState("");
  const [pwdOpen, setPwdOpen] = useState(false);
  const [apiOpen, setApiOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const [uf, setUf] = useState({ an: "", ap: "", tn: "", tp: "", demote: false, ar: false });
  const [allowFrom, setAllowFrom] = useState("");
  const [pwd, setPwd] = useState({ a: "", b: "" });
  const [job, setJob] = useState<{ id: string; action: string } | null>(null);

  const { data, isFetching, refetch, error: listError } = useQuery({
    queryKey: ["cpes", deviceId],
    queryFn: () => cpeApi.list(deviceId),
    enabled: !!deviceId,
    // Mientras la señal de los APs se lee en segundo plano, se vuelve a pedir pronto
    refetchInterval: (q) => ((q.state.data as any)?.signal_pending ? 8_000 : 60_000),
    refetchOnWindowFocus: false,
  });
  const cpes: any[] = data?.cpes || [];

  const { data: history } = useQuery({
    queryKey: ["cpe-jobs", deviceId],
    queryFn: () => cpeApi.jobs(deviceId),
    enabled: !!deviceId,
  });

  const isWeak = (c: any) => c.quality === "mala" || (c.signal != null && c.signal < -75);
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return cpes.filter((c) => {
      if (weakOnly && !isWeak(c)) return false;
      if (brandFilter !== "todas" && (c.brand || "desconocida") !== brandFilter) return false;
      if (!term) return true;
      return [c.pppoe_user, c.ip, c.mac, c.model, c.ap].filter(Boolean).some((v: string) => String(v).toLowerCase().includes(term));
    });
  }, [cpes, search, weakOnly, brandFilter]);

  const keyOf = (c: any) => c.mac || c.pppoe_user;
  // Las acciones solo van a las seleccionadas que se VEN con el filtro actual:
  // antes se aplicaban también a las seleccionadas ocultas por un filtro.
  const chosen = visible.filter((c) => selected.has(keyOf(c)));
  const hiddenSelected = cpes.filter((c) => selected.has(keyOf(c))).length - chosen.length;
  const allVisibleSelected = visible.length > 0 && visible.every((c) => selected.has(keyOf(c)));
  const toggle = (c: any) => setSelected((s) => { const n = new Set(s); n.has(keyOf(c)) ? n.delete(keyOf(c)) : n.add(keyOf(c)); return n; });
  const toggleAll = () => setSelected((s) => {
    const n = new Set(s);
    if (allVisibleSelected) visible.forEach((c) => n.delete(keyOf(c)));
    else visible.forEach((c) => n.add(keyOf(c)));
    return n;
  });

  const start = useMutation({
    mutationFn: ({ targets, ...body }: { action: string; new_password?: string; allow_from?: string; targets?: any[]; [k: string]: any }) =>
      cpeApi.startJob(deviceId, {
        ...body,
        // targets explícitos (equipo de prueba) o las antenas seleccionadas
        targets: targets ?? chosen.map((c) => ({ mac: c.mac, ip: c.ip, pppoe_user: c.pppoe_user, new_user: newUsers[keyOf(c)]?.trim() || undefined })),
      }),
    onSuccess: (d: any, body) => {
      setJob({ id: d.job_id, action: body.action });
      setPwdOpen(false);
      setApiOpen(false);
      setUsersOpen(false);
      setUf({ an: "", ap: "", tn: "", tp: "", demote: false, ar: false });
      setPwd({ a: "", b: "" });
    },
    onError: (e: any) => toast.error(e.message || "No se pudo iniciar"),
  });

  // "usuario_actual usuario_nuevo" por línea → llena la columna "Nuevo usuario" y selecciona
  const applyPaste = () => {
    const map: Record<string, string> = {};
    for (const line of paste.split(/\r?\n/)) {
      const [from, to] = line.trim().split(/[\s,;\t]+/);
      if (from && to) map[from] = to;
    }
    const nu = { ...newUsers };
    const sel = new Set(selected);
    let n = 0;
    for (const c of cpes) {
      const to = map[c.pppoe_user];
      if (to) { nu[keyOf(c)] = to; sel.add(keyOf(c)); n++; }
    }
    setNewUsers(nu);
    setSelected(sel);
    toast.success(`${n} antenas asignadas desde la lista`);
  };

  const missingNewUser = chosen.filter((c) => !newUsers[keyOf(c)]?.trim()).length;

  return (
    <div className="space-y-4">
      <CredentialsCard deviceId={deviceId} />
      <ProbeCard deviceId={deviceId} onAction={(action, target) => start.mutate({ action, targets: [target] })} busy={start.isPending} />

      {job && (
        <JobProgress
          key={job.id}
          deviceId={deviceId}
          jobId={job.id}
          action={job.action}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["cpes", deviceId] });
            qc.invalidateQueries({ queryKey: ["cpe-jobs", deviceId] });
            qc.invalidateQueries({ queryKey: ["cpe-creds", deviceId] });
          }}
        />
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-lg">Antenas de los clientes</CardTitle>
            <CardDescription>
              Clientes PPPoE conectados en esta sede, con la señal que les mide su AP. Selecciona antenas y aplica una acción (MikroTik por API, o SSH):
              antes de cambiar se guarda una copia de su configuración y después se verifica el resultado.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Actualizar
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input className="h-8 w-56" placeholder="Buscar cliente, IP, MAC, AP…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Select value={brandFilter} onValueChange={setBrandFilter}>
              <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las marcas</SelectItem>
                <SelectItem value="mikrotik">MikroTik</SelectItem>
                <SelectItem value="ubiquiti">Ubiquiti</SelectItem>
                <SelectItem value="desconocida">Sin identificar</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant={weakOnly ? "default" : "outline"} onClick={() => setWeakOnly((v) => !v)}>
              <AlertTriangle className="w-3.5 h-3.5 mr-1" /> Señal mala
            </Button>
            <span className="text-xs text-muted-foreground ml-auto">
              {visible.length} de {cpes.length} · {chosen.length} seleccionadas
              {hiddenSelected > 0 && (
                <span className="text-amber-500"> · {hiddenSelected} seleccionadas ocultas por el filtro: no se incluyen</span>
              )}
            </span>
          </div>

          {chosen.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2">
              <span className="text-sm font-medium mr-1">{chosen.length} seleccionadas:</span>
              <Button size="sm" variant="outline" onClick={() => start.mutate({ action: "identify" })} disabled={start.isPending}>
                <ScanSearch className="w-3.5 h-3.5 mr-1" /> Identificar
              </Button>
              <Button size="sm" variant={pppoeMode ? "default" : "outline"} onClick={() => setPppoeMode((v) => !v)}>
                <UserCog className="w-3.5 h-3.5 mr-1" /> Cambiar usuario PPPoE
              </Button>
              {isAdmin && (
                <Button size="sm" variant="outline" onClick={() => setPwdOpen(true)}>
                  <KeyRound className="w-3.5 h-3.5 mr-1" /> Cambiar clave de acceso
                </Button>
              )}
              {isAdmin && (
                <Button size="sm" variant="outline" onClick={() => setUsersOpen(true)} title="Admin aparte, técnico y operador sin ver claves">
                  <KeyRound className="w-3.5 h-3.5 mr-1" /> Usuarios de la antena
                </Button>
              )}
              {isAdmin && (
                <Button size="sm" variant="outline" onClick={() => setApiOpen(true)} title="Para MikroTik con solo WebFig/Winbox">
                  <PlugZap className="w-3.5 h-3.5 mr-1" /> Activar API (WebFig)
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Quitar selección</Button>
            </div>
          )}

          {pppoeMode && (
            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-sm">
                Escribe el <b>usuario nuevo</b> de cada antena en la columna de la tabla, o pega una lista
                <span className="font-mono text-xs"> usuario_actual usuario_nuevo</span> por línea. La clave PPPoE no cambia: el usuario
                nuevo ya debe existir en el servidor con la misma clave.
              </p>
              <Textarea rows={3} placeholder={"cliente01 cli-0001\ncliente02 cli-0002"} value={paste} onChange={(e) => setPaste(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={applyPaste} disabled={!paste.trim()}>Aplicar lista</Button>
                <Button
                  size="sm"
                  onClick={() => {
                    if (window.confirm(`Se cambiará el usuario PPPoE de ${chosen.length} antenas. Cada cliente se desconecta unos segundos. ¿Continuar?`)) {
                      start.mutate({ action: "pppoe-user" });
                    }
                  }}
                  disabled={start.isPending || !chosen.length || missingNewUser > 0}
                >
                  {start.isPending && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                  Aplicar a {chosen.length} antenas
                </Button>
                {missingNewUser > 0 && <span className="text-xs text-amber-500 self-center">Faltan {missingNewUser} usuarios nuevos</span>}
              </div>
            </div>
          )}

          {data?.signal_pending && (
            <p className="text-xs text-muted-foreground">La señal de los APs todavía se está leyendo; pulsa Actualizar en unos segundos.</p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3 w-8"><Checkbox checked={allVisibleSelected} onCheckedChange={toggleAll} aria-label="Seleccionar todas" /></th>
                  <th className="py-2 pr-3">Cliente PPPoE</th>
                  {pppoeMode && <th className="py-2 pr-3">Nuevo usuario</th>}
                  <th className="py-2 pr-3">IP</th>
                  <th className="py-2 pr-3">Antena</th>
                  <th className="py-2 pr-3">AP</th>
                  <th className="py-2 pr-3">Señal</th>
                  <th className="py-2 pr-3">SNR</th>
                  <th className="py-2 pr-3">Calidad</th>
                  <th className="py-2">Último acceso</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => {
                  const q = QUALITY[c.quality] || QUALITY.desconocida;
                  const k = keyOf(c);
                  return (
                    <tr key={k} className={`border-b last:border-0 ${isWeak(c) ? "bg-destructive/5" : ""}`}>
                      <td className="py-2 pr-3"><Checkbox checked={selected.has(k)} onCheckedChange={() => toggle(c)} /></td>
                      <td className="py-2 pr-3 font-medium">{c.pppoe_user}</td>
                      {pppoeMode && (
                        <td className="py-2 pr-3">
                          <Input
                            className="h-7 w-36 text-xs"
                            placeholder={selected.has(k) ? "usuario nuevo" : ""}
                            value={newUsers[k] || ""}
                            onChange={(e) => {
                              setNewUsers({ ...newUsers, [k]: e.target.value });
                              if (e.target.value && !selected.has(k)) toggle(c);
                            }}
                          />
                        </td>
                      )}
                      <td className="py-2 pr-3 font-mono text-xs">{c.ip || "—"}</td>
                      <td className="py-2 pr-3 text-xs">
                        {c.brand ? BRAND_LABEL[c.brand] : <span className="text-muted-foreground">¿?</span>}
                        {c.model && <span className="block text-[11px] text-muted-foreground">{c.model}{c.version ? ` · ${c.version}` : ""}</span>}
                      </td>
                      <td className="py-2 pr-3 text-xs">{c.ap || "—"}</td>
                      <td className="py-2 pr-3 font-mono">
                        {c.signal != null ? `${c.signal} dBm` : "—"}
                        {c.signal_source && (
                          <span className="block font-sans text-[10px] text-muted-foreground" title={c.signal_source === "antena" ? "Leída en la antena del cliente (se actualiza cada 15 min)" : "Medida por el AP"}>
                            {c.signal_source === "antena" ? "desde la antena" : "desde el AP"}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3">{c.snr != null ? `${c.snr} dB` : "—"}</td>
                      <td className="py-2 pr-3"><Badge variant="outline" className={q.className}>{q.label}</Badge></td>
                      <td className="py-2 text-xs">
                        {c.last_error
                          ? <span className="text-destructive" title={c.last_error}>Error: {String(c.last_error).slice(0, 60)}</span>
                          : c.last_ok_at ? <span className="text-muted-foreground">OK {new Date(c.last_ok_at).toLocaleString("es-CO")}</span>
                          : <span className="text-muted-foreground">Nunca</span>}
                      </td>
                    </tr>
                  );
                })}
                {!visible.length && (
                  <tr><td colSpan={10} className="py-6 text-center text-muted-foreground">
                    {listError
                      ? <span className="text-destructive">No se pudo leer la lista: {(listError as any)?.message}</span>
                      : isFetching ? "Cargando clientes…" : cpes.length ? "Ningún cliente coincide con esos filtros." : "No hay clientes PPPoE conectados en esta sede."}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {Boolean(history?.length) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Historial de cambios en antenas</CardTitle>
            <CardDescription>Quién hizo cada cambio y cuántas antenas quedaron bien.</CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <tbody>
                {history!.map((j: any) => (
                  <tr key={j.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-3 text-xs text-muted-foreground">{new Date(j.created_at).toLocaleString("es-CO")}</td>
                    <td className="py-1.5 pr-3">{ACTION_LABEL[j.action] || j.action}</td>
                    <td className="py-1.5 pr-3 text-xs">{j.user_email || "—"}</td>
                    <td className="py-1.5 pr-3 text-xs">{j.ok}/{j.total} correctas</td>
                    <td className="py-1.5">
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => setJob({ id: j.id, action: j.action })}>Ver detalle</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Dialog open={apiOpen} onOpenChange={setApiOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Activar la API en {chosen.length} antenas MikroTik</DialogTitle>
            <DialogDescription>
              Un navegador automático en tu servidor entra a la web (WebFig) de cada antena con la clave de la sede, abre
              Terminal y ejecuta <span className="font-mono">/ip service set api disabled=no</span> limitado a la red de la VPN.
              Después comprueba que la API responde. Las que ya tengan la API activa no se tocan. Es experimental: prueba
              primero con una sola antena y revisa la captura.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label>Redes de gestión adicionales (opcional)</Label>
            <Input placeholder="10.10.10.0/24, 192.168.88.0/24" value={allowFrom} onChange={(e) => setAllowFrom(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">
              La VPN del sistema siempre se incluye. Agrega aquí tu red si tú también quieres usar la API. El puerto de WebFig es
              el de MikroTik en "Puertos web".
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApiOpen(false)}>Cancelar</Button>
            <Button onClick={() => start.mutate({ action: "enable-api", allow_from: allowFrom.trim() || undefined })} disabled={start.isPending}>
              {start.isPending && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
              Activar en {chosen.length} antenas
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={usersOpen} onOpenChange={setUsersOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Usuarios de {chosen.length} antenas MikroTik</DialogTitle>
            <DialogDescription>
              Por API. Primero se crea el admin nuevo y se comprueba que entra; solo entonces se baja al usuario actual.
              El sistema pasa a entrar con el admin nuevo. El técnico puede ver la señal, hacer ping/pruebas y reiniciar,
              pero no cambiar la configuración ni ver claves.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label>Admin nuevo (usuario)</Label><Input value={uf.an} onChange={(e) => setUf({ ...uf, an: e.target.value })} /></div>
              <div className="space-y-1"><Label>Clave del admin</Label><Input type="password" autoComplete="new-password" value={uf.ap} onChange={(e) => setUf({ ...uf, ap: e.target.value })} /></div>
              <div className="space-y-1"><Label>Técnico (usuario, opcional)</Label><Input value={uf.tn} onChange={(e) => setUf({ ...uf, tn: e.target.value })} /></div>
              <div className="space-y-1"><Label>Clave del técnico</Label><Input type="password" autoComplete="new-password" value={uf.tp} onChange={(e) => setUf({ ...uf, tp: e.target.value })} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={uf.demote} disabled={!uf.an} onChange={(e) => setUf({ ...uf, demote: e.target.checked })} />
              Dejar al usuario actual como operador: puede leer y cambiar configuración, pero NO ver contraseñas
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={uf.ar} onChange={(e) => setUf({ ...uf, ar: e.target.checked })} />
              Activar anti-reset: para resetearla hay que sostener el botón 5-10 minutos (un técnico no lo hará, pero tú sí puedes rescatarla si se daña)
            </label>
            <p className="text-[11px] text-muted-foreground">Usuario 3-32 (letras, números . _ -). Clave 8-64 caracteres. El anti-reset requiere firmware actualizado; si la antena no lo soporta, te avisa.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUsersOpen(false)}>Cancelar</Button>
            <Button
              disabled={start.isPending || (!uf.an && !uf.tn && !uf.ar) || (!!uf.an && uf.ap.length < 8) || (!!uf.tn && uf.tp.length < 8)}
              onClick={() => start.mutate({
                action: "users",
                admin: uf.an ? { name: uf.an.trim(), password: uf.ap } : undefined,
                tech: uf.tn ? { name: uf.tn.trim(), password: uf.tp } : undefined,
                demote_current: uf.demote && !!uf.an,
                anti_reset: uf.ar,
              })}
            >
              {start.isPending && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
              Aplicar en {chosen.length} antenas
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pwdOpen} onOpenChange={setPwdOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cambiar clave de acceso de {chosen.length} antenas</DialogTitle>
            <DialogDescription>
              Se cambia la clave del usuario con que entra el sistema. Antes se guarda una copia de cada antena y después se comprueba
              que la clave nueva entra; si entra, pasa a ser la primera clave de la sede y la anterior queda como respaldo.
              En Ubiquiti se aplica la configuración y la antena se reconecta unos segundos.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Clave nueva</Label>
              <Input type="password" autoComplete="new-password" value={pwd.a} onChange={(e) => setPwd({ ...pwd, a: e.target.value })} />
              <p className="text-[11px] text-muted-foreground">8 a 64 caracteres: letras, números y {"!@#%^*()_+=.,:~-"}</p>
            </div>
            <div className="space-y-1">
              <Label>Repetir clave</Label>
              <Input type="password" autoComplete="new-password" value={pwd.b} onChange={(e) => setPwd({ ...pwd, b: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwdOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => start.mutate({ action: "password", new_password: pwd.a })}
              disabled={start.isPending || !pwd.a || pwd.a !== pwd.b || !/^[A-Za-z0-9!@#%^*()_+=.,:~-]{8,64}$/.test(pwd.a)}
            >
              {start.isPending && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
              Cambiar en {chosen.length} antenas
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
