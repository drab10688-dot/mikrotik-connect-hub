import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import QRCode from "qrcode";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  AlertTriangle, CheckCircle2, Clock, Copy, Download, ImagePlus, Info, KeyRound, Loader2, LogOut, MessageCircle,
  Pause, Pencil, Play, Plus, QrCode, RefreshCw, RotateCcw, Send, ShieldAlert, Star, Trash2, XCircle,
} from "lucide-react";

// ───────────────────────── Etiquetas ─────────────────────────
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
  waiting: { label: "Esperando que acepte", className: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30" },
  sending: { label: "Enviando", className: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
  sent: { label: "Enviado", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" },
  failed: { label: "Falló", className: "bg-destructive/15 text-destructive border-destructive/30" },
  skipped: { label: "Omitido", className: "bg-muted text-muted-foreground" },
  cancelled: { label: "Cancelado", className: "bg-muted text-muted-foreground line-through" },
};
const SUBSTATUS: Record<string, { label: string; className: string }> = {
  new: { label: "Sin presentar", className: "bg-muted text-muted-foreground" },
  invited: { label: "Presentación enviada", className: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30" },
  subscribed: { label: "Suscrito", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" },
  declined: { label: "Dijo NO", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30" },
  no_reply: { label: "No respondió", className: "bg-muted text-muted-foreground" },
  opted_out: { label: "De baja", className: "bg-destructive/15 text-destructive border-destructive/30" },
};
const KIND: Record<string, string> = { notice: "Aviso", invite: "Presentación", reply: "Respuesta", system: "Confirmación", test: "Prueba" };
const ACTIONS: Record<string, string> = { si: "Aceptó (SÍ)", no: "Rechazó (NO)", baja: "Se dio de baja" };
const DAYS = [{ v: 1, l: "Lun" }, { v: 2, l: "Mar" }, { v: 3, l: "Mié" }, { v: 4, l: "Jue" }, { v: 5, l: "Vie" }, { v: 6, l: "Sáb" }, { v: 0, l: "Dom" }];
const VARS = "{nombre} {organizacion} {mes} {numero_factura} {fecha_vencimiento} {saldo} {valor} {medios_pago} {link_pago} {baja}";

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("es-CO", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast.success("Copiado"), () => toast.error("No se pudo copiar"));
const textColor = (cls: string) => cls.split(" ").filter((c) => c.startsWith("text-")).join(" ");

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

function NumberFilter({ numbers, value, onChange, all = true }: { numbers: any[]; value: number | null; onChange: (v: number | null) => void; all?: boolean }) {
  if (numbers.length <= 1 && all) return null;
  return (
    <Select value={value ? String(value) : "all"} onValueChange={(v) => onChange(v === "all" ? null : Number(v))}>
      <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
      <SelectContent>
        {all && <SelectItem value="all">Todos los números</SelectItem>}
        {numbers.map((n) => <SelectItem key={n.id} value={String(n.id)}>{n.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

// ───────────────────────── Panel ─────────────────────────
function PanelTab({ tenantId, numbers }: { tenantId: string | null; numbers: any[] }) {
  const [days, setDays] = useState(30);
  const [numberId, setNumberId] = useState<number | null>(null);
  const { data: st, isLoading } = useQuery({
    queryKey: ["wa-stats", tenantId, days, numberId],
    queryFn: () => whatsappApi.stats(days, numberId, tenantId),
    refetchInterval: 60_000,
  });
  if (isLoading || !st) return <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  const risk = RISK[st.risk] || RISK.ok;
  const RiskIcon = risk.icon;
  const m = st.metrics, f = st.funnel, t = st.totals;
  const answered = (m.accepted_30d || 0) + (m.declined_30d || 0) + (m.no_reply_30d || 0);
  const perDay = (st.per_day || []).map((d: any) => ({ ...d, label: d.day.slice(5).split("-").reverse().join("/") }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <NumberFilter numbers={numbers} value={numberId} onChange={setNumberId} />
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Últimos 7 días</SelectItem>
            <SelectItem value="30">Últimos 30 días</SelectItem>
            <SelectItem value="90">Últimos 90 días</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Kpi icon={Send} label="Enviados hoy" value={t.sent_today || 0} hint="Avisos y presentaciones" />
        <Kpi icon={Clock} label="En cola" value={t.pending || 0} hint={t.pending ? `Termina: ${fmtDate(m.eta)}` : "Al día"} />
        <Kpi label="Esperando que acepten" value={t.waiting || 0} hint={`${t.invites_today || 0} presentaciones hoy`} />
        <Kpi label="Suscritos" value={f.subscribed || 0} hint={`${f.opted_out || 0} de baja`} />
        <Kpi label="Aceptaron (30 días)" value={m.accepted_30d || 0} hint={`${pct(m.accepted_30d || 0, answered)} de las presentaciones`} />
        <Kpi label="Dijeron NO / no respondieron" value={`${m.declined_30d || 0} / ${m.no_reply_30d || 0}`} />
        <Kpi label="Uso del menú (30 días)" value={m.menu_uses_30d || 0} hint={`${pct(m.menu_uses_30d || 0, m.notices_sent_30d || 0)} de los avisos`} />
        <Kpi label="Fallidos (7 días)" value={t.failed_7d || 0} hint={`${Math.round((m.failure_rate_7d || 0) * 100)}% de los intentos`} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Recomendaciones</CardTitle>
            <Badge variant="outline" className={risk.className}><RiskIcon className="h-3.5 w-3.5 mr-1" />{risk.label}</Badge>
          </div>
          <CardDescription>Se calculan por número, con lo que está saliendo y con su configuración.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {st.recommendations.map((r: any, i: number) => {
            const k = RISK[r.level] || RISK.info;
            const I = k.icon;
            return (
              <div key={i} className="flex gap-3 rounded-lg border p-3">
                <I className={`h-5 w-5 shrink-0 mt-0.5 ${textColor(k.className)}`} />
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{r.title}{r.number && <span className="text-muted-foreground font-normal"> · {r.number}</span>}</p>
                  <p className="text-sm text-muted-foreground">{r.detail}</p>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Envíos por día</CardTitle></CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={perDay}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="label" fontSize={11} tickLine={false} />
              <YAxis allowDecimals={false} fontSize={11} tickLine={false} width={32} />
              <Tooltip />
              <Legend />
              <Bar dataKey="sent" name="Avisos" stackId="a" fill="hsl(142 70% 45%)" />
              <Bar dataKey="invites" name="Presentaciones" stackId="a" fill="hsl(262 70% 60%)" />
              <Bar dataKey="replies" name="Respuestas" stackId="a" fill="hsl(199 80% 55%)" />
              <Bar dataKey="failed" name="Fallidos" stackId="a" fill="hsl(0 75% 55%)" />
              <Bar dataKey="skipped" name="Omitidos" stackId="a" fill="hsl(215 15% 60%)" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Por hora del día (7 días)</CardTitle></CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={st.per_hour}>
                <XAxis dataKey="hour" fontSize={11} tickLine={false} />
                <YAxis allowDecimals={false} fontSize={11} tickLine={false} width={28} />
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
                <TableHeader><TableRow><TableHead>Aviso</TableHead><TableHead className="text-right">Enviados</TableHead><TableHead className="text-right">Pendientes</TableHead></TableRow></TableHeader>
                <TableBody>{st.by_event.map((e: any) => (
                  <TableRow key={e.event_type}><TableCell>{e.label}</TableCell><TableCell className="text-right tabular-nums">{e.sent}</TableCell><TableCell className="text-right tabular-nums">{e.pending}</TableCell></TableRow>
                ))}</TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Qué responden (30 días)</CardTitle></CardHeader>
          <CardContent>
            {st.interactions.length === 0 ? <p className="text-sm text-muted-foreground">Todavía no hay respuestas.</p> : (
              <Table>
                <TableBody>{st.interactions.map((r: any) => (
                  <TableRow key={r.action}>
                    <TableCell>{ACTIONS[r.action] || (String(r.action).startsWith("menu:") ? `Menú opción ${r.action.slice(5)}` : r.action)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.n}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ───────────────────────── Números ─────────────────────────
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("No se pudo leer la imagen"));
    r.readAsDataURL(file);
  });
}

function NumberEditor({ open, onClose, tenantId, number, isNew }: { open: boolean; onClose: () => void; tenantId: string | null; number: any | null; isNew: boolean }) {
  const qc = useQueryClient();
  const [f, setF] = useState<any>(null);
  useEffect(() => {
    if (!open) return;
    const n = number || {};
    setF({
      label: n.label || "",
      display_name: n.display_name || "",
      interval_min: n.interval_sec ? Math.round((n.interval_sec / 60) * 10) / 10 : 2,
      jitter_sec: n.jitter_sec ?? 30,
      daily_cap: n.daily_cap ?? 300,
      invite_daily_cap: n.invite_daily_cap ?? 25,
      signature: n.signature || "",
      invite_template: n.invite_template || "",
      invoice_template: n.invoice_template || "",
      payment_info: n.payment_info || "",
      payment_link: n.payment_link || "",
      menu: (n.menu || []).map((o: any) => ({ ...o })),
    });
  }, [open, number]);
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, interval_sec: Math.round(Number(f.interval_min) * 60) };
      delete body.interval_min;
      return isNew ? whatsappApi.createNumber(body, tenantId) : whatsappApi.updateNumber(number.id, body, tenantId);
    },
    onSuccess: () => { toast.success(isNew ? "Número creado: ahora conéctalo con el QR" : "Número guardado"); qc.invalidateQueries({ queryKey: ["wa-numbers"] }); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });
  if (!f) return null;
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const setOpt = (i: number, k: string, v: any) => set("menu", f.menu.map((o: any, j: number) => (j === i ? { ...o, [k]: v } : o)));
  const perHour = f.interval_min > 0 ? Math.floor(60 / f.interval_min) : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "Agregar número" : `Editar ${number?.label}`}</DialogTitle>
          <DialogDescription>Cada número tiene su QR, su ritmo, sus textos y su QR de pago. Variables: <code className="text-xs">{VARS}</code></DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label>Nombre interno</Label><Input value={f.label} onChange={(e) => set("label", e.target.value)} placeholder="Suros Empresas" /></div>
            <div className="space-y-1"><Label>Nombre que ve el cliente ({"{organizacion}"})</Label><Input value={f.display_name} onChange={(e) => set("display_name", e.target.value)} placeholder="Suros Comunicaciones" /></div>
          </div>
          <div>
            <p className="text-sm font-medium mb-2">Ritmo <span className="text-muted-foreground font-normal">· unos {perHour} por hora</span></p>
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
              <div className="space-y-1"><Label className="text-xs">Pausa (min)</Label><Input type="number" step="0.5" min={0.5} value={f.interval_min} onChange={(e) => set("interval_min", e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">Variación (± s)</Label><Input type="number" min={0} value={f.jitter_sec} onChange={(e) => set("jitter_sec", e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">Tope por día</Label><Input type="number" min={1} value={f.daily_cap} onChange={(e) => set("daily_cap", e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">Presentaciones por día</Label><Input type="number" min={0} value={f.invite_daily_cap} onChange={(e) => set("invite_daily_cap", e.target.value)} /></div>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Presentación (al primer aviso; el cliente responde SÍ o NO)</Label>
            <Textarea rows={4} value={f.invite_template} onChange={(e) => set("invite_template", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Aviso de factura nueva ({"{menu}"} pone las opciones)</Label>
            <Textarea rows={4} value={f.invoice_template} onChange={(e) => set("invoice_template", e.target.value)} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium">Menú de respuestas</p>
              <Button size="sm" variant="outline" disabled={f.menu.length >= 9}
                onClick={() => set("menu", [...f.menu, { key: String(f.menu.length + 1), label: "", reply: "", media: null, support: false }])}>
                <Plus className="h-4 w-4 mr-1" /> Opción
              </Button>
            </div>
            <div className="space-y-3">
              {f.menu.map((o: any, i: number) => (
                <div key={i} className="rounded-lg border p-3 space-y-2">
                  <div className="flex gap-2">
                    <Input className="w-16" value={o.key} onChange={(e) => setOpt(i, "key", e.target.value)} />
                    <Input value={o.label} placeholder="Texto de la opción" onChange={(e) => setOpt(i, "label", e.target.value)} />
                    <Button variant="ghost" size="icon" onClick={() => set("menu", f.menu.filter((_: any, j: number) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                  <Textarea rows={2} value={o.reply} placeholder="Respuesta automática" onChange={(e) => setOpt(i, "reply", e.target.value)} />
                  {String(o.reply).includes("{saldo}") && (
                    <Input value={o.reply_paid || ""} placeholder="Respuesta si está al día (saldo 0)" onChange={(e) => setOpt(i, "reply_paid", e.target.value)} />
                  )}
                  <div className="flex flex-wrap gap-4 text-sm">
                    <label className="flex items-center gap-2"><Switch checked={o.media === "qr"} onCheckedChange={(v) => setOpt(i, "media", v ? "qr" : null)} /> Adjuntar QR de pago</label>
                    <label className="flex items-center gap-2"><Switch checked={!!o.support} onCheckedChange={(v) => setOpt(i, "support", v)} /> Avisarme por Telegram (soporte)</label>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label>Medios de pago ({"{medios_pago}"})</Label><Textarea rows={3} value={f.payment_info} onChange={(e) => set("payment_info", e.target.value)} placeholder={"Nequi 300 000 0000\nBre-B @suros"} /></div>
            <div className="space-y-1">
              <Label>Link de pago ({"{link_pago}"})</Label><Input value={f.payment_link} onChange={(e) => set("payment_link", e.target.value)} placeholder="https://suros-comunicaciones.com/pago-cliente" />
              <Label className="pt-2 block">Firma al final</Label><Input value={f.signature} onChange={(e) => set("signature", e.target.value)} placeholder="— Suros Comunicaciones" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NumberCard({ n, tenantId, isAdmin, canEdit, onEdit }: { n: any; tenantId: string | null; isAdmin: boolean; canEdit: boolean; onEdit: () => void }) {
  const qc = useQueryClient();
  const [qr, setQr] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [linkQr, setLinkQr] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["wa-numbers"] });
  const { data: session } = useQuery({
    queryKey: ["wa-session", tenantId, n.id],
    queryFn: () => whatsappApi.session(n.id, tenantId),
    refetchInterval: qr ? 4000 : 60_000,
  });
  useEffect(() => {
    if (session?.state === "open" && qr) { setQr(null); toast.success(`${n.label} conectado`); refresh(); }
  }, [session?.state]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data: payQr } = useQuery({ queryKey: ["wa-qr", tenantId, n.id, n.has_qr], queryFn: () => whatsappApi.getQr(n.id, tenantId), enabled: !!n.has_qr });
  useEffect(() => {
    if (n.wa_link) QRCode.toDataURL(n.wa_link, { width: 600, margin: 1 }).then(setLinkQr).catch(() => setLinkQr(null));
  }, [n.wa_link]);

  const act = (fn: () => Promise<any>, ok?: string) => fn().then(() => { if (ok) toast.success(ok); refresh(); }, (e: any) => toast.error(e.message));
  const connect = useMutation({
    mutationFn: () => whatsappApi.connect(n.id, tenantId),
    onSuccess: (r: any) => { if (r?.qr) setQr(r.qr); else if (r?.state === "open") toast.success("Ya está conectado"); },
    onError: (e: any) => toast.error(e.message),
  });
  const st = SESSION[session?.state || n.connection_state] || SESSION.close;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              {n.label}{n.is_default && <Badge variant="secondary"><Star className="h-3 w-3 mr-1" />Por defecto</Badge>}
              {n.paused && <Badge variant="outline">Pausado</Badge>}
            </CardTitle>
            <CardDescription>{n.display_name}{n.connected_number && ` · +${n.connected_number}`}</CardDescription>
          </div>
          <Badge variant="outline" className={st.className}>{st.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {qr && (
          <div className="flex flex-col items-center gap-2 rounded-lg border p-4 bg-white">
            <img src={qr} alt="Código QR de WhatsApp" className="h-56 w-56" />
            <p className="text-xs text-neutral-600 text-center">WhatsApp → Dispositivos vinculados → Vincular. El QR cambia cada pocos segundos; si vence, pulsa “Mostrar QR”.</p>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Pausa {Math.round(n.interval_sec / 6) / 10} min ± {n.jitter_sec} s · tope {n.daily_cap}/día · {n.invite_daily_cap} presentaciones/día
        </p>
        <div className="flex flex-wrap gap-2">
          {isAdmin && session?.state !== "open" && (
            <Button size="sm" onClick={() => connect.mutate()} disabled={connect.isPending}>
              {connect.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <QrCode className="h-4 w-4 mr-1" />} Mostrar QR
            </Button>
          )}
          {isAdmin && <Button size="sm" variant="outline" onClick={onEdit}><Pencil className="h-4 w-4 mr-1" /> Editar</Button>}
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => act(() => whatsappApi.pauseNumber(n.id, !n.paused, tenantId), n.paused ? "Reanudado" : "Pausado")}>
              {n.paused ? <><Play className="h-4 w-4 mr-1" /> Reanudar</> : <><Pause className="h-4 w-4 mr-1" /> Pausar</>}
            </Button>
          )}
          {isAdmin && !n.is_default && <Button size="sm" variant="ghost" onClick={() => act(() => whatsappApi.setDefault(n.id, tenantId), "Ahora es el número por defecto")}><Star className="h-4 w-4 mr-1" /> Por defecto</Button>}
          {isAdmin && session?.state === "open" && (
            <Button size="sm" variant="ghost" onClick={() => confirm("¿Cerrar la sesión? Los avisos quedarán en cola hasta volver a escanear el QR.") && act(() => whatsappApi.logout(n.id, tenantId), "Sesión cerrada")}>
              <LogOut className="h-4 w-4 mr-1" /> Cerrar sesión
            </Button>
          )}
          {isAdmin && !n.is_default && (
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => confirm(`¿Borrar ${n.label}? Sus avisos pendientes pasan al número por defecto.`) && act(() => whatsappApi.deleteNumber(n.id, tenantId), "Número borrado")}>
              <Trash2 className="h-4 w-4 mr-1" /> Borrar
            </Button>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-medium">QR de pago (opción “Medios de pago”)</p>
            {payQr?.image ? <img src={payQr.image} alt="QR de pago" className="h-32 w-32 rounded border object-contain bg-white" /> : <p className="text-xs text-muted-foreground">Sin imagen</p>}
            {isAdmin && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" asChild>
                  <label className="cursor-pointer">
                    <ImagePlus className="h-4 w-4 mr-1" /> {payQr?.image ? "Cambiar" : "Subir"}
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={async (e) => {
                      const file = e.target.files?.[0]; e.target.value = "";
                      if (!file) return;
                      if (file.size > 1_500_000) return toast.error("La imagen supera 1,5 MB");
                      act(async () => whatsappApi.setQr(n.id, await fileToDataUrl(file), tenantId), "QR de pago guardado")
                        .then(() => qc.invalidateQueries({ queryKey: ["wa-qr"] }));
                    }} />
                  </label>
                </Button>
                {payQr?.image && <Button size="sm" variant="ghost" onClick={() => act(() => whatsappApi.setQr(n.id, null, tenantId), "QR quitado").then(() => qc.invalidateQueries({ queryKey: ["wa-qr"] }))}>Quitar</Button>}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Enlace para que el cliente escriba</p>
            {n.wa_link ? (
              <>
                {linkQr && <img src={linkQr} alt="QR del chat" className="h-32 w-32 rounded border bg-white" />}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => copy(n.wa_link)}><Copy className="h-4 w-4 mr-1" /> Copiar enlace</Button>
                  {linkQr && <Button size="sm" variant="outline" asChild><a href={linkQr} download={`whatsapp-${n.label}.png`}><Download className="h-4 w-4 mr-1" /> QR para imprimir</a></Button>}
                </div>
                <p className="text-[11px] text-muted-foreground">Para factura, contrato o portal de suspensión: quien escriba SÍ queda suscrito.</p>
              </>
            ) : <p className="text-xs text-muted-foreground">Aparece al conectar el número.</p>}
          </div>
        </div>

        {canEdit && (
          <div className="flex gap-2">
            <Input className="max-w-[220px]" placeholder="Tu número para probar" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} />
            <Button size="sm" variant="outline" disabled={!testPhone} onClick={() => act(() => whatsappApi.test(n.id, testPhone, "", tenantId), "Prueba en cola: sale en menos de 1 minuto")}>
              <Send className="h-4 w-4 mr-1" /> Prueba
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NumbersTab({ tenantId, numbers, maxNumbers, isAdmin, canEdit }: { tenantId: string | null; numbers: any[]; maxNumbers: number; isAdmin: boolean; canEdit: boolean }) {
  const [editing, setEditing] = useState<{ n: any | null; isNew: boolean } | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {numbers.length} de {maxNumbers} número(s). Usa un chip aparte con WhatsApp Business para cada uno. Asigna cada organización de UISP a su número en la pestaña Organizaciones.
        </p>
        {isAdmin && (
          <Button size="sm" onClick={() => setEditing({ n: null, isNew: true })} disabled={numbers.length >= maxNumbers}
            title={numbers.length >= maxNumbers ? "Llegaste al límite de números de tu plan" : undefined}>
            <Plus className="h-4 w-4 mr-1" /> Agregar número
          </Button>
        )}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {numbers.map((n) => <NumberCard key={n.id} n={n} tenantId={tenantId} isAdmin={isAdmin} canEdit={canEdit} onEdit={() => setEditing({ n, isNew: false })} />)}
      </div>
      <NumberEditor open={!!editing} onClose={() => setEditing(null)} tenantId={tenantId} number={editing?.n || null} isNew={!!editing?.isNew} />
    </div>
  );
}

// ───────────────────────── Organizaciones ─────────────────────────
function OrgsTab({ tenantId, numbers, isAdmin }: { tenantId: string | null; numbers: any[]; isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data: orgs = [], isLoading } = useQuery({ queryKey: ["wa-orgs", tenantId], queryFn: () => whatsappApi.orgs(tenantId) });
  const assign = useMutation({
    mutationFn: ({ id, number_id }: { id: number; number_id: number | null }) => whatsappApi.assignOrg(id, number_id, tenantId),
    onSuccess: () => { toast.success("Organización asignada"); qc.invalidateQueries({ queryKey: ["wa-orgs"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const def = numbers.find((n) => n.is_default);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Organizaciones de UISP</CardTitle>
        <CardDescription>Aparecen solas cuando el plugin de UISP manda el primer aviso de cada una. Las que no asignes salen por el número por defecto ({def?.label}).</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : orgs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no ha llegado ningún aviso con organización.</p>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Organización</TableHead><TableHead>UISP</TableHead><TableHead>Último aviso</TableHead><TableHead>Número</TableHead></TableRow></TableHeader>
            <TableBody>
              {orgs.map((o: any) => (
                <TableRow key={o.id}>
                  <TableCell>{o.name || `Organización ${o.org_id}`}<p className="text-[11px] text-muted-foreground">ID {o.org_id}</p></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{o.source || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{fmtDate(o.last_seen)}</TableCell>
                  <TableCell>
                    <Select value={o.number_id ? String(o.number_id) : "default"} disabled={!isAdmin}
                      onValueChange={(v) => assign.mutate({ id: o.id, number_id: v === "default" ? null : Number(v) })}>
                      <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">Por defecto ({def?.label})</SelectItem>
                        {numbers.map((n) => <SelectItem key={n.id} value={String(n.id)}>{n.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ───────────────────────── Suscriptores ─────────────────────────
function SubscribersTab({ tenantId, numbers }: { tenantId: string | null; numbers: any[] }) {
  const [numberId, setNumberId] = useState<number | null>(null);
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const limit = 50;
  const { data, isLoading } = useQuery({
    queryKey: ["wa-subs", tenantId, numberId, status, search, page],
    queryFn: () => whatsappApi.subscribers({ number_id: numberId || undefined, status: status === "all" ? undefined : status, q: search, limit, offset: page * limit }, tenantId),
  });
  const items = data?.items || [];
  const total = data?.total || 0;
  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle className="text-base">Clientes y su respuesta</CardTitle>
        <div className="flex flex-wrap gap-2">
          <NumberFilter numbers={numbers} value={numberId} onChange={(v) => { setNumberId(v); setPage(0); }} />
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {Object.entries(SUBSTATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(q); setPage(0); }}>
            <Input className="w-56" placeholder="Teléfono, nombre o cliente" value={q} onChange={(e) => setQ(e.target.value)} />
            <Button type="submit" variant="outline" size="icon"><RefreshCw className="h-4 w-4" /></Button>
          </form>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : items.length === 0 ? <p className="text-sm text-muted-foreground">No hay clientes con ese filtro.</p> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead>Teléfono</TableHead><TableHead>Estado</TableHead><TableHead>Número</TableHead><TableHead>Factura</TableHead><TableHead>Fechas</TableHead></TableRow></TableHeader>
              <TableBody>
                {items.map((s: any) => {
                  const k = SUBSTATUS[s.status] || SUBSTATUS.new;
                  return (
                    <TableRow key={`${s.number_id}-${s.phone}`}>
                      <TableCell className="text-sm">{s.client_name || "—"}{s.client_ref && <p className="text-[11px] text-muted-foreground">Cliente #{s.client_ref}</p>}</TableCell>
                      <TableCell className="text-sm tabular-nums">+{s.phone}{s.not_on_whatsapp && <p className="text-[11px] text-destructive">Sin WhatsApp</p>}</TableCell>
                      <TableCell><Badge variant="outline" className={k.className}>{k.label}</Badge></TableCell>
                      <TableCell className="text-sm">{s.number_label}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {s.context?.balance != null ? `Saldo $${Math.round(s.context.balance).toLocaleString("es-CO")}` : "—"}
                        {s.context?.due_date && <p>Vence {s.context.due_date}</p>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {s.invited_at && <p>Presentado {fmtDate(s.invited_at)}</p>}
                        {s.responded_at && <p>Respondió {fmtDate(s.responded_at)}</p>}
                        {s.last_inbound_at && <p>Último mensaje {fmtDate(s.last_inbound_at)}</p>}
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

// ───────────────────────── Cola ─────────────────────────
function QueueTab({ tenantId, numbers, isAdmin, canEdit, eventLabels, paused }: { tenantId: string | null; numbers: any[]; isAdmin: boolean; canEdit: boolean; eventLabels: Record<string, string>; paused: boolean }) {
  const qc = useQueryClient();
  const [numberId, setNumberId] = useState<number | null>(null);
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const limit = 50;
  const { data, isLoading } = useQuery({
    queryKey: ["wa-queue", tenantId, numberId, status, search, page],
    queryFn: () => whatsappApi.queue({ number_id: numberId || undefined, status: status === "all" ? undefined : status, q: search, limit, offset: page * limit }, tenantId),
    refetchInterval: 30_000,
  });
  const refresh = () => ["wa-queue", "wa-stats", "wa-settings"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const act = useMutation({
    mutationFn: ({ id, kind }: { id: number; kind: "retry" | "cancel" }) => (kind === "retry" ? whatsappApi.retry(id, tenantId) : whatsappApi.cancel(id, tenantId)),
    onSuccess: refresh,
    onError: (e: any) => toast.error(e.message),
  });
  const pause = useMutation({
    mutationFn: () => whatsappApi.pause(!paused, tenantId),
    onSuccess: (r: any) => { toast.success(r.paused ? "Envíos pausados" : "Envíos reanudados"); refresh(); },
    onError: (e: any) => toast.error(e.message),
  });
  const cancelAll = useMutation({
    mutationFn: (event: string | null) => whatsappApi.cancelPending(event, numberId, tenantId),
    onSuccess: (r: any) => { toast.success(`${r.cancelled} aviso(s) cancelados`); refresh(); },
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
              {paused ? <><Play className="h-4 w-4 mr-1" /> Reanudar todo</> : <><Pause className="h-4 w-4 mr-1" /> Pausar todo</>}
            </Button>
            {isAdmin && (
              <Select onValueChange={(v) => {
                const ev = v === "all" ? null : v;
                if (confirm(`¿Cancelar todos los avisos pendientes${ev ? ` de "${eventLabels[ev] || ev}"` : ""}?`)) cancelAll.mutate(ev);
              }}>
                <SelectTrigger className="w-52 h-9"><SelectValue placeholder="Cancelar pendientes…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los pendientes</SelectItem>
                  {Object.entries(eventLabels).map(([k, l]) => <SelectItem key={k} value={k}>Solo: {l}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
        {paused && <p className="text-sm text-amber-600 dark:text-amber-400">Los envíos están pausados: los avisos se acumulan en la cola.</p>}
        <div className="flex flex-wrap gap-2">
          <NumberFilter numbers={numbers} value={numberId} onChange={(v) => { setNumberId(v); setPage(0); }} />
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
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
                <TableRow><TableHead>Estado</TableHead><TableHead>Tipo</TableHead><TableHead>Teléfono</TableHead><TableHead className="min-w-[260px]">Mensaje</TableHead><TableHead>Fecha</TableHead><TableHead /></TableRow>
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
                      <TableCell className="text-sm">
                        {m.kind === "notice" ? (eventLabels[m.event_type] || m.event_type) : KIND[m.kind] || m.kind}
                        <p className="text-[11px] text-muted-foreground">{m.number_label}{m.kind === "notice" ? ` · prioridad ${m.priority}` : ""}</p>
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">+{m.phone}{m.client_ref && <p className="text-[11px] text-muted-foreground">Cliente {m.client_ref}</p>}</TableCell>
                      <TableCell className="text-sm"><p className="line-clamp-3 whitespace-pre-line">{m.message}</p></TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(m.sent_at || m.created_at)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {canEdit && m.kind === "notice" && ["failed", "cancelled", "skipped"].includes(m.status) && (
                          <Button variant="ghost" size="icon" title="Reintentar" onClick={() => act.mutate({ id: m.id, kind: "retry" })}><RotateCcw className="h-4 w-4" /></Button>
                        )}
                        {canEdit && ["pending", "waiting"].includes(m.status) && (
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

// ───────────────────────── Configuración del ISP ─────────────────────────
function SettingsTab({ tenantId, settings, isAdmin }: { tenantId: string | null; settings: any; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [f, setF] = useState<any>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  useEffect(() => {
    if (!settings) return;
    setF({
      enabled: settings.enabled,
      hour_start: settings.hour_start,
      hour_end: settings.hour_end,
      days: String(settings.days).split(",").map(Number),
      priorities: { ...settings.default_priorities, ...(settings.priorities || {}) },
      alert_disconnect: settings.alert_disconnect,
      optout_word: settings.optout_word,
      optin_words: settings.optin_words,
      decline_words: settings.decline_words,
      optin_any_message: settings.optin_any_message,
      invite_wait_days: settings.invite_wait_days,
      footer: settings.footer,
    });
  }, [settings]);
  const save = useMutation({
    mutationFn: () => whatsappApi.saveSettings(f, tenantId),
    onSuccess: () => { toast.success("Configuración guardada"); ["wa-settings", "wa-stats"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
    onError: (e: any) => toast.error(e.message),
  });
  const regen = useMutation({
    mutationFn: () => whatsappApi.regenerateKey(tenantId),
    onSuccess: (r: any) => { setNewKey(r.api_key); qc.invalidateQueries({ queryKey: ["wa-settings"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  if (!f) return null;
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const ro = !isAdmin;
  const enqueueUrl = `${window.location.origin}/api/public/whatsapp/enqueue`;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Envíos del ISP</CardTitle><CardDescription>Horario y días comunes a todos los números. El ritmo y los topes se ajustan en cada número.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between"><Label>Envíos activos</Label><Switch checked={f.enabled} disabled={ro} onCheckedChange={(v) => set("enabled", v)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Desde (hora)</Label><Input type="number" min={0} max={23} disabled={ro} value={f.hour_start} onChange={(e) => set("hour_start", e.target.value)} /></div>
            <div className="space-y-1"><Label>Hasta (hora)</Label><Input type="number" min={1} max={24} disabled={ro} value={f.hour_end} onChange={(e) => set("hour_end", e.target.value)} /></div>
          </div>
          <div className="space-y-1">
            <Label>Días de envío</Label>
            <div className="flex flex-wrap gap-1">
              {DAYS.map((d) => {
                const on = f.days.includes(d.v);
                return <Button key={d.v} type="button" size="sm" variant={on ? "default" : "outline"} disabled={ro} onClick={() => set("days", on ? f.days.filter((x: number) => x !== d.v) : [...f.days, d.v])}>{d.l}</Button>;
              })}
            </div>
          </div>
          <div className="flex items-center justify-between"><Label>Avisarme por Telegram si un número se cae</Label><Switch checked={f.alert_disconnect} disabled={ro} onCheckedChange={(v) => set("alert_disconnect", v)} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Permiso del cliente</CardTitle><CardDescription>Al primer aviso se le pide permiso. El aviso espera hasta que responda.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Palabras para aceptar</Label><Input disabled={ro} value={f.optin_words} onChange={(e) => set("optin_words", e.target.value)} /></div>
            <div className="space-y-1"><Label>Palabras para rechazar</Label><Input disabled={ro} value={f.decline_words} onChange={(e) => set("decline_words", e.target.value)} /></div>
            <div className="space-y-1"><Label>Palabra de baja</Label><Input disabled={ro} value={f.optout_word} onChange={(e) => set("optout_word", e.target.value.toUpperCase())} /></div>
            <div className="space-y-1"><Label>Días para responder</Label><Input type="number" min={1} max={30} disabled={ro} value={f.invite_wait_days} onChange={(e) => set("invite_wait_days", e.target.value)} /></div>
          </div>
          <div className="flex items-start justify-between gap-3">
            <div><Label>Cualquier mensaje cuenta como aceptación</Label><p className="text-xs text-muted-foreground">Apagado: solo las palabras de aceptar. Así un mensaje de soporte no suscribe a nadie.</p></div>
            <Switch checked={f.optin_any_message} disabled={ro} onCheckedChange={(v) => set("optin_any_message", v)} />
          </div>
          <div className="space-y-1"><Label>Pie de cada aviso (debe llevar {"{baja}"})</Label><Input disabled={ro} value={f.footer} onChange={(e) => set("footer", e.target.value)} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Prioridad por tipo de aviso</CardTitle><CardDescription>1 = sale primero. Los pagos se adelantan a las facturas del día de facturación.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          {Object.entries(settings.event_labels as Record<string, string>).map(([k, label]) => (
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
          <CardDescription>Pega esta dirección y la clave en el plugin Omnisync de cada UISP de este ISP. La organización de cada cliente decide el número.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1"><Label>Dirección</Label><div className="flex gap-2"><Input readOnly value={enqueueUrl} /><Button variant="outline" size="icon" onClick={() => copy(enqueueUrl)}><Copy className="h-4 w-4" /></Button></div></div>
          <p className="text-sm text-muted-foreground">Clave: {settings.has_api_key ? `configurada (${settings.api_key_hint})` : "todavía no hay"}</p>
          {isAdmin && (
            <Button variant="outline" onClick={() => (!settings.has_api_key || confirm("La clave actual dejará de funcionar en los plugins que la usen. ¿Generar una nueva?")) && regen.mutate()}>
              <KeyRound className="h-4 w-4 mr-1" /> {settings.has_api_key ? "Generar clave nueva" : "Generar clave"}
            </Button>
          )}
        </CardContent>
      </Card>

      {isAdmin && (
        <div className="lg:col-span-2 flex justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Guardar configuración</Button>
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

  const { data: overview = [] } = useQuery({
    queryKey: ["wa-overview"],
    queryFn: () => whatsappApi.overview(),
    enabled: !!isSuperAdmin,
    refetchInterval: 60_000,
  });
  useEffect(() => {
    if (isSuperAdmin && !tenantId && overview.length) setTenantId(overview[0].id);
  }, [isSuperAdmin, overview, tenantId]);

  const ready = !isSuperAdmin || !!tenantId;
  const { data: settings, error } = useQuery({
    queryKey: ["wa-settings", tenantId],
    queryFn: () => whatsappApi.settings(tenantId),
    enabled: ready,
    retry: false,
  });
  const { data: numbers = [] } = useQuery({
    queryKey: ["wa-numbers", tenantId],
    queryFn: () => whatsappApi.numbers(tenantId),
    enabled: ready && !!settings,
    refetchInterval: 60_000,
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
            <p className="text-sm text-muted-foreground">Avisos de UISP por tu propio número (QR). Primero se pide permiso al cliente; cada organización puede tener su número.</p>
          </div>
          {isSuperAdmin && (
            <Select value={tenantId || ""} onValueChange={setTenantId}>
              <SelectTrigger className="w-72"><SelectValue placeholder="Elige un ISP" /></SelectTrigger>
              <SelectContent>
                {overview.map((o: any) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name} · {o.module ? `${o.connected}/${o.numbers} conectados` : "módulo apagado"} · {o.pending} en cola
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
              <TabsTrigger value="numeros">Números</TabsTrigger>
              <TabsTrigger value="orgs">Organizaciones</TabsTrigger>
              <TabsTrigger value="clientes">Clientes</TabsTrigger>
              <TabsTrigger value="cola">Cola</TabsTrigger>
              <TabsTrigger value="config">Configuración</TabsTrigger>
            </TabsList>
            <TabsContent value="panel" className="mt-4"><PanelTab tenantId={tenantId} numbers={numbers} /></TabsContent>
            <TabsContent value="numeros" className="mt-4"><NumbersTab tenantId={tenantId} numbers={numbers} maxNumbers={settings.max_numbers || 1} isAdmin={admin} canEdit={edit} /></TabsContent>
            <TabsContent value="orgs" className="mt-4"><OrgsTab tenantId={tenantId} numbers={numbers} isAdmin={admin} /></TabsContent>
            <TabsContent value="clientes" className="mt-4"><SubscribersTab tenantId={tenantId} numbers={numbers} /></TabsContent>
            <TabsContent value="cola" className="mt-4"><QueueTab tenantId={tenantId} numbers={numbers} isAdmin={admin} canEdit={edit} eventLabels={eventLabels} paused={settings.paused} /></TabsContent>
            <TabsContent value="config" className="mt-4"><SettingsTab tenantId={tenantId} settings={settings} isAdmin={admin} /></TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}
