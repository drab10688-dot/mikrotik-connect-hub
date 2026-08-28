import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import OnuRadiosPanel from "@/components/onu/OnuRadiosPanel";
import SignalGauge from "@/components/onu/SignalGauge";
import { Loader2, RotateCcw, Signal, Router, ChevronDown, ChevronUp, Network, Eye, EyeOff, Pencil, Check, X, Tag, Wifi } from "lucide-react";

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


function signalColor(dbm: number | null) {
  if (dbm === null || dbm === undefined) return "text-muted-foreground";
  if (dbm > -20) return "text-green-500";
  if (dbm > -25) return "text-yellow-500";
  return "text-destructive";
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

function deviceInfo(device: any) {
  const di = device?.InternetGatewayDevice?.DeviceInfo || device?.Device?.DeviceInfo || {};
  const meta = device?._deviceId || {};
  const parts = typeof device?._id === "string" ? device._id.split("-") : [];
  return {
    manufacturer: di?.Manufacturer?._value || meta?._Manufacturer || meta?._OUI || "ONU",
    model: di?.ModelName?._value || di?.ProductClass?._value || meta?._ProductClass || parts[1] || "-",
    serial: di?.SerialNumber?._value || meta?._SerialNumber || (parts.length >= 3 ? parts.slice(2).join("-") : "-"),
  };
}


export default function SimpleOnuPanel() {
  const [devices, setDevices] = useState<any[]>([]);
  const [signals, setSignals] = useState<Record<string, SignalEntry>>({});
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<"unknown" | "online" | "offline">("unknown");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pppoe, setPppoe] = useState<Record<string, { username: string; password: string }>>({});
  const [pppoeCurrent, setPppoeCurrent] = useState<Record<string, any[]>>({});
  const [showPppoePass, setShowPppoePass] = useState<Record<string, boolean>>({});
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [pppoeNames, setPppoeNames] = useState<Record<string, string>>({});
  const [editingAlias, setEditingAlias] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState("");
  const [, setTick] = useState(0);


  const loadAliases = useCallback(async () => {
    try {
      const res = await api("/genieacs/aliases");
      const map = res?.data ?? res;
      if (map && typeof map === "object") setAliases(map as Record<string, string>);
    } catch {
      /* opcional */
    }
  }, []);

  const saveAlias = async (deviceId: string) => {
    const name = aliasDraft.trim();
    setBusy(`alias-${deviceId}`);
    try {
      await api(`/genieacs/devices/${encodeURIComponent(deviceId)}/alias`, {
        method: "POST",
        body: { name },
      });
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


  const loadSignals = useCallback(async () => {
    try {
      const res = await api("/genieacs/signal-overview");
      const list: SignalEntry[] = Array.isArray(res) ? res : (res?.data || []);
      const map: Record<string, SignalEntry> = {};
      list.forEach((e) => { map[e.deviceId] = e; });
      setSignals((s) => ({ ...s, ...map }));
      return list;
    } catch {
      return [];
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
      setDevices(list.map((e: any) => ({
        _id: e.deviceId,
        _deviceId: { _Manufacturer: e.manufacturer, _ProductClass: e.model, _SerialNumber: e.serial },
      })));
    } catch {
      setHealth("offline");
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = window.setInterval(() => load(false), 30000);
    return () => window.clearInterval(t);
  }, [load]);
  // Refresca el cálculo de "en línea / desconectada" sin recargar datos
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 30000);
    return () => window.clearInterval(t);
  }, []);


  const refreshSignal = async (deviceId: string) => {
    setBusy(`sig-${deviceId}`);
    try {
      await api(`/genieacs/devices/${encodeURIComponent(deviceId)}/refresh-signal`, { method: "POST" });
      toast.success("Leyendo señal óptica, espere unos segundos...");
      setTimeout(loadSignals, 10000);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const toggleExpand = (deviceId: string) => {
    const open = expanded === deviceId;
    setExpanded(open ? null : deviceId);
    if (!open) loadPppoe(deviceId);
  };

  const refreshPppoe = async (deviceId: string) => {
    setBusy(`rpppoe-${deviceId}`);
    try {
      await api(`/genieacs/devices/${encodeURIComponent(deviceId)}/refresh-pppoe`, { method: "POST" });
      toast.success("Leyendo PPPoE de la ONU, espere unos segundos...");
      setTimeout(() => loadPppoe(deviceId), 8000);
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


  if (health === "offline" && !loading) {
    return (
      <Card>
        <CardContent className="p-8 text-center space-y-3">
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

  return (
    <div className="space-y-3 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={health === "online" ? "default" : "secondary"}>
            {health === "online" ? "ACS Online" : "Conectando..."}
          </Badge>
          <span className="text-sm text-muted-foreground">
            {devices.filter((d) => !isOffline(signals[d._id]?.lastInform)).length} en línea / {devices.length} ONU(s)
          </span>

        </div>
        <Button size="sm" variant="outline" onClick={() => load()} disabled={loading}>
          <RotateCcw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Actualizar
        </Button>
      </div>

      {devices.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {loading ? <Loader2 className="w-5 h-5 mx-auto animate-spin" /> : "Aún no hay ONUs conectadas al ACS."}
          </CardContent>
        </Card>
      ) : (
        devices.map((d) => {
          const info = deviceInfo(d);
          const sig = signals[d._id];
          const offline = isOffline(sig?.lastInform);

          const isOpen = expanded === d._id;
          const form = pppoe[d._id] || { username: "", password: "" };
          const pppoeName = (pppoeCurrent[d._id] || []).find((c) => c?.username)?.username || pppoeNames[d._id];
          const displayName = pppoeName || aliases[d._id] || `${info.manufacturer} ${info.model}`;
          return (
            <Card key={d._id} className="overflow-hidden">
              <CardHeader className="p-3 pb-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <CardTitle className="text-sm flex items-center gap-2 min-w-0">
                      <Router className="w-4 h-4 text-primary shrink-0" />
                      {editingAlias === d._id ? (
                        <span className="flex items-center gap-1">
                          <Input
                            autoFocus
                            className="h-7 text-xs w-48"
                            placeholder="Nombre del cliente"
                            value={aliasDraft}
                            onChange={(e) => setAliasDraft(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") saveAlias(d._id); if (e.key === "Escape") setEditingAlias(null); }}
                          />
                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => saveAlias(d._id)} disabled={busy === `alias-${d._id}`}>
                            {busy === `alias-${d._id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditingAlias(null)}>
                            <X className="w-3 h-3" />
                          </Button>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 min-w-0">
                          <span className="truncate">{displayName}</span>
                          {!pppoeName && (
                            <Button
                              size="sm" variant="ghost" className="h-6 px-1"
                              onClick={() => { setEditingAlias(d._id); setAliasDraft(aliases[d._id] || ""); }}
                            >
                              <Pencil className="w-3 h-3" />
                            </Button>
                          )}
                        </span>
                      )}
                    </CardTitle>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground min-w-0">

                      {(pppoeName || aliases[d._id]) && (
                        <span className="flex items-center gap-1 truncate">
                          <Tag className="w-3 h-3" />{info.manufacturer} {info.model}
                        </span>
                      )}
                      <span className="font-mono truncate">{info.serial}</span>
                      <Badge variant={offline ? "destructive" : "default"} className="text-[10px]">
                        {offline ? "Desconectada" : "En línea"}
                      </Badge>
                      <span>{sinceLabel(sig?.lastInform)}</span>
                    </div>
                    {(() => {
                      const radios = (sig?.radios || []).filter((r) => r.ssid);
                      const active = radios.filter((r) => r.enabled);
                      if (!radios.length) {
                        return (
                          <p className="text-[11px] text-muted-foreground">
                            WiFi sin datos — abra “Configurar” y pulse leer/actualizar.
                          </p>
                        );
                      }
                      return (
                        <div className="flex flex-wrap items-center gap-1">
                          {radios.map((r) => (
                            <Badge
                              key={r.index}
                              variant={r.enabled ? "default" : "secondary"}
                              className="text-[10px] font-normal"
                            >
                              <Wifi className="w-3 h-3 mr-1" />
                              {r.ssid} · {r.band}
                              {r.channel ? ` · ch ${r.channel}` : ""}
                              {r.enabled ? "" : " · apagada"}
                            </Badge>
                          ))}
                          {active.length === 0 && (
                            <span className="text-[11px] text-destructive">Ninguna radio activa</span>
                          )}
                        </div>
                      );
                    })()}

                  </div>
                  <div className="flex items-center gap-3">
                    <div className={offline ? "opacity-40 grayscale" : ""}>
                      <SignalGauge rx={sig?.rxPower ?? null} tx={sig?.txPower ?? null} />
                    </div>

                    <Button size="sm" variant="ghost" onClick={() => refreshSignal(d._id)} disabled={busy === `sig-${d._id}`}>
                      {busy === `sig-${d._id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Signal className="w-3 h-3" />}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => toggleExpand(d._id)}>
                      {isOpen ? <ChevronUp className="w-4 h-4 mr-1" /> : <ChevronDown className="w-4 h-4 mr-1" />}
                      Configurar
                    </Button>
                  </div>
                </div>
              </CardHeader>

              {isOpen && (
                <CardContent className="p-3 pt-0 space-y-3">
                  {/* WiFi dual banda + CATV */}
                  <OnuRadiosPanel deviceId={d._id} />

                  {/* PPPoE */}
                  <Card className="bg-muted/30">
                    <CardHeader className="p-3 pb-1">
                      <CardTitle className="text-sm flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2"><Network className="w-4 h-4" /> PPPoE</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => refreshPppoe(d._id)}
                          disabled={busy === `rpppoe-${d._id}`}
                        >
                          {busy === `rpppoe-${d._id}`
                            ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            : <RotateCcw className="w-3 h-3 mr-1" />}
                          Leer de la ONU
                        </Button>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 pt-2 space-y-3">
                      {(pppoeCurrent[d._id] || []).length > 0 ? (
                        <div className="rounded-md border bg-background/60 p-2 space-y-1 text-xs">
                          {(pppoeCurrent[d._id] || []).map((c) => (
                            <div key={c.path} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                              <span>
                                <span className="text-muted-foreground mr-1">Usuario:</span>
                                <span className="font-mono">{c.username || "—"}</span>
                              </span>
                              <span className="flex items-center gap-1">
                                <span className="text-muted-foreground">Clave:</span>
                                <span className="font-mono">
                                  {c.password ? (showPppoePass[d._id] ? c.password : "••••••••") : "—"}
                                </span>
                                {c.password && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-5 px-1 text-[10px]"
                                    onClick={() => setShowPppoePass((s) => ({ ...s, [d._id]: !s[d._id] }))}
                                  >
                                    {showPppoePass[d._id] ? "ocultar" : "ver"}
                                  </Button>
                                )}
                              </span>
                              <Badge variant={c.status === "Connected" ? "default" : "secondary"} className="text-[10px]">
                                {c.status || "—"}
                              </Badge>
                              {c.ip && <span className="font-mono text-muted-foreground">{c.ip}</span>}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Sin datos PPPoE leídos. Use “Leer de la ONU”. Muchas ONUs no reportan la contraseña PPPoE por TR-069.
                        </p>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                        <div className="space-y-1">
                          <Label className="text-xs">Usuario</Label>
                          <Input
                            className="h-8 text-xs"
                            value={form.username}
                            onChange={(e) => setPppoe((p) => ({ ...p, [d._id]: { ...form, username: e.target.value } }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Contraseña</Label>
                          <div className="flex gap-1">
                            <Input
                              className="h-8 text-xs"
                              type={showPppoePass[d._id] ? "text" : "password"}
                              value={form.password}
                              onChange={(e) => setPppoe((p) => ({ ...p, [d._id]: { ...form, password: e.target.value } }))}
                            />
                            <Button
                              size="sm" variant="ghost" className="h-8 px-2"
                              onClick={() => setShowPppoePass((s) => ({ ...s, [d._id]: !s[d._id] }))}
                            >
                              {showPppoePass[d._id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                            </Button>
                          </div>
                        </div>
                        <Button size="sm" onClick={() => savePppoe(d._id)} disabled={busy === `pppoe-${d._id}`}>
                          {busy === `pppoe-${d._id}` && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                          Aplicar PPPoE
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </CardContent>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
