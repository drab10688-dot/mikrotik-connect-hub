import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, MonitorCog, Stethoscope, Loader2, Monitor } from "lucide-react";
import { withAuthToken, netAccessApi } from "@/lib/api-client";
import { toast } from "sonner";
import { ProxyBrowserDialog, type ProxyBrowserTarget } from "@/components/network/ProxyBrowserDialog";

export interface AdvancedTarget {
  ip: string;
  name: string;
  proxy_path: string;
}

/** Sistema completo del equipo (WebFig / airOS / web de la ONU) embebido por el proxy del VPS. */
export function AdvancedWeb({
  target,
  devices,
  mikrotikId,
  onSelect,
}: {
  target: AdvancedTarget | null;
  devices: any[];
  mikrotikId?: string;
  onSelect: (t: AdvancedTarget) => void;
}) {
  const [manualIp, setManualIp] = useState("");
  const [manualPort, setManualPort] = useState("80");
  const [checking, setChecking] = useState(false);
  const [diag, setDiag] = useState<any>(null);
  const [remoteTarget, setRemoteTarget] = useState<ProxyBrowserTarget | null>(null);

  const routerId = mikrotikId || localStorage.getItem("mikrotik_device_id") || "";

  const nameFor = (ip: string) => devices.find((d) => d.ip === ip)?.name || ip;

  const open = (ip: string, port: number) => {
    if (!routerId || !ip) return;
    const selected = { ip, name: nameFor(ip), proxy_path: `/api/netaccess/${routerId}/web/${ip}/${port}/` };
    onSelect(selected);
    openRemote(ip, port, selected.name, selected.proxy_path);
  };

  const openManual = () => open(manualIp.trim(), Number(manualPort) || 80);

  const openRemote = (ip: string, port: number, name: string, proxyPath?: string) => {
    const protocol = port === 443 || port === 8443 ? "https" : "http";
    setRemoteTarget({
      title: `${name} — ${ip}:${port}`,
      directUrl: `${protocol}://${ip}:${port}/`,
      proxyUrl: proxyPath ? withAuthToken(proxyPath) : undefined,
    });
  };

  const runCheck = async () => {
    const ip = manualIp.trim();
    if (!routerId || !ip) return;
    setChecking(true);
    setDiag(null);
    try {
      const res = await netAccessApi.webCheck(routerId, ip, Number(manualPort) || 80);
      setDiag(res);
      if (res?.reachable && res.suggested_port && res.suggested_port !== Number(manualPort)) {
        setManualPort(String(res.suggested_port));
        toast.success(`El equipo responde en el puerto ${res.suggested_port}`);
      } else if (!res?.reachable) {
        toast.error("El equipo no responde por web desde el VPS");
      }
    } catch (e: any) {
      toast.error(e?.message || "No se pudo diagnosticar");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MonitorCog className="h-4 w-4" /> Sistema avanzado del equipo
          </CardTitle>
          <CardDescription>
            Abre la web completa (WebFig, airOS o la web de la ONU). Si no abre, usa <b>Probar acceso</b> para
            detectar el puerto correcto y ver el error exacto.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-5">
            <div className="space-y-1.5 md:col-span-2">
              <Label>Equipo detectado</Label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={devices.some((d) => d.ip === manualIp) ? manualIp : ""}
                onChange={(e) => setManualIp(e.target.value)}
              >
                <option value="">Selecciona un equipo…</option>
                {devices.map((d: any) => (
                  <option key={d.ip} value={d.ip}>
                    {d.name} — {d.ip} ({d.brand})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>IP</Label>
              <Input value={manualIp} onChange={(e) => setManualIp(e.target.value)} placeholder="10.82.3.60" />
            </div>
            <div className="space-y-1.5">
              <Label>Puerto web</Label>
              <Input value={manualPort} onChange={(e) => setManualPort(e.target.value)} />
            </div>
            <div className="flex items-end gap-2">
              <Button variant="outline" disabled={!manualIp || checking} onClick={runCheck}>
                {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stethoscope className="h-4 w-4" />}
              </Button>
              <Button className="flex-1" disabled={!manualIp} onClick={openManual}>
                Abrir
              </Button>
            </div>
          </div>

          {diag && (
            <div className="rounded-md border p-3 text-sm space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant={diag.reachable ? "default" : "destructive"}>
                  {diag.reachable ? "Responde" : "Sin respuesta"}
                </Badge>
                <span className="font-mono text-xs text-muted-foreground">{diag.ip}</span>
                {diag.needs_login && <Badge variant="secondary">Pide usuario/clave</Badge>}
              </div>
              <div className="grid gap-1 md:grid-cols-2">
                {(diag.results || []).map((r: any) => (
                  <div key={r.port} className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono">
                      {r.protocol}://{diag.ip}:{r.port}
                    </span>
                    <span className={r.ok ? "text-emerald-500" : "text-muted-foreground"}>
                      {r.ok ? `HTTP ${r.status} · ${r.ms}ms` : r.error}
                    </span>
                  </div>
                ))}
              </div>
              {diag.reachable && (
                <Button size="sm" onClick={() => open(diag.ip, diag.suggested_port)}>
                  Abrir en el puerto {diag.suggested_port}
                </Button>
              )}
              {!diag.reachable && (
                <p className="text-xs text-muted-foreground">
                  Ninguno de los puertos respondió. Revisa que la ONU tenga habilitada la administración desde el
                  puerto WAN y que el MikroTik permita el tráfico por la VPN.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {target && (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">
              {target.name} <span className="font-mono text-xs text-muted-foreground">{target.ip}</span>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" asChild>
                <a href={withAuthToken(target.proxy_path)} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4 mr-1" /> Nueva pestaña
                </a>
              </Button>
              <Button
                size="sm"
                variant="default"
                onClick={() => openRemote(target.ip, Number(target.proxy_path.match(/\/(\d+)\/$/)?.[1]) || 80, target.name, target.proxy_path)}
              >
                <Monitor className="h-4 w-4 mr-1" /> Abrir visor
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">El visor mantiene la sesión, cookies y captcha separados para este equipo.</p>
          </CardContent>

        </Card>
      )}
      <ProxyBrowserDialog target={remoteTarget} onOpenChange={(open) => !open && setRemoteTarget(null)} />
    </div>
  );
}
