import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import OnuRadiosPanel from "@/components/onu/OnuRadiosPanel";
import OpticalMeter, { opticalTone } from "@/components/onu/OpticalMeter";
import KpiCard from "@/components/dashboard/KpiCard";
import {
  Activity,
  Antenna,
  Check,
  ChevronRight,
  Clock,
  Cpu,
  Eye,
  EyeOff,
  Gauge,
  Loader2,
  Network,
  Pencil,
  RotateCcw,
  Search,
  Signal,
  SignalLow,
  Wifi,
  X,
} from "lucide-react";

interface RadioInfo {
  index: string;
  ssid: string | null;
  enabled: boolean;
  channel: number | null;
  band: "2.4GHz" | "5GHz";
  password: string | null;
}

interface SignalEntry {
  deviceId: string;
  manufacturer: string;
  model: string;
  serial: string;
  rxPower: number | null;
  txPower: number | null;
  lastInform: string | null;
  radios?: RadioInfo[];
}

interface OnuMeta {
  uptime: number | null;
  softwareVersion: string;
  manufacturer: string;
  model: string;
  serial: string;
}

const OFFLINE_AFTER_MS = 5 * 60 * 1000;

function isOffline(lastInform: string | null | undefined) {
  if (!lastInform) return true;
  const t = new Date(lastInform).getTime();
  if (!Number.isFinite(t)) return true;
  return Date.now() - t > OFFLINE_AFTER_MS;
}

