import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import OnuRadiosPanel from "@/components/onu/OnuRadiosPanel";
import { Loader2, RotateCcw, Signal, Router, ChevronDown, ChevronUp, Network } from "lucide-react";

interface SignalEntry {
  deviceId: string;
  manufacturer: string;
  model: string;
  serial: string;
  rxPower: number | null;
  txPower: number | null;
  lastInform: string | null;
}

function signalColor(dbm: number | null) {
  if (dbm === null || dbm === undefined) return "text-muted-foreground";
  if (dbm > -20) return "text-green-500";
  if (dbm > -25) return "text-yellow-500";
  return "text-destructive";
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

  const loadSignals = useCallback(async () => {
    try {
      const res = await api("/genieacs/signal-overview");
      const list: SignalEntry[] = Array.isArray(res) ? res : (res?.data || []);
      const map: Record<string, SignalEntry> = {};
      list.forEach((e) => { map[e.deviceId] = e; });
      setSignals(map);
      return list;
    } catch {
      return [];
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const projection = [
        "_id", "_deviceId", "_lastInform",
        "InternetGatewayDevice.DeviceInfo.Manufacturer",
        "InternetGatewayDevice.DeviceInfo.ModelName",
        "InternetGatewayDevice.DeviceInfo.ProductClass",
        "InternetGatewayDevice.DeviceInfo.SerialNumber",
      ].join(",");
      const [healthRes, devRes] = await Promise.all([
        api("/genieacs/health").catch(() => ({ success: false })),
        api(`/genieacs/devices?projection=${encodeURIComponent(projection)}`).catch(() => ({ data: [] })),
      ]);
      setHealth(healthRes?.success ? "online" : "offline");
      let list: any[] = Array.isArray(devRes) ? devRes : (devRes?.data || []);
      const sig = await loadSignals();
      if (list.length === 0 && sig.length > 0) {
        list = sig.map((e) => ({ _id: e.deviceId, _deviceId: { _Manufacturer: e.manufacturer, _ProductClass: e.model, _SerialNumber: e.serial } }));
      }
      setDevices(list);
    } finally {
      setLoading(false);
    }
  }, [loadSignals]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = window.setInterval(load, 30000);
    return () => window.clearInterval(t);
  }, [load]);

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
          <Button variant="outline" onClick={load}><RotateCcw className="w-4 h-4 mr-2" /> Reintentar</Button>
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
          <span className="text-sm text-muted-foreground">{devices.length} ONU(s)</span>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
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
          const isOpen = expanded === d._id;
          const form = pppoe[d._id] || { username: "", password: "" };
          return (
            <Card key={d._id} className="overflow-hidden">
              <CardHeader className="p-3 pb-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle className="text-sm flex items-center gap-2 min-w-0">
                    <Router className="w-4 h-4 text-primary shrink-0" />
                    <span className="truncate">{info.manufacturer} {info.model}</span>
                    <span className="text-xs font-mono text-muted-foreground truncate">{info.serial}</span>
                  </CardTitle>
                  <div className="flex items-center gap-3">
                    <div className="text-xs">
                      <span className="text-muted-foreground mr-1">Rx</span>
                      <span className={`font-semibold ${signalColor(sig?.rxPower ?? null)}`}>
                        {sig?.rxPower != null ? `${sig.rxPower} dBm` : "—"}
                      </span>
                      <span className="text-muted-foreground mx-1">/ Tx</span>
                      <span className="font-semibold">{sig?.txPower != null ? `${sig.txPower} dBm` : "—"}</span>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => refreshSignal(d._id)} disabled={busy === `sig-${d._id}`}>
                      {busy === `sig-${d._id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Signal className="w-3 h-3" />}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setExpanded(isOpen ? null : d._id)}>
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
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Network className="w-4 h-4" /> PPPoE
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 pt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
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
                        <Input
                          className="h-8 text-xs"
                          value={form.password}
                          onChange={(e) => setPppoe((p) => ({ ...p, [d._id]: { ...form, password: e.target.value } }))}
                        />
                      </div>
                      <Button size="sm" onClick={() => savePppoe(d._id)} disabled={busy === `pppoe-${d._id}`}>
                        {busy === `pppoe-${d._id}` && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                        Aplicar PPPoE
                      </Button>
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
