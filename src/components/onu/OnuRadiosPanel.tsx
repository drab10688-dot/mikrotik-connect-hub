import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { Loader2, RotateCcw, Wifi, Tv, Clock, Users, Eye, EyeOff } from "lucide-react";

interface Radio {
  path: string;
  index: string;
  band: "2.4g" | "5g" | "unknown";
  ssid: string | null;
  enabled: boolean | null;
  channel: number | string | null;
  bandwidth: string | null;
  standard: string | null;
  hidden: boolean | null;
  password: string | null;
  clients: number;
}

interface OnuStatus {
  manufacturer: string;
  model: string;
  serial: string;
  uptime: number | null;
  softwareVersion: string;
  lastInform: string | null;
  radios: Radio[];
  catv: { path: string | null; enabled: boolean | null };
}

function formatUptime(seconds: number | null): string {
  if (!seconds) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const bandLabel: Record<string, string> = {
  "2.4g": "WiFi 2.4 GHz",
  "5g": "WiFi 5 GHz",
  unknown: "WiFi",
};

export default function OnuRadiosPanel({ deviceId }: { deviceId: string }) {
  const [status, setStatus] = useState<OnuStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, { ssid: string; password: string; channel: string }>>({});
  const [showPass, setShowPass] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api(`/genieacs/devices/${encodeURIComponent(deviceId)}/onu-status`);
      const data: OnuStatus = res.data;
      setStatus(data);
      const next: Record<string, { ssid: string; password: string; channel: string }> = {};
      (data.radios || []).forEach((r) => {
        next[r.path] = {
          ssid: r.ssid || "",
          password: r.password || "",
          channel: r.channel !== null && r.channel !== undefined ? String(r.channel) : "",
        };
      });
      setForms(next);
    } catch (err: any) {
      toast.error("Error cargando ONU: " + err.message);
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => { load(); }, [load]);

  const saveRadio = async (radio: Radio) => {
    const form = forms[radio.path];
    if (!form) return;
    setBusy(radio.path);
    try {
      const res = await api(`/genieacs/devices/${encodeURIComponent(deviceId)}/wlan`, {
        method: "POST",
        body: {
          path: radio.path,
          ssid: form.ssid || undefined,
          password: form.password || undefined,
          channel: form.channel !== "" ? form.channel : undefined,
        },
      });
      toast.success(res.message || "Cambios enviados a la ONU");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const toggleRadio = async (radio: Radio, enable: boolean) => {
    setBusy(radio.path + "-toggle");
    try {
      await api(`/genieacs/devices/${encodeURIComponent(deviceId)}/wlan`, {
        method: "POST",
        body: { path: radio.path, enable },
      });
      toast.success(`${bandLabel[radio.band]} ${enable ? "activado" : "desactivado"}`);
      setStatus((s) =>
        s ? { ...s, radios: s.radios.map((r) => (r.path === radio.path ? { ...r, enabled: enable } : r)) } : s,
      );
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const toggleCatv = async (enable: boolean) => {
    setBusy("catv");
    try {
      const res = await api(`/genieacs/devices/${encodeURIComponent(deviceId)}/catv`, {
        method: "POST",
        body: { enable, path: status?.catv?.path || undefined },
      });
      toast.success(res.message);
      setStatus((s) => (s ? { ...s, catv: { ...s.catv, enabled: enable } } : s));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const refreshFromOnu = async () => {
    setBusy("refresh");
    try {
      const res = await api(`/genieacs/devices/${encodeURIComponent(deviceId)}/refresh-onu`, { method: "POST" });
      toast.success(res.message);
      setTimeout(load, 4000);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader className="p-3 pb-1">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-sm flex items-center gap-2">
            <Wifi className="w-4 h-4" /> Radios WiFi y servicios de la ONU
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              <Clock className="w-3 h-3 mr-1" /> {formatUptime(status?.uptime ?? null)}
            </Badge>
            <Button size="sm" variant="outline" onClick={refreshFromOnu} disabled={busy === "refresh"}>
              {busy === "refresh" ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RotateCcw className="w-3 h-3 mr-1" />}
              Leer de la ONU
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 space-y-3">
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : !status || status.radios.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No se detectaron radios WiFi. Pulse "Leer de la ONU" y espere el próximo Inform.
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {status.radios.map((radio) => {
              const form = forms[radio.path] || { ssid: "", password: "", channel: "" };
              return (
                <Card key={radio.path} className="bg-muted/30">
                  <CardHeader className="p-3 pb-1">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-xs flex items-center gap-2">
                        {bandLabel[radio.band]}
                        <Badge variant="secondary" className="text-[10px]">#{radio.index}</Badge>
                        {radio.clients > 0 && (
                          <span className="text-muted-foreground flex items-center gap-1 font-normal">
                            <Users className="w-3 h-3" /> {radio.clients}
                          </span>
                        )}
                      </CardTitle>
                      <Switch
                        checked={radio.enabled === true}
                        disabled={busy === radio.path + "-toggle"}
                        onCheckedChange={(v) => toggleRadio(radio, v)}
                      />
                    </div>
                  </CardHeader>
                  <CardContent className="p-3 pt-1 space-y-2">
                    <div className="space-y-1">
                      <Label className="text-xs">SSID</Label>
                      <Input
                        className="h-8 text-xs"
                        value={form.ssid}
                        onChange={(e) => setForms((f) => ({ ...f, [radio.path]: { ...form, ssid: e.target.value } }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Contraseña</Label>
                      <div className="flex gap-1">
                        <Input
                          className="h-8 text-xs"
                          type={showPass[radio.path] ? "text" : "password"}
                          value={form.password}
                          onChange={(e) => setForms((f) => ({ ...f, [radio.path]: { ...form, password: e.target.value } }))}
                        />
                        <Button
                          size="sm" variant="ghost" className="h-8 px-2"
                          onClick={() => setShowPass((s) => ({ ...s, [radio.path]: !s[radio.path] }))}
                        >
                          {showPass[radio.path] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        </Button>
                      </div>
                    </div>
                    <div className="flex gap-2 items-end">
                      <div className="space-y-1 w-24">
                        <Label className="text-xs">Canal</Label>
                        <Input
                          className="h-8 text-xs"
                          value={form.channel}
                          placeholder="auto"
                          onChange={(e) => setForms((f) => ({ ...f, [radio.path]: { ...form, channel: e.target.value } }))}
                        />
                      </div>
                      <Button
                        size="sm" className="h-8"
                        disabled={busy === radio.path}
                        onClick={() => saveRadio(radio)}
                      >
                        {busy === radio.path && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                        Guardar
                      </Button>
                    </div>
                    {radio.standard && (
                      <p className="text-[10px] text-muted-foreground">Estándar: {radio.standard}{radio.bandwidth ? ` · ${radio.bandwidth}` : ""}</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* CATV */}
        <div className="flex items-center justify-between border rounded-md p-3">
          <div className="flex items-center gap-2 text-sm">
            <Tv className="w-4 h-4 text-primary" />
            <span>CATV</span>
            {status?.catv?.path ? (
              <Badge variant="outline" className="text-[10px] font-mono">{status.catv.path.split(".").slice(-2).join(".")}</Badge>
            ) : (
              <span className="text-xs text-muted-foreground">no reportado por esta ONU</span>
            )}
          </div>
          <Switch
            checked={status?.catv?.enabled === true}
            disabled={busy === "catv"}
            onCheckedChange={toggleCatv}
          />
        </div>

        <p className="text-[11px] text-muted-foreground">
          Si la ONU está tras NAT, los cambios quedan en cola y se aplican en el próximo Inform periódico.
        </p>
      </CardContent>
    </Card>
  );
}
