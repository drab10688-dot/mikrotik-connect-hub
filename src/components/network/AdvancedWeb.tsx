import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ExternalLink, MonitorCog } from "lucide-react";
import { withAuthToken } from "@/lib/api-client";

export interface AdvancedTarget {
  ip: string;
  name: string;
  proxy_path: string;
}

/** Sistema completo del equipo (WebFig / airOS / web de la ONU) embebido por el proxy del VPS. */
export function AdvancedWeb({
  target,
  devices,
  onSelect,
}: {
  target: AdvancedTarget | null;
  devices: any[];
  onSelect: (t: AdvancedTarget) => void;
}) {
  const [manualIp, setManualIp] = useState("");
  const [manualPort, setManualPort] = useState("80");

  const openManual = () => {
    const device = devices.find((d) => d.ip === manualIp);
    const base = device?.proxy_path?.replace(/\/\d+\/$/, `/${manualPort}/`);
    if (base) return onSelect({ ip: manualIp, name: device.name || manualIp, proxy_path: base });
    if (device) onSelect({ ip: manualIp, name: device.name || manualIp, proxy_path: device.proxy_path });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MonitorCog className="h-4 w-4" /> Sistema avanzado del equipo
          </CardTitle>
          <CardDescription>
            Abre la web completa (WebFig, airOS o la web de la ONU) por la VPN cuando necesites algo que el mini-panel no cubre.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1.5 md:col-span-2">
              <Label>Equipo</Label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={manualIp}
                onChange={(e) => setManualIp(e.target.value)}
              >
                <option value="">Selecciona un equipo detectado…</option>
                {devices.map((d: any) => (
                  <option key={d.ip} value={d.ip}>
                    {d.name} — {d.ip} ({d.brand})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Puerto web</Label>
              <Input value={manualPort} onChange={(e) => setManualPort(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button className="w-full" disabled={!manualIp} onClick={openManual}>Abrir</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {target && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">
              {target.name} <span className="font-mono text-xs text-muted-foreground">{target.ip}</span>
            </CardTitle>
            <Button size="sm" variant="outline" asChild>
              <a href={withAuthToken(target.proxy_path)} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4 mr-1" /> Nueva pestaña
              </a>
            </Button>
          </CardHeader>
          <CardContent>
            <iframe
              key={target.proxy_path}
              src={withAuthToken(target.proxy_path)}
              title={`Sistema de ${target.name}`}
              className="w-full h-[70vh] rounded-md border bg-background"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
