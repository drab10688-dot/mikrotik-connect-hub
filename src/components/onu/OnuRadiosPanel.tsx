import { useCallback, useEffect, useRef, useState } from "react";
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
  const [showDisabled, setShowDisabled] = useState(false);
  const [applying, setApplying] = useState<{ path: string; label: string } | null>(null);
  const dirtyRef = useRef<Set<string>>(new Set());
  const pollRef = useRef<number | null>(null);

  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async (): Promise<OnuStatus> => {
    const res = await api(`/genieacs/devices/${encodeURIComponent(deviceId)}/onu-status`);
    const data: OnuStatus = res?.data ?? res;
    if (!data || typeof data !== "object") throw new Error("El ACS no devolvió información de esta ONU");
    return { ...data, radios: Array.isArray(data.radios) ? data.radios : [], catv: data.catv || { path: null, enabled: null } };
  }, [deviceId]);

  const applyStatus = useCallback((data: OnuStatus) => {
    setStatus(data);
    setForms((prev) => {
      const next = { ...prev };
      data.radios.forEach((r) => {
        // No sobrescribir lo que el usuario está editando
        if (dirtyRef.current.has(r.path) && next[r.path]) return;
        next[r.path] = {
          ssid: r.ssid || "",
          password: r.password || "",
          channel: r.channel !== null && r.channel !== undefined ? String(r.channel) : "",
        };
      });
      return next;
    });
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      applyStatus(await fetchStatus());
    } catch (err: any) {
      if (!silent) setError(err.message || "Error cargando la ONU");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [fetchStatus, applyStatus]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { if (pollRef.current) window.clearInterval(pollRef.current); }, []);

  /** Espera hasta que la ONU confirme el cambio (o venza el tiempo). */
  const waitUntilApplied = useCallback(
    (path: string, label: string, matches: (r: Radio) => boolean) => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      setApplying({ path, label });
      const started = Date.now();
      pollRef.current = window.setInterval(async () => {
        try {
          const data = await fetchStatus();
          applyStatus(data);
          const radio = data.radios.find((r) => r.path === path);
          if (radio && matches(radio)) {
            window.clearInterval(pollRef.current!);
            pollRef.current = null;
            dirtyRef.current.delete(path);
            setApplying(null);
            toast.success(`${label}: cambio confirmado por la ONU`);
            return;
          }
        } catch { /* reintenta */ }
        if (Date.now() - started > 180000) {
          window.clearInterval(pollRef.current!);
          pollRef.current = null;
          setApplying(null);
          toast.warning(`${label}: la ONU aún no confirma el cambio. Quedará aplicado en su próximo reporte.`);
        }
      }, 4000);
    },
    [fetchStatus, applyStatus],
  );

  const passwordError = (pw: string) => {
    if (!pw) return null;
    if (pw.length < 8 || pw.length > 63) return "Debe tener entre 8 y 63 caracteres (WPA2)";
    if (!/^[\x20-\x7E]+$/.test(pw)) return "Sin tildes, ñ ni emojis (solo ASCII)";
    return null;
  };


  const saveRadio = async (radio: Radio) => {
    const form = forms[radio.path];
    if (!form) return;
    const pwErr = passwordError(form.password);
    if (pwErr) { toast.error(`Contraseña WiFi inválida: ${pwErr}`); return; }
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
      toast.success(res.message || "Cambios enviados a la ONU", {
        description: "Esperando confirmación de la ONU…",
      });
      waitUntilApplied(radio.path, bandLabel[radio.band], (r) => {
        const ssidOk = !form.ssid || (r.ssid || "") === form.ssid;
        const chOk = form.channel === "" || String(r.channel ?? "") === form.channel;
        const pwOk = !form.password || !r.password || r.password === form.password;
        return ssidOk && chOk && pwOk;
      });
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
      toast.success(`${bandLabel[radio.band]} ${enable ? "activando" : "desactivando"}…`);
      setStatus((s) =>
        s ? { ...s, radios: s.radios.map((r) => (r.path === radio.path ? { ...r, enabled: enable } : r)) } : s,
      );
      waitUntilApplied(radio.path, bandLabel[radio.band], (r) => r.enabled === enable);
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
      window.setTimeout(() => load(true), 5000);
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
      window.setTimeout(() => load(true), 3000);
      window.setTimeout(() => load(true), 8000);
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
        ) : error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2">
            <p className="text-xs text-destructive">{error}</p>
            <Button size="sm" variant="outline" onClick={() => load()}>
              <RotateCcw className="w-3 h-3 mr-1" /> Reintentar
            </Button>
          </div>
        ) : !status || status.radios.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              No se detectaron radios WiFi en el árbol TR-069 de esta ONU.
              Pulse "Leer de la ONU" y espere unos segundos (o el próximo Inform periódico).
            </p>
            <Button size="sm" variant="outline" onClick={refreshFromOnu} disabled={busy === "refresh"}>
              {busy === "refresh" ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RotateCcw className="w-3 h-3 mr-1" />}
              Leer de la ONU ahora
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
          {(() => {
            const activeRadios = status.radios.filter((r) => r.enabled === true);
            const disabledRadios = status.radios.filter((r) => r.enabled !== true);
            const visible = showDisabled ? status.radios : (activeRadios.length > 0 ? activeRadios : status.radios);
            return (
          <>
          {disabledRadios.length > 0 && activeRadios.length > 0 && (
            <div className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2">
              <span className="text-xs text-muted-foreground">
                {activeRadios.length} radio(s) activa(s) · {disabledRadios.length} desactivada(s)
              </span>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowDisabled((v) => !v)}>
                {showDisabled ? "Ocultar desactivadas" : "Mostrar desactivadas"}
              </Button>
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {visible.map((radio) => {
              const form = forms[radio.path] || { ssid: "", password: "", channel: "" };
              return (
                <Card key={radio.path} className="bg-muted/30 overflow-hidden">
                  <CardHeader className={`p-3 pb-2 ${radio.band === "5g" ? "bg-gradient-to-r from-chart-4/15 to-transparent" : "bg-gradient-to-r from-primary/10 to-transparent"}`}>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-xs flex items-center gap-2">
                        <Wifi className={`w-4 h-4 ${radio.band === "5g" ? "text-chart-4" : "text-primary"}`} />
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
                  <CardContent className="p-3 pt-2 space-y-2">
                    <div className="rounded-md border bg-background/60 p-2 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Nombre WiFi</span>
                        <span className="text-xs font-semibold truncate">{radio.ssid || "—"}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Contraseña</span>
                        <span className="text-xs font-mono truncate flex items-center gap-1">
                          {radio.password && (
                            <Button
                              size="sm" variant="ghost" className="h-5 px-1"
                              onClick={() => setShowPass((s) => ({ ...s, [radio.path]: !s[radio.path] }))}
                            >
                              {showPass[radio.path] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                            </Button>
                          )}
                          {radio.password
                            ? (showPass[radio.path] ? radio.password : "••••••••")
                            : "no reportada"}
                        </span>
                      </div>
                    </div>

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
                          aria-invalid={!!passwordError(form.password)}
                        />
                        <Button
                          size="sm" variant="ghost" className="h-8 px-2"
                          onClick={() => setShowPass((s) => ({ ...s, [radio.path]: !s[radio.path] }))}
                        >
                          {showPass[radio.path] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        </Button>
                      </div>
                      {passwordError(form.password) && (
                        <p className="text-[11px] text-destructive">{passwordError(form.password)}</p>
                      )}
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
          </>
            );
          })()}
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
          Por VPN, las órdenes se envían de inmediato mediante Connection Request. Si la ONU está desconectada, quedan pendientes hasta su próximo Inform.
        </p>
      </CardContent>
    </Card>
  );
}