function sinceLabel(lastInform: string | null | undefined) {
  if (!lastInform) return "sin reportes";
  const diff = Date.now() - new Date(lastInform).getTime();
  if (!Number.isFinite(diff)) return "sin reportes";
  const min = Math.floor(diff / 60000);
  if (min < 60) return `hace ${Math.max(min, 1)} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

function formatUptime(seconds: number | null) {
  if (!seconds) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

type Filter = "all" | "online" | "offline" | "critical" | "wifi";

export default function SimpleOnuPanel() {
  const [devices, setDevices] = useState<string[]>([]);
  const [signals, setSignals] = useState<Record<string, SignalEntry>>({});
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<"unknown" | "online" | "offline">("unknown");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pppoe, setPppoe] = useState<Record<string, { username: string; password: string }>>({});
  const [pppoeCurrent, setPppoeCurrent] = useState<Record<string, any[]>>({});
  const [showPppoePass, setShowPppoePass] = useState<Record<string, boolean>>({});
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [pppoeNames, setPppoeNames] = useState<Record<string, string>>({});
  const [meta, setMeta] = useState<Record<string, OnuMeta>>({});
  const [editingAlias, setEditingAlias] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [, setTick] = useState(0);

  const loadSignals = useCallback(async () => {
    try {
      const res = await api("/genieacs/signal-overview");
      const list: SignalEntry[] = Array.isArray(res) ? res : (res?.data || []);
      const map: Record<string, SignalEntry> = {};
      list.forEach((e) => { map[e.deviceId] = e; });
      setSignals((s) => ({ ...s, ...map }));
    } catch {
      /* silencioso */
    }
  }, []);

  const loadPppoe = useCallback(async (deviceId: string) => {
    try {
      const res = await api(`/genieacs/devices/${encodeURIComponent(deviceId)}/pppoe`);
      const list = Array.isArray(res) ? res : (res?.data || []);
      setPppoeCurrent((p) => ({ ...p, [deviceId]: list }));
      const first = list[0];
      if (first) {
        setPppoe((p) => ({
          ...p,
          [deviceId]: p[deviceId] || { username: first.username || "", password: first.password || "" },
        }));
      }
    } catch {
      setPppoeCurrent((p) => ({ ...p, [deviceId]: [] }));
    }
  }, []);

  const loadMeta = useCallback(async (deviceId: string) => {
    try {
      const res = await api(`/genieacs/devices/${encodeURIComponent(deviceId)}/onu-status`);
      const data = res?.data ?? res;
      if (data && typeof data === "object") {
        setMeta((m) => ({
          ...m,
          [deviceId]: {
            uptime: data.uptime ?? null,
            softwareVersion: data.softwareVersion || "—",
            manufacturer: data.manufacturer || "—",
            model: data.model || "—",
            serial: data.serial || "—",
          },
        }));
      }
    } catch {
      /* opcional */
    }
  }, []);

  // Una sola llamada al backend: lista + señal + usuario PPPoE + alias
  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const res = await api("/genieacs/overview");
      const list: any[] = Array.isArray(res) ? res : (res?.data || []);
      setHealth("online");
      const sigMap: Record<string, SignalEntry> = {};
      const aliasMap: Record<string, string> = {};
      const nameMap: Record<string, string> = {};
      list.forEach((e: any) => {
        sigMap[e.deviceId] = {
          deviceId: e.deviceId,
          manufacturer: e.manufacturer,
          model: e.model,
          serial: e.serial,
          rxPower: e.rxPower ?? null,
          txPower: e.txPower ?? null,
          lastInform: e.lastInform ?? null,
          radios: Array.isArray(e.radios) ? e.radios : [],
        };
        if (e.alias) aliasMap[e.deviceId] = e.alias;
        if (e.pppoeUsername) nameMap[e.deviceId] = e.pppoeUsername;
      });
      setSignals(sigMap);
      setAliases((a) => ({ ...a, ...aliasMap }));
      setPppoeNames(nameMap);
      setDevices(list.map((e: any) => e.deviceId));
    } catch {
      setHealth("offline");
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = window.setInterval(() => load(false), 10000);
    return () => window.clearInterval(t);
  }, [load]);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 10000);
    return () => window.clearInterval(t);
  }, []);

  const saveAlias = async (deviceId: string) => {
    const name = aliasDraft.trim();
    setBusy(`alias-${deviceId}`);
    try {
      await api(`/genieacs/devices/${encodeURIComponent(deviceId)}/alias`, { method: "POST", body: { name } });
      setAliases((a) => {
        const next = { ...a };
        if (name) next[deviceId] = name; else delete next[deviceId];
        return next;
      });
      setEditingAlias(null);
      toast.success(name ? "Nombre guardado" : "Nombre eliminado");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const refreshSignal = async (deviceId: string) => {
    setBusy(`sig-${deviceId}`);
    try {
      await api(`/genieacs/devices/${encodeURIComponent(deviceId)}/refresh-signal`, { method: "POST" });
      toast.success("Leyendo señal óptica, espere unos segundos…");
      setTimeout(loadSignals, 10000);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const refreshPppoe = async (deviceId: string) => {
    setBusy(`rpppoe-${deviceId}`);
    try {
      await api(`/genieacs/devices/${encodeURIComponent(deviceId)}/refresh-pppoe`, { method: "POST" });
      toast.success("Leyendo PPPoE de la ONU, espere unos segundos…");
      setTimeout(() => loadPppoe(deviceId), 8000);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const refreshParams = async (deviceId: string) => {
    setBusy(`tr069-${deviceId}`);
    try {
      const res = await api(`/genieacs/devices/${encodeURIComponent(deviceId)}/refresh-onu`, { method: "POST" });
      toast.success(res?.message || "Solicitud TR-069 enviada a la ONU");
      setTimeout(() => { loadMeta(deviceId); load(false); }, 6000);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const savePppoe = async (deviceId: string) => {
    const form = pppoe[deviceId];
    if (!form?.username) return toast.error("Ingrese el usuario PPPoE");
    setBusy(`pppoe-${deviceId}`);
    try {
      const res = await api(`/genieacs/devices/${encodeURIComponent(deviceId)}/pppoe`, {
        method: "POST",
        body: { username: form.username, password: form.password },
      });
      toast.success(res?.message || "PPPoE enviado a la ONU");
      setTimeout(() => loadPppoe(deviceId), 8000);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const openDevice = (deviceId: string) => {
    setSelected(deviceId);
    loadPppoe(deviceId);
    loadMeta(deviceId);
  };

  const displayName = (id: string) => {
    const sig = signals[id];
    return pppoeNames[id] || aliases[id] || `${sig?.manufacturer || "ONU"} ${sig?.model || ""}`.trim();
  };

  const stats = useMemo(() => {
    const online = devices.filter((id) => !isOffline(signals[id]?.lastInform));
    const critical = devices.filter((id) => opticalTone(signals[id]?.rxPower) === "crit");
    const wifi = devices.filter((id) => (signals[id]?.radios || []).some((r) => r.enabled && r.ssid));
    return { total: devices.length, online: online.length, offline: devices.length - online.length, critical: critical.length, wifi: wifi.length };
  }, [devices, signals]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return devices.filter((id) => {
      const sig = signals[id];
      const off = isOffline(sig?.lastInform);
      if (filter === "online" && off) return false;
      if (filter === "offline" && !off) return false;
      if (filter === "critical" && opticalTone(sig?.rxPower) !== "crit") return false;
      if (filter === "wifi" && !(sig?.radios || []).some((r) => r.enabled && r.ssid)) return false;
      if (!q) return true;
      return [displayName(id), sig?.serial, sig?.model, sig?.manufacturer, pppoeNames[id]]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices, signals, filter, query, aliases, pppoeNames]);

  if (health === "offline" && !loading) {
    return (
      <Card>
        <CardContent className="p-10 text-center space-y-3">
          <Signal className="w-10 h-10 mx-auto text-muted-foreground" />
          <p className="font-medium">El ACS no está disponible</p>
          <p className="text-sm text-muted-foreground">
            Configure las ONUs con la URL del ACS: <code className="bg-muted px-2 py-1 rounded">http://[IP_DEL_VPS]:7547</code>
          </p>
          <Button variant="outline" onClick={() => load()}><RotateCcw className="w-4 h-4 mr-2" /> Reintentar</Button>
        </CardContent>
      </Card>
    );
  }

  const sel = selected ? signals[selected] : null;
  const selMeta = selected ? meta[selected] : null;
  const selOffline = isOffline(sel?.lastInform);
  const selForm = (selected && pppoe[selected]) || { username: "", password: "" };

  return (
    <div className="space-y-5 min-w-0">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard label="Total registradas" value={stats.total} icon={Antenna} tone="neutral" loading={loading}
          onClick={() => setFilter("all")} active={filter === "all"} />
        <KpiCard label="En línea" value={stats.online} icon={Activity} tone="success" loading={loading}
          onClick={() => setFilter("online")} active={filter === "online"} />
        <KpiCard label="Desconectadas" value={stats.offline} icon={SignalLow} tone="danger" loading={loading}
          onClick={() => setFilter("offline")} active={filter === "offline"} />
        <KpiCard label="Señal crítica" hint="≤ −28 dBm" value={stats.critical} icon={Gauge} tone="warning" loading={loading}
          onClick={() => setFilter("critical")} active={filter === "critical"} />
        <KpiCard label="Wi-Fi activo" value={stats.wifi} icon={Wifi} tone="info" loading={loading}
          onClick={() => setFilter("wifi")} active={filter === "wifi"} />
      </div>

      {/* Barra de control */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por cliente, PPPoE, serie o modelo…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={health === "online" ? "secondary" : "outline"}>
            {health === "online" ? "ACS en línea" : "Conectando…"}
          </Badge>
          <Button size="sm" variant="outline" onClick={() => load()} disabled={loading}>
            <RotateCcw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Actualizar
          </Button>
        </div>
      </div>

      {/* Tabla de ONUs */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="min-w-[220px]">ONU / Cliente</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="min-w-[150px]">Potencia óptica</TableHead>
                <TableHead className="hidden md:table-cell">Wi-Fi</TableHead>
                <TableHead className="hidden lg:table-cell">PPPoE</TableHead>
                <TableHead className="hidden sm:table-cell">Último reporte</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-sm text-muted-foreground">
                    {loading ? (
                      <Loader2 className="w-5 h-5 mx-auto animate-spin" />
                    ) : devices.length === 0 ? (
                      "Aún no hay ONUs conectadas al ACS."
                    ) : (
                      "Ninguna ONU coincide con el filtro."
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((id) => {
                  const sig = signals[id];
                  const off = isOffline(sig?.lastInform);
                  const radios = (sig?.radios || []).filter((r) => r.ssid);
                  const activeRadios = radios.filter((r) => r.enabled);
                  return (
                    <TableRow key={id} className="cursor-pointer" onClick={() => openDevice(id)}>
                      <TableCell>
                        <div className="flex items-center gap-3 min-w-0">
                          <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${off ? "bg-destructive" : "bg-success"}`} />
                          <div className="min-w-0">
                            <p className="font-medium truncate">{displayName(id)}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {sig?.manufacturer} {sig?.model} · <span className="font-mono">{sig?.serial}</span>
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={off ? "destructive" : "secondary"} className="text-[11px]">
                          {off ? "Desconectada" : "En línea"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <OpticalMeter compact rx={sig?.rxPower ?? null} tx={sig?.txPower ?? null} dimmed={off} />
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {activeRadios.length ? (
                          <div className="flex flex-wrap gap-1">
                            {activeRadios.slice(0, 2).map((r) => (
                              <Badge key={r.index} variant="outline" className="text-[10px] font-normal">
                                <Wifi className="w-3 h-3 mr-1 text-primary" />
                                {r.ssid} · {r.band}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">{radios.length ? "apagadas" : "sin datos"}</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm font-mono">
                        {pppoeNames[id] || "—"}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                        {sinceLabel(sig?.lastInform)}
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Panel detallado */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) { setSelected(null); setEditingAlias(null); } }}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto p-0">
          {selected && (
            <>
              {/* Cabecera con identidad de marca */}
              <div className="relative overflow-hidden rounded-t-lg border-b bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-6 pt-6 pb-5">
                <DialogHeader className="space-y-2">
                  <DialogTitle className="flex flex-wrap items-center gap-3 pr-8">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary shadow-sm">
                      <Antenna className="h-5 w-5" />
                    </span>
                    {editingAlias === selected ? (
                      <span className="flex items-center gap-1">
                        <Input
                          autoFocus
                          className="h-9 w-56"
                          placeholder="Nombre del cliente"
                          value={aliasDraft}
                          onChange={(e) => setAliasDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveAlias(selected);
                            if (e.key === "Escape") setEditingAlias(null);
                          }}
                        />
                        <Button size="sm" variant="default" className="h-9 px-3" onClick={() => saveAlias(selected)} disabled={busy === `alias-${selected}`}>
                          {busy === `alias-${selected}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        </Button>
                        <Button size="sm" variant="outline" className="h-9 px-3" onClick={() => setEditingAlias(null)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </span>
                    ) : (
                      <>
                        <span className="truncate text-lg font-semibold tracking-tight">{displayName(selected)}</span>
                        <Button
                          size="sm" variant="outline" className="h-8 gap-1.5 px-2.5 text-xs"
                          onClick={() => { setEditingAlias(selected); setAliasDraft(aliases[selected] || ""); }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Renombrar
                        </Button>
                      </>
                    )}
                    <Badge
                      variant={selOffline ? "destructive" : "secondary"}
                      className={selOffline ? "" : "border-success/30 bg-success/15 text-success"}
                    >
                      <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${selOffline ? "bg-destructive-foreground/80" : "bg-success"}`} />
                      {selOffline ? "Desconectada" : "En línea"}
                    </Badge>
                  </DialogTitle>
                  <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px]">
                    <span className="rounded bg-background/70 px-1.5 py-0.5 border">{sel?.manufacturer || "—"}</span>
                    <span className="rounded bg-background/70 px-1.5 py-0.5 border">{sel?.model || "—"}</span>
                    <span className="rounded bg-background/70 px-1.5 py-0.5 border">SN {sel?.serial || "—"}</span>
                  </DialogDescription>
                </DialogHeader>
              </div>

              <div className="space-y-4 px-6 pb-6">
              {/* Barra de acciones rápidas */}
              <div className="flex flex-wrap gap-2 rounded-xl border bg-card p-2 shadow-sm">
                <Button size="sm" variant="default" className="gap-2 shadow-sm" onClick={() => refreshSignal(selected)} disabled={busy === `sig-${selected}`}>
                  {busy === `sig-${selected}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Signal className="h-4 w-4" />}
                  Refrescar señal
                </Button>
                <Button size="sm" variant="secondary" className="gap-2 border" onClick={() => refreshPppoe(selected)} disabled={busy === `rpppoe-${selected}`}>
                  {busy === `rpppoe-${selected}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Network className="h-4 w-4" />}
                  Refrescar PPPoE
                </Button>
                <Button size="sm" variant="outline" className="gap-2" onClick={() => refreshParams(selected)} disabled={busy === `tr069-${selected}`}>
                  {busy === `tr069-${selected}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cpu className="h-4 w-4" />}
                  Leer parámetros TR-069
                </Button>
              </div>

              <Tabs defaultValue="general">
                <TabsList className="grid w-full grid-cols-3 h-11 rounded-xl bg-muted p-1">
                  <TabsTrigger value="general" className="rounded-lg data-[state=active]:shadow-sm data-[state=active]:text-primary">Estado y óptica</TabsTrigger>
                  <TabsTrigger value="wifi" className="rounded-lg data-[state=active]:shadow-sm data-[state=active]:text-primary">Wi-Fi dual band</TabsTrigger>
                  <TabsTrigger value="red" className="rounded-lg data-[state=active]:shadow-sm data-[state=active]:text-primary">Red / PPPoE</TabsTrigger>
                </TabsList>


                {/* TAB 1 */}
                <TabsContent value="general" className="space-y-4 pt-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <OpticalMeter rx={sel?.rxPower ?? null} tx={sel?.txPower ?? null} dimmed={selOffline} />
                    <div className="rounded-lg border divide-y">
                      {[
                        { label: "Uptime", value: formatUptime(selMeta?.uptime ?? null), icon: Clock },
                        { label: "Modelo", value: selMeta?.model || sel?.model || "—", icon: Antenna },
                        { label: "Firmware", value: selMeta?.softwareVersion || "—", icon: Cpu },
                        { label: "Último reporte", value: sinceLabel(sel?.lastInform), icon: Activity },
                      ].map((row) => (
                        <div key={row.label} className="flex items-center justify-between gap-3 px-4 py-3">
                          <span className="flex items-center gap-2 text-sm text-muted-foreground">
                            <row.icon className="h-4 w-4" /> {row.label}
                          </span>
                          <span className="text-sm font-medium truncate">{row.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border p-4 space-y-2">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">Alias del cliente</Label>
                    <div className="flex gap-2">
                      <Input
                        value={editingAlias === selected ? aliasDraft : (aliases[selected] || "")}
                        placeholder="Ej. Juan Pérez — Calle 5"
                        onChange={(e) => { setEditingAlias(selected); setAliasDraft(e.target.value); }}
                      />
                      <Button onClick={() => saveAlias(selected)} disabled={busy === `alias-${selected}`}>
                        {busy === `alias-${selected}` && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Guardar
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Si la ONU reporta usuario PPPoE, ese nombre tiene prioridad en los listados.
                    </p>
                  </div>
                </TabsContent>

                {/* TAB 2 */}
                <TabsContent value="wifi" className="pt-4">
                  <OnuRadiosPanel deviceId={selected} />
                </TabsContent>

                {/* TAB 3 */}
                <TabsContent value="red" className="space-y-4 pt-4">
                  {(pppoeCurrent[selected] || []).length > 0 ? (
                    <div className="rounded-lg border divide-y">
                      {(pppoeCurrent[selected] || []).map((c: any) => (
                        <div key={c.path} className="grid gap-2 p-4 sm:grid-cols-4 sm:items-center">
                          <div>
                            <p className="text-[11px] uppercase text-muted-foreground">Usuario</p>
                            <p className="font-mono text-sm">{c.username || "—"}</p>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase text-muted-foreground">Clave</p>
                            <p className="font-mono text-sm flex items-center gap-1">
                              {c.password ? (showPppoePass[selected] ? c.password : "••••••••") : "—"}
                              {c.password && (
                                <Button size="sm" variant="ghost" className="h-6 px-1"
                                  onClick={() => setShowPppoePass((s) => ({ ...s, [selected]: !s[selected] }))}>
                                  {showPppoePass[selected] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                                </Button>
                              )}
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase text-muted-foreground">Estado</p>
                            <Badge variant={c.status === "Connected" ? "secondary" : "outline"} className="text-[11px]">
                              {c.status || "—"}
                            </Badge>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase text-muted-foreground">IP</p>
                            <p className="font-mono text-sm">{c.ip || "—"}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                      Sin datos PPPoE leídos. Use “Refrescar PPPoE”. Muchas ONUs no reportan la contraseña por TR-069.
                    </p>
                  )}

                  <div className="rounded-lg border p-4 space-y-3">
                    <p className="text-sm font-medium flex items-center gap-2"><Network className="h-4 w-4" /> Aplicar credenciales PPPoE</p>
                    <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Usuario</Label>
                        <Input
                          value={selForm.username}
                          onChange={(e) => setPppoe((p) => ({ ...p, [selected]: { ...selForm, username: e.target.value } }))}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Contraseña</Label>
                        <div className="flex gap-1">
                          <Input
                            type={showPppoePass[selected] ? "text" : "password"}
                            value={selForm.password}
                            onChange={(e) => setPppoe((p) => ({ ...p, [selected]: { ...selForm, password: e.target.value } }))}
                          />
                          <Button variant="ghost" size="icon" onClick={() => setShowPppoePass((s) => ({ ...s, [selected]: !s[selected] }))}>
                            {showPppoePass[selected] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                        </div>
                      </div>
                      <Button onClick={() => savePppoe(selected)} disabled={busy === `pppoe-${selected}`}>
                        {busy === `pppoe-${selected}` && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Aplicar PPPoE
                      </Button>
                    </div>
                  </div>
                </TabsContent>
               </Tabs>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
