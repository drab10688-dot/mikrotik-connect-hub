import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { monitorApi } from "@/lib/api-client";
import { useAuth } from "@/hooks/useAuth";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PingChart } from "@/components/monitor/PingChart";
import { toast } from "sonner";
import { Activity, AlertTriangle, CheckCircle2, Globe, Loader2, Send, Unplug, WifiOff, Radar } from "lucide-react";

const STATUS: Record<string, { label: string; icon: any; className: string }> = {
  ok: { label: "En línea", icon: CheckCircle2, className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" },
  high: { label: "Ping alto", icon: AlertTriangle, className: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30" },
  loss: { label: "Pérdida de paquetes", icon: AlertTriangle, className: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30" },
  no_internet: { label: "Sin internet", icon: Globe, className: "bg-destructive/15 text-destructive border-destructive/30" },
  down: { label: "No responde", icon: Unplug, className: "bg-destructive/15 text-destructive border-destructive/30" },
};

function sinceText(iso?: string | null) {
  if (!iso) return "";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return min < 60 ? `hace ${min} min` : min < 1440 ? `hace ${Math.floor(min / 60)} h ${min % 60} min` : `hace ${Math.floor(min / 1440)} d`;
}

const ms = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v)} ms`);

function RouterCard({ r, hours, threshold }: { r: any; hours: number; threshold: number }) {
  const { data: points = [] } = useQuery({
    queryKey: ["monitor-history", r.id, hours],
    queryFn: () => monitorApi.history(r.id, hours),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
  const st = r.status ? STATUS[r.status] : null;
  const Icon = st?.icon || Activity;
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{r.name}</CardTitle>
            <CardDescription className="font-mono text-xs">{r.host}{r.tenant_name ? ` · ${r.tenant_name}` : ""}</CardDescription>
          </div>
          {st ? (
            <Badge variant="outline" className={`gap-1 ${st.className}`}>
              <Icon className="h-3.5 w-3.5" /> {st.label}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">Sin datos</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <div className="text-[11px] text-muted-foreground">Internet</div>
            <div className="text-lg font-semibold tabular-nums">{ms(r.inet_rtt)}</div>
            <div className="text-[11px] text-muted-foreground tabular-nums">prom. 1 h {ms(r.hour?.inet_avg)}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground">VPN</div>
            <div className="text-lg font-semibold tabular-nums">{ms(r.vpn_rtt)}</div>
            <div className="text-[11px] text-muted-foreground tabular-nums">prom. 1 h {ms(r.hour?.vpn_avg)}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground">Pérdida</div>
            <div className="text-lg font-semibold tabular-nums">{r.inet_loss ?? r.vpn_loss ?? "—"}{(r.inet_loss ?? r.vpn_loss) != null ? "%" : ""}</div>
            <div className="text-[11px] text-muted-foreground tabular-nums">
              {r.hour?.down_pct ? `caído ${Math.round(r.hour.down_pct)}% de la hora` : "última hora sin caídas"}
            </div>
          </div>
        </div>
        {r.status && r.status !== "ok" && r.since && (
          <p className="text-xs text-muted-foreground">Así desde {sinceText(r.since)}{r.alerted ? " · alerta enviada" : ""}</p>
        )}
        <PingChart points={points} threshold={threshold} />
      </CardContent>
    </Card>
  );
}

function AlertSettings() {
  const qc = useQueryClient();
  const { data: s } = useQuery({ queryKey: ["monitor-settings"], queryFn: () => monitorApi.settings() });
  const [f, setF] = useState({ enabled: false, telegram_token: "", telegram_chat: "", rtt_ms: 150, loss_pct: 20 });
  const [chats, setChats] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (s) setF({ enabled: s.enabled, telegram_token: "", telegram_chat: s.telegram_chat || "", rtt_ms: s.rtt_ms, loss_pct: s.loss_pct });
  }, [s]);

  const save = useMutation({
    mutationFn: () => monitorApi.saveSettings(f),
    onSuccess: (d: any) => {
      toast.success(d?.enabled ? "Alertas activadas" : "Ajustes guardados");
      setF((x) => ({ ...x, telegram_token: "" }));
      qc.invalidateQueries({ queryKey: ["monitor-settings"] });
    },
    onError: (e: any) => toast.error(e?.message || "No se pudo guardar"),
  });
  const test = useMutation({
    mutationFn: () => monitorApi.test(),
    onSuccess: () => toast.success("Mensaje de prueba enviado"),
    onError: (e: any) => toast.error(e?.message || "No se pudo enviar"),
  });
  const detect = useMutation({
    mutationFn: () => monitorApi.detectChat(f.telegram_token || undefined),
    onSuccess: (list: any[]) => {
      setChats(list || []);
      if (!list?.length) toast.info("El bot no tiene mensajes: escríbele algo (o agrégalo al grupo y escribe ahí) y vuelve a intentar.");
      else if (list.length === 1) setF((x) => ({ ...x, telegram_chat: list[0].id }));
    },
    onError: (e: any) => toast.error(e?.message || "No se pudo consultar Telegram"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2"><Send className="h-5 w-5 text-primary" /> Alertas por Telegram</CardTitle>
        <CardDescription>
          {s?.scope === "global"
            ? "Tu bot recibe las alertas de TODOS los ISP."
            : "Avisos de los routers de tu ISP."}{" "}
          Se avisa cuando un problema dura 3 mediciones seguidas (3 min) y otra vez cuando se normaliza.
          Crea el bot con <b>@BotFather</b> en Telegram, pega aquí su token, escríbele un mensaje (o agrégalo a tu grupo) y pulsa
          "Buscar chat".
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Token del bot</Label>
            <Input type="password" autoComplete="off" placeholder={s?.has_token ? `Guardado (${s.token_hint}) — escribe otro para cambiarlo` : "123456789:ABC…"}
              value={f.telegram_token} onChange={(e) => setF({ ...f, telegram_token: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Chat</Label>
            <div className="flex gap-2">
              <Input placeholder="-1001234567890" value={f.telegram_chat} onChange={(e) => setF({ ...f, telegram_chat: e.target.value })} />
              <Button variant="outline" onClick={() => detect.mutate()} disabled={detect.isPending || (!f.telegram_token && !s?.has_token)}>
                {detect.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buscar chat"}
              </Button>
            </div>
            {chats.length > 1 && (
              <Select value={f.telegram_chat} onValueChange={(v) => setF({ ...f, telegram_chat: v })}>
                <SelectTrigger className="h-8"><SelectValue placeholder="Elige el chat" /></SelectTrigger>
                <SelectContent>
                  {chats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} ({c.id})</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Ping alto a internet desde (ms)</Label>
            <Input type="number" min={20} max={5000} value={f.rtt_ms} onChange={(e) => setF({ ...f, rtt_ms: Number(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label>Pérdida de paquetes desde (%)</Label>
            <Input type="number" min={1} max={100} value={f.loss_pct} onChange={(e) => setF({ ...f, loss_pct: Number(e.target.value) })} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch checked={f.enabled} onCheckedChange={(v) => setF({ ...f, enabled: v })} />
            <Label>Enviar alertas</Label>
          </div>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar
          </Button>
          <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending || !s?.has_token || !s?.telegram_chat}>
            Enviar prueba
          </Button>
          <span className="text-xs text-muted-foreground">Los umbrales también marcan el estado en esta pantalla.</span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function NetMonitor() {
  const { isAdmin, isSuperAdmin } = useAuth();
  const [hours, setHours] = useState(24);
  const { data, isLoading } = useQuery({
    queryKey: ["monitor-status"],
    queryFn: () => monitorApi.status(),
    refetchInterval: 30_000,
  });
  const { data: settings } = useQuery({ queryKey: ["monitor-settings"], queryFn: () => monitorApi.settings(), enabled: isAdmin || isSuperAdmin });
  const routers: any[] = data?.routers || [];
  const problems = routers.filter((r) => r.status && r.status !== "ok");

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="p-4 md:p-8 md:ml-64 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold flex items-center gap-2"><Radar className="h-6 w-6 text-primary" /> Monitor de red</h1>
            <p className="text-sm text-muted-foreground">
              Cada minuto: ping del VPS a cada MikroTik por la VPN y ping del router a internet (8.8.8.8).
              {routers.length > 0 && (problems.length
                ? ` ${problems.length} de ${routers.length} con problemas.`
                : ` Los ${routers.length} routers están bien.`)}
            </p>
          </div>
          <Select value={String(hours)} onValueChange={(v) => setHours(Number(v))}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Última hora</SelectItem>
              <SelectItem value="6">Últimas 6 h</SelectItem>
              <SelectItem value="24">Últimas 24 h</SelectItem>
              <SelectItem value="168">Últimos 7 días</SelectItem>
            </SelectContent>
          </Select>
        </header>

        {isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {!isLoading && !routers.length && (
          <Card><CardContent className="py-10 text-center text-muted-foreground"><WifiOff className="mx-auto mb-2 h-6 w-6" /> No hay routers MikroTik para monitorear.</CardContent></Card>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {[...problems, ...routers.filter((r) => !r.status || r.status === "ok")].map((r) => (
            <RouterCard key={r.id} r={r} hours={hours} threshold={settings?.rtt_ms ?? 150} />
          ))}
        </div>

        {(isAdmin || isSuperAdmin) && <AlertSettings />}
      </div>
    </div>
  );
}
