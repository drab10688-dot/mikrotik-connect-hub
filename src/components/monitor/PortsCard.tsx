import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { monitorApi } from "@/lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Cable, CheckCircle2 } from "lucide-react";

const PROBLEM: Record<string, { label: string; className: string }> = {
  slow: { label: "Gigabit a 100", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30" },
  half: { label: "Half-duplex", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30" },
  saturated: { label: "Topado", className: "bg-destructive/15 text-destructive border-destructive/30" },
};

const mbps = (bps: number | null) => (bps == null ? "—" : `${(bps / 1e6).toFixed(bps >= 1e7 ? 0 : 1)}`);

/**
 * Puertos Ethernet de los routers de cada sede y de sus APs guardados (se
 * revisan cada 5 min): Gigabit enlazado a 100 Mbps, half-duplex o topado.
 */
export function PortsCard() {
  const { data: ports = [], isLoading } = useQuery({
    queryKey: ["monitor-ports"],
    queryFn: () => monitorApi.ports(),
    refetchInterval: 60_000,
  });
  const problems = ports.filter((p: any) => p.problem);
  const [onlyProblems, setOnlyProblems] = useState(true);
  const list = onlyProblems ? problems : ports;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-lg flex items-center gap-2"><Cable className="h-5 w-5 text-primary" /> Puertos de routers y APs</CardTitle>
          <CardDescription>
            Cada 5 min se revisan los puertos con enlace de cada MikroTik de sede y de los APs guardados en el mapa
            (MikroTik por API, Ubiquiti por SSH). Avisa por Telegram si un problema sigue 10 min.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="only-problems" checked={onlyProblems} onCheckedChange={setOnlyProblems} />
          <Label htmlFor="only-problems" className="text-sm">Solo con problemas ({problems.length})</Label>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : !ports.length ? (
          <p className="text-sm text-muted-foreground">Aún no hay lecturas (la primera revisión corre en menos de 5 min).</p>
        ) : !list.length ? (
          <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" /> Todos los puertos revisados ({ports.length}) están bien.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3">Sede</th>
                  <th className="py-2 pr-3">Equipo</th>
                  <th className="py-2 pr-3">Puerto</th>
                  <th className="py-2 pr-3 text-right">Velocidad</th>
                  <th className="py-2 pr-3 text-right">Uso ↓ / ↑ (Mbps)</th>
                  <th className="py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p: any) => {
                  const pr = p.problem ? PROBLEM[p.problem] : null;
                  return (
                    <tr key={`${p.ip}-${p.port}`} className="border-b last:border-0 align-top">
                      <td className="py-2 pr-3">{p.sede}</td>
                      <td className="py-2 pr-3">
                        {p.device}
                        <span className="block font-mono text-[11px] text-muted-foreground">{p.kind === "ap" ? "AP · " : "Router · "}{p.ip}</span>
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">{p.port}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {p.rate_mbps ? (p.rate_mbps >= 1000 ? `${p.rate_mbps / 1000} Gbps` : `${p.rate_mbps} Mbps`) : "—"}
                        {p.full === false && <span className="block text-[11px]">half</span>}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{mbps(p.rx_bps)} / {mbps(p.tx_bps)}</td>
                      <td className="py-2">
                        {pr ? (
                          <>
                            <Badge variant="outline" className={`gap-1 ${pr.className}`}><AlertTriangle className="h-3 w-3" /> {pr.label}</Badge>
                            <p className="mt-1 max-w-md text-xs text-muted-foreground">{p.detail}</p>
                          </>
                        ) : (
                          <Badge variant="outline" className="gap-1 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                            <CheckCircle2 className="h-3 w-3" /> Bien
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
