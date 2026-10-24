import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { whatsappApi } from "@/lib/api-client";
import { useAuth } from "@/hooks/useAuth";
import { useMyPermissions } from "@/hooks/usePermissions";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  AlertTriangle, CheckCircle2, Clock, Copy, Info, KeyRound, Loader2, LogOut, MessageCircle, Pause, Play,
  QrCode, RefreshCw, RotateCcw, Send, ShieldAlert, XCircle,
} from "lucide-react";

const RISK: Record<string, { label: string; className: string; icon: any }> = {
  ok: { label: "Riesgo bajo", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30", icon: CheckCircle2 },
  info: { label: "Información", className: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30", icon: Info },
  warn: { label: "Riesgo medio", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30", icon: AlertTriangle },
  high: { label: "Riesgo alto", className: "bg-destructive/15 text-destructive border-destructive/30", icon: ShieldAlert },
};

const SESSION: Record<string, { label: string; className: string }> = {
  open: { label: "Conectado", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" },
  connecting: { label: "Esperando el QR", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30" },
  close: { label: "Desconectado", className: "bg-muted text-muted-foreground" },
  error: { label: "Evolution no responde", className: "bg-destructive/15 text-destructive border-destructive/30" },
};

const QSTATUS: Record<string, { label: string; className: string }> = {
  pending: { label: "En cola", className: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30" },
  sending: { label: "Enviando", className: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
  sent: { label: "Enviado", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" },
  failed: { label: "Falló", className: "bg-destructive/15 text-destructive border-destructive/30" },
  skipped: { label: "Omitido", className: "bg-muted text-muted-foreground" },
  cancelled: { label: "Cancelado", className: "bg-muted text-muted-foreground line-through" },
};

const DAYS = [
  { v: 1, l: "Lun" }, { v: 2, l: "Mar" }, { v: 3, l: "Mié" }, { v: 4, l: "Jue" }, { v: 5, l: "Vie" }, { v: 6, l: "Sáb" }, { v: 0, l: "Dom" },
];

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("es-CO", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";

function Kpi({ label, value, hint, icon: Icon }: { label: string; value: any; hint?: string; icon?: any }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-1">
        <p className="text-xs text-muted-foreground flex items-center gap-1">{Icon && <Icon className="h-3.5 w-3.5" />}{label}</p>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

// ───────────────────────── Panel ─────────────────────────
function PanelTab({ tenantId }: { tenantId: string | null }) {
  const [days, setDays] = useState(30);
  const { data: st, isLoading } = useQuery({
    queryKey: ["wa-stats", tenantId, days],
    queryFn: () => whatsappApi.stats(days, tenantId),
    refetchInterval: 60_000,
  });
  if (isLoading || !st) return <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  const risk = RISK[st.risk] || RISK.ok;
  const RiskIcon = risk.icon;
  const m = st.metrics;
  const perDay = (st.per_day || []).map((d: any) => ({ ...d, label: d.day.slice(5).split("-").reverse().join("/") }));

  return (
    <div className="space-y-6">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Kpi icon={Send} label="Enviados hoy" value={st.totals.sent_today} hint={`Tope diario ${st.settings.daily_cap}`} />
        <Kpi icon={Clock} label="En cola" value={st.totals.pending} hint={st.totals.pending ? `Termina: ${fmtDate(m.eta)}` : "Al día"} />
        <Kpi label="Promedio diario (7 días)" value={Math.round(m.avg_sent_per_day_7d)} hint={`${st.totals.sent_30d} en 30 días`} />
        <Kpi label="Fallidos (7 días)" value={st.totals.failed_7d} hint={`${Math.round(m.failure_rate_7d * 100)}% de los intentos`} />
        <Kpi label="Clientes que te escribieron" value={st.contacts.optin} hint="Pueden recibir avisos" />
        <Kpi label="Bajas" value={st.contacts.optout} hint={`${st.contacts.optout_30d} este mes`} />
        <Kpi label="Omitidos (30 días)" value={st.totals.skipped_30d} hint={`${st.totals.not_on_wa_30d} sin WhatsApp`} />
        <Kpi label="Desconexiones (7 días)" value={m.disconnects_7d} hint={SESSION[st.session.state]?.label || st.session.state} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Recomendaciones</CardTitle>
            <Badge variant="outline" className={risk.className}><RiskIcon className="h-3.5 w-3.5 mr-1" />{risk.label}</Badge>
          </div>
          <CardDescription>Se calculan con lo que está saliendo y con tu configuración.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {st.recommendations.map((r: any, i: number) => {
            const k = RISK[r.level] || RISK.info;
            const I = k.icon;
            return (
              <div key={i} className="flex gap-3 rounded-lg border p-3">
                <I className={`h-5 w-5 shrink-0 mt-0.5 ${k.className.split(" ").filter((c: string) => c.startsWith("text-")).join(" ")}`} />
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{r.title}</p>
                  <p className="text-sm text-muted-foreground">{r.detail}</p>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Envíos por día</CardTitle>
            <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Últimos 7 días</SelectItem>
                <SelectItem value="30">Últimos 30 días</SelectItem>
                <SelectItem value="90">Últimos 90 días</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={perDay}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="label" fontSize={11} tickLine={false} />
              <YAxis allowDecimals={false} fontSize={11} tickLine={false} width={32} />
              <Tooltip />
              <Legend />
              <Bar dataKey="sent" name="Enviados" stackId="a" fill="hsl(142 70% 45%)" />
              <Bar dataKey="failed" name="Fallidos" stackId="a" fill="hsl(0 75% 55%)" />
              <Bar dataKey="skipped" name="Omitidos" stackId="a" fill="hsl(215 15% 60%)" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Por hora del día (7 días)</CardTitle></CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={st.per_hour}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="hour" fontSize={11} tickLine={false} />
                <YAxis allowDecimals={false} fontSize={11} tickLine={false} width={32} />
                <Tooltip labelFormatter={(h) => `${h}:00`} />
                <Bar dataKey="sent" name="Enviados" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Por tipo de aviso (30 días)</CardTitle></CardHeader>
          <CardContent>
            {st.by_event.length === 0 ? <p className="text-sm text-muted-foreground">Todavía no hay avisos.</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Aviso</TableHead><TableHead className="text-right">Enviados</TableHead><TableHead className="text-right">En cola</TableHead></TableRow></TableHeader>
                <TableBody>
                  {st.by_event.map((e: any) => (
                    <TableRow key={e.event_type}><TableCell>{e.label}</TableCell><TableCell className="text-right tabular-nums">{e.sent}</TableCell><TableCell className="text-right tabular-nums">{e.pending}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ───────────────────────── Conexión ─────────────────────────
function ConnectionTab({ tenantId, isAdmin, canEdit }: { tenantId: string | null; isAdmin: boolean; canEdit: boolean }) {
  const qc = useQueryClient();
  const [qr, setQr] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState("");
  const { data: session, refetch } = useQuery({
    queryKey: ["wa-session", tenantId],
    queryFn: () => whatsappApi.session(tenantId),
    refetchInterval: qr ? 4000 : 30_000,
  });
  useEffect(() => {
    if (session?.state === "open" && qr) { setQr(null); toast.success("WhatsApp conectado"); qc.invalidateQueries({ queryKey: ["wa-stats"] }); }
  }, [session?.state, qr, qc]);

  const connect = useMutation({
    mutationFn: () => whatsappApi.connect(tenantId),
    onSuccess: (r: any) => { if (r?.qr) setQr(r.qr); else if (r?.state === "open") toast.success("Ya está conectado"); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const logout = useMutation({
    mutationFn: () => whatsappApi.logout(tenantId),
    onSuccess: () => { toast.success("Sesión cerrada"); setQr(null); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const test = useMutation({
    mutationFn: () => whatsappApi.test(phone, msg, tenantId),
    onSuccess: () => { toast.success("Prueba en cola: sale en la próxima vuelta (máx. 1 min si la sesión está conectada)"); setMsg(""); },
    onError: (e: any) => toast.error(e.message),
  });
  const st = SESSION[session?.state] || SESSION.close;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><QrCode className="h-4 w-4" /> Sesión de WhatsApp</CardTitle>
          <CardDescription>Escanea el QR desde el celular: WhatsApp → Dispositivos vinculados → Vincular un dispositivo. Usa un chip aparte con WhatsApp Business.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={st.className}>{st.label}</Badge>
            {session?.number && <span className="text-sm text-muted-foreground">+{session.number}</span>}
            {session?.since && <span className="text-xs text-muted-foreground">desde {fmtDate(session.since)}</span>}
          </div>
          {qr && (
            <div className="flex flex-col items-center gap-2 rounded-lg border p-4 bg-white">
              <img src={qr} alt="Código QR de WhatsApp" className="h-64 w-64" />
              <p className="text-xs text-neutral-600">El QR cambia cada pocos segundos; si vence, pulsa “Mostrar QR” otra vez.</p>
            </div>
          )}
          {isAdmin ? (
            <div className="flex flex-wrap gap-2">
              {session?.state !== "open" && (
                <Button onClick={() => connect.mutate()} disabled={connect.isPending}>
                  {connect.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <QrCode className="h-4 w-4 mr-1" />} Mostrar QR
                </Button>
              )}
              <Button variant="outline" onClick={() => refetch()}><RefreshCw className="h-4 w-4 mr-1" /> Actualizar</Button>
              {session?.state === "open" && (
                <Button variant="outline" onClick={() => confirm("¿Cerrar la sesión de WhatsApp? Los avisos quedarán en cola hasta volver a escanear el QR.") && logout.mutate()}>
                  <LogOut className="h-4 w-4 mr-1" /> Cerrar sesión
                </Button>
              )}
            </div>
          ) : <p className="text-sm text-muted-foreground">Solo el administrador del ISP conecta o cierra la sesión.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Send className="h-4 w-4" /> Mensaje de prueba</CardTitle>
          <CardDescription>Entra primero en la cola y no exige que el número te haya escrito. Prueba con tu propio número.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>Teléfono</Label>
            <Input placeholder="3001234567 o 573001234567" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Mensaje (opcional)</Label>
            <Textarea rows={3} placeholder="✅ Mensaje de prueba de Omnisync…" value={msg} onChange={(e) => setMsg(e.target.value)} />
          </div>
          <Button onClick={() => test.mutate()} disabled={!canEdit || !phone || test.isPending}>
            {test.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />} Enviar prueba
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ───────────────────────── Cola ─────────────────────────
function QueueTab({ tenantId, isAdmin, canEdit, eventLabels, paused }: { tenantId: string | null; isAdmin: boolean; canEdit: boolean; eventLabels: Record<string, string>; paused: boolean }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const limit = 50;
  const { data, isLoading } = useQuery({
    queryKey: ["wa-queue", tenantId, status, search, page],
    queryFn: () => whatsappApi.queue({ status: status === "all" ? undefined : status, q: search, limit, offset: page * limit }, tenantId),
    refetchInterval: 30_000,
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["wa-queue"] }); qc.invalidateQueries({ queryKey: ["wa-stats"] }); qc.invalidateQueries({ queryKey: ["wa-settings"] }); };
  const act = useMutation({
    mutationFn: ({ id, kind }: { id: number; kind: "retry" | "cancel" }) => kind === "retry" ? whatsappApi.retry(id, tenantId) : whatsappApi.cancel(id, tenantId),
    onSuccess: refresh,
    onError: (e: any) => toast.error(e.message),
  });
  const pause = useMutation({
    mutationFn: () => whatsappApi.pause(!paused, tenantId),
    onSuccess: (r: any) => { toast.success(r.paused ? "Envíos pausados" : "Envíos reanudados"); refresh(); },
    onError: (e: any) => toast.error(e.message),
  });
  const cancelAll = useMutation({
    mutationFn: (event: string | null) => whatsappApi.cancelPending(event, tenantId),
    onSuccess: (r: any) => { toast.success(`${r.cancelled} mensaje(s) cancelados`); refresh(); },
    onError: (e: any) => toast.error(e.message),
  });
  const items = data?.items || [];
  const total = data?.total || 0;

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Mensajes</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button variant={paused ? "default" : "outline"} size="sm" onClick={() => pause.mutate()} disabled={!canEdit || pause.isPending}>
              {paused ? <><Play className="h-4 w-4 mr-1" /> Reanudar envíos</> : <><Pause className="h-4 w-4 mr-1" /> Pausar envíos</>}
            </Button>
            {isAdmin && (
              <Select onValueChange={(v) => {
                const ev = v === "all" ? null : v;
                if (confirm(`¿Cancelar todos los pendientes${ev ? ` de "${eventLabels[ev] || ev}"` : ""}?`)) cancelAll.mutate(ev);
              }}>
                <SelectTrigger className="w-52 h-9"><SelectValue placeholder="Cancelar pendientes…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los pendientes</SelectItem>
                  {Object.entries(eventLabels).filter(([k]) => !["test", "system"].includes(k)).map(([k, l]) => <SelectItem key={k} value={k}>Solo: {l}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
        {paused && <p className="text-sm text-amber-600 dark:text-amber-400">Los envíos están pausados: los mensajes se acumulan en la cola.</p>}
        <div className="flex flex-wrap gap-2">
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {Object.entries(QSTATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(q); setPage(0); }}>
            <Input className="w-56" placeholder="Teléfono, cliente o texto" value={q} onChange={(e) => setQ(e.target.value)} />
            <Button type="submit" variant="outline" size="icon"><RefreshCw className="h-4 w-4" /></Button>
          </form>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin" /></div> : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay mensajes con ese filtro.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Estado</TableHead><TableHead>Aviso</TableHead><TableHead>Teléfono</TableHead>
                  <TableHead className="min-w-[260px]">Mensaje</TableHead><TableHead>Fecha</TableHead><TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((m: any) => {
                  const s = QSTATUS[m.status] || QSTATUS.pending;
                  return (
                    <TableRow key={m.id}>
                      <TableCell>
                        <Badge variant="outline" className={s.className}>{s.label}</Badge>
                        {m.last_error && <p className="text-[11px] text-muted-foreground mt-1 max-w-[220px]">{m.last_error}</p>}
                      </TableCell>
                      <TableCell className="text-sm">{eventLabels[m.event_type] || m.event_type}<p className="text-[11px] text-muted-foreground">Prioridad {m.priority}</p></TableCell>
                      <TableCell className="text-sm tabular-nums">+{m.phone}{m.client_ref && <p className="text-[11px] text-muted-foreground">Cliente {m.client_ref}</p>}</TableCell>
                      <TableCell className="text-sm"><p className="line-clamp-3 whitespace-pre-line">{m.message}</p></TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(m.sent_at || m.created_at)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {canEdit && ["failed", "cancelled", "skipped"].includes(m.status) && (
                          <Button variant="ghost" size="icon" title="Reintentar" onClick={() => act.mutate({ id: m.id, kind: "retry" })}><RotateCcw className="h-4 w-4" /></Button>
                        )}
                        {canEdit && m.status === "pending" && (
                          <Button variant="ghost" size="icon" title="Cancelar" onClick={() => act.mutate({ id: m.id, kind: "cancel" })}><XCircle className="h-4 w-4" /></Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {total > limit && (
          <div className="flex items-center justify-end gap-2 pt-3 text-sm">
            <span className="text-muted-foreground">{page * limit + 1}–{Math.min(total, (page + 1) * limit)} de {total}</span>
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</Button>
            <Button variant="outline" size="sm" disabled={(page + 1) * limit >= total} onClick={() => setPage(page + 1)}>Siguiente</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ───────────────────────── Configuración ─────────────────────────
function SettingsTab({ tenantId, settings, isAdmin }: { tenantId: string | null; settings: any; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [f, setF] = useState<any>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  useEffect(() => {
    if (!settings) return;
    setF({
      enabled: settings.enabled,
      interval_min: Math.round((settings.interval_sec / 60) * 10) / 10,
      jitter_sec: settings.jitter_sec,
      hour_start: settings.hour_start,
      hour_end: settings.hour_end,
      days: String(settings.days).split(",").map(Number),
      daily_cap: settings.daily_cap,
      require_optin: settings.require_optin,
      optout_word: settings.optout_word,
      signature: settings.signature || "",
      priorities: { ...settings.default_priorities, ...(settings.priorities || {}) },
      alert_disconnect: settings.alert_disconnect,
    });
  }, [settings]);

  const save = useMutation({
    mutationFn: () => whatsappApi.saveSettings({
      ...f,
      interval_sec: Math.round(Number(f.interval_min) * 60),
      priorities: Object.fromEntries(Object.entries(f.priorities).filter(([k]) => !["test", "system"].includes(k))),
    }, tenantId),
    onSuccess: () => { toast.success("Configuración guardada"); qc.invalidateQueries({ queryKey: ["wa-settings"] }); qc.invalidateQueries({ queryKey: ["wa-stats"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const regen = useMutation({
    mutationFn: () => whatsappApi.regenerateKey(tenantId),
    onSuccess: (r: any) => { setNewKey(r.api_key); qc.invalidateQueries({ queryKey: ["wa-settings"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  if (!f) return null;
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const enqueueUrl = `${window.location.origin}/api/public/whatsapp/enqueue`;
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast.success("Copiado"), () => toast.error("No se pudo copiar"));
  const ro = !isAdmin;
  const perHour = f.interval_min > 0 ? Math.floor(60 / f.interval_min) : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ritmo de envío</CardTitle>
          <CardDescription>Con {f.interval_min} min de pausa salen unos {perHour} mensajes por hora y {perHour * Math.max(0, f.hour_end - f.hour_start)} al día como máximo.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Envíos activos</Label>
            <Switch checked={f.enabled} disabled={ro} onCheckedChange={(v) => set("enabled", v)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Pausa entre mensajes (min)</Label>
              <Input type="number" step="0.5" min={0.5} max={60} disabled={ro} value={f.interval_min} onChange={(e) => set("interval_min", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Variación al azar (± s)</Label>
              <Input type="number" min={0} max={600} disabled={ro} value={f.jitter_sec} onChange={(e) => set("jitter_sec", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Desde (hora)</Label>
              <Input type="number" min={0} max={23} disabled={ro} value={f.hour_start} onChange={(e) => set("hour_start", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Hasta (hora)</Label>
              <Input type="number" min={1} max={24} disabled={ro} value={f.hour_end} onChange={(e) => set("hour_end", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Tope por día</Label>
              <Input type="number" min={1} max={5000} disabled={ro} value={f.daily_cap} onChange={(e) => set("daily_cap", e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Días de envío</Label>
            <div className="flex flex-wrap gap-1">
              {DAYS.map((d) => {
                const on = f.days.includes(d.v);
                return (
                  <Button key={d.v} type="button" size="sm" variant={on ? "default" : "outline"} disabled={ro}
                    onClick={() => set("days", on ? f.days.filter((x: number) => x !== d.v) : [...f.days, d.v])}>{d.l}</Button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Protección del número</CardTitle>
          <CardDescription>Lo que más evita bloqueos: escribir solo a quien te escribió y respetar las bajas.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Label>Solo a quien escribió primero</Label>
              <p className="text-xs text-muted-foreground">Si el cliente nunca te escribió, el aviso se omite. Pide en la factura que te escriban.</p>
            </div>
            <Switch checked={f.require_optin} disabled={ro} onCheckedChange={(v) => set("require_optin", v)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Palabra para darse de baja</Label>
              <Input disabled={ro} value={f.optout_word} onChange={(e) => set("optout_word", e.target.value.toUpperCase())} />
              <p className="text-[11px] text-muted-foreground">Para volver: ALTA</p>
            </div>
            <div className="flex items-start justify-between gap-3 pt-6">
              <Label>Avisar por Telegram si se cae</Label>
              <Switch checked={f.alert_disconnect} disabled={ro} onCheckedChange={(v) => set("alert_disconnect", v)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Firma al final de cada mensaje</Label>
            <Textarea rows={2} disabled={ro} placeholder="Suros Comunicaciones · Soporte 300 000 0000" value={f.signature} onChange={(e) => set("signature", e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Prioridad por tipo de aviso</CardTitle>
          <CardDescription>1 = sale primero. Los pagos y reactivaciones se adelantan a las facturas del día de facturación.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {Object.entries(settings.event_labels as Record<string, string>).filter(([k]) => !["test", "system"].includes(k)).map(([k, label]) => (
            <div key={k} className="flex items-center justify-between gap-3">
              <Label className="font-normal">{label}</Label>
              <Select value={String(f.priorities[k] ?? 5)} disabled={ro} onValueChange={(v) => set("priorities", { ...f.priorities, [k]: Number(v) })}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><KeyRound className="h-4 w-4" /> Conexión con el plugin de UISP</CardTitle>
          <CardDescription>Pega esta dirección y la clave en el plugin Omnisync de cada UISP de este ISP.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>Dirección</Label>
            <div className="flex gap-2"><Input readOnly value={enqueueUrl} /><Button variant="outline" size="icon" onClick={() => copy(enqueueUrl)}><Copy className="h-4 w-4" /></Button></div>
          </div>
          <div className="space-y-1">
            <Label>Clave de API</Label>
            <p className="text-sm text-muted-foreground">{settings.has_api_key ? `Configurada (${settings.api_key_hint})` : "Todavía no hay clave"}</p>
          </div>
          {isAdmin && (
            <Button variant="outline" onClick={() => (!settings.has_api_key || confirm("La clave actual dejará de funcionar en los plugins que la usen. ¿Generar una nueva?")) && regen.mutate()}>
              <KeyRound className="h-4 w-4 mr-1" /> {settings.has_api_key ? "Generar clave nueva" : "Generar clave"}
            </Button>
          )}
        </CardContent>
      </Card>

      {isAdmin && (
        <div className="lg:col-span-2 flex justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Guardar configuración
          </Button>
        </div>
      )}

      <Dialog open={!!newKey} onOpenChange={(o) => !o && setNewKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clave de API nueva</DialogTitle>
            <DialogDescription>Cópiala ahora: por seguridad no se vuelve a mostrar. Pégala directamente en el plugin, no la compartas por chat.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2"><Input readOnly value={newKey || ""} className="font-mono text-xs" /><Button variant="outline" size="icon" onClick={() => newKey && copy(newKey)}><Copy className="h-4 w-4" /></Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ───────────────────────── Página ─────────────────────────
export default function WhatsApp() {
  const { isSuperAdmin, isAdmin } = useAuth();
  const { canEdit } = useMyPermissions();
  const [tenantId, setTenantId] = useState<string | null>(null);

  // El super admin (sin ISP propio) elige el ISP desde el resumen
  const { data: overview = [] } = useQuery({
    queryKey: ["wa-overview"],
    queryFn: () => whatsappApi.overview(),
    enabled: !!isSuperAdmin,
    refetchInterval: 60_000,
  });
  useEffect(() => {
    if (isSuperAdmin && !tenantId && overview.length) setTenantId(overview[0].id);
  }, [isSuperAdmin, overview, tenantId]);

  const needsTenant = !!isSuperAdmin && !tenantId;
  const { data: settings, error } = useQuery({
    queryKey: ["wa-settings", tenantId],
    queryFn: () => whatsappApi.settings(tenantId),
    enabled: !needsTenant,
    retry: false,
  });
  const admin = !!(isSuperAdmin || isAdmin);
  const edit = admin || canEdit("whatsapp");
  const eventLabels = useMemo(() => settings?.event_labels || {}, [settings]);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="p-4 md:p-8 md:ml-64 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold flex items-center gap-2"><MessageCircle className="h-6 w-6 text-primary" /> WhatsApp</h1>
            <p className="text-sm text-muted-foreground">Avisos a clientes desde UISP con tu propio número (QR). Un mensaje cada pausa, en horario, con prioridad para pagos.</p>
          </div>
          {isSuperAdmin && (
            <Select value={tenantId || ""} onValueChange={setTenantId}>
              <SelectTrigger className="w-64"><SelectValue placeholder="Elige un ISP" /></SelectTrigger>
              <SelectContent>
                {overview.map((o: any) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name} · {o.module ? (SESSION[o.connection_state]?.label || "sin configurar") : "módulo apagado"} · {o.pending} en cola
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </header>

        {isSuperAdmin && overview.length === 0 && (
          <Card><CardContent className="p-6 text-sm text-muted-foreground">Ningún ISP tiene el módulo WhatsApp. Actívalo en Panel de ISPs → Módulos habilitados.</CardContent></Card>
        )}
        {error && <Card><CardContent className="p-6 text-sm text-destructive">{(error as any).message}</CardContent></Card>}

        {settings && (
          <Tabs defaultValue="panel">
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="panel">Panel</TabsTrigger>
              <TabsTrigger value="conexion">Conexión</TabsTrigger>
              <TabsTrigger value="cola">Cola</TabsTrigger>
              <TabsTrigger value="config">Configuración</TabsTrigger>
            </TabsList>
            <TabsContent value="panel" className="mt-4"><PanelTab tenantId={tenantId} /></TabsContent>
            <TabsContent value="conexion" className="mt-4"><ConnectionTab tenantId={tenantId} isAdmin={admin} canEdit={edit} /></TabsContent>
            <TabsContent value="cola" className="mt-4"><QueueTab tenantId={tenantId} isAdmin={admin} canEdit={edit} eventLabels={eventLabels} paused={settings.paused} /></TabsContent>
            <TabsContent value="config" className="mt-4"><SettingsTab tenantId={tenantId} settings={settings} isAdmin={admin} /></TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}
