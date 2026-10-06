import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { systemResourcesApi } from "@/lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, AlertTriangle, ChevronDown, ChevronUp, Cpu, HardDrive, MemoryStick, Network, RefreshCw } from "lucide-react";

/** Bytes legibles (base 1024, como free/df). */
function fmtBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

/** Velocidad en bits por segundo. */
function fmtBps(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const u = ["bps", "Kbps", "Mbps", "Gbps"];
  let i = 0;
  let v = n;
  while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return d ? `${d} d ${h} h` : `${h} h ${Math.floor((s % 3600) / 60)} min`;
}

/** Estado por porcentaje: siempre con texto, nunca solo color. */
function level(pct: number | null) {
  if (pct == null) return { label: "", bar: "bg-muted-foreground/40", text: "" };
  if (pct >= 90) return { label: "Crítico", bar: "bg-destructive", text: "text-destructive" };
  if (pct >= 75) return { label: "Alto", bar: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" };
  return { label: "", bar: "bg-primary", text: "" };
}

function Meter({ icon: Icon, title, pct, detail }: { icon: any; title: string; pct: number | null; detail: string }) {
  const l = level(pct);
  return (
    <div className="rounded-xl border p-4 space-y-2" title={`${title}: ${pct == null ? "sin dato" : `${pct}%`} · ${detail}`}>
      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5"><Icon className="w-4 h-4" /> {title}</span>
        {l.label && (
          <span className={`flex items-center gap-1 text-xs font-medium ${l.text}`}>
            <AlertTriangle className="w-3 h-3" /> {l.label}
          </span>
        )}
      </div>
      <div className="text-2xl font-semibold tabular-nums">{pct == null ? "—" : `${pct}%`}</div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} aria-label={title}>
        <div className={`h-full rounded-full ${l.bar}`} style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }} />
      </div>
      <div className="text-xs text-muted-foreground tabular-nums">{detail}</div>
    </div>
  );
}

const pctOf = (used: number, total: number) => (total > 0 ? Math.round((used / total) * 1000) / 10 : null);

export function ServerResourcesCard() {
  const [showContainers, setShowContainers] = useState(false);
  const { data, isFetching, refetch, error } = useQuery({
    queryKey: ["server-resources"],
    queryFn: () => systemResourcesApi.get(),
    refetchInterval: 15_000,
    refetchOnWindowFocus: false,
  });

  const h = data?.host;
  const tenants: any[] = data?.tenants || [];
  const containers: any[] = data?.containers || [];
  const tenantName = new Map<string, string>(tenants.map((t) => [t.id, t.name]));
  const totalMem = h?.memory?.total || 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-lg flex items-center gap-2"><Activity className="w-5 h-5 text-primary" /> Recursos del servidor</CardTitle>
          <CardDescription>
            Consumo general del VPS y por ISP. Se actualiza cada 15 s
            {h?.uptime_s ? ` · encendido hace ${fmtUptime(h.uptime_s)}` : ""}
            {h?.load ? ` · carga ${h.load.map((n: number) => n.toFixed(2)).join(" / ")}${h.cores ? ` (${h.cores} núcleos)` : ""}` : ""}.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Actualizar
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && <p className="text-sm text-destructive">No se pudieron leer los recursos: {(error as any)?.message}</p>}
        {!data && !error && <p className="text-sm text-muted-foreground">Leyendo el servidor…</p>}

        {h && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Meter icon={Cpu} title="CPU" pct={h.cpu_percent} detail={h.cores ? `${h.cores} núcleos` : "—"} />
            <Meter
              icon={MemoryStick}
              title="Memoria"
              pct={pctOf(h.memory.used, h.memory.total)}
              detail={`${fmtBytes(h.memory.used)} de ${fmtBytes(h.memory.total)}${h.memory.swap_used ? ` · swap ${fmtBytes(h.memory.swap_used)}` : ""}`}
            />
            <Meter icon={HardDrive} title="Disco" pct={pctOf(h.disk.used, h.disk.total)} detail={`${fmtBytes(h.disk.used)} de ${fmtBytes(h.disk.total)}`} />
            <div className="rounded-xl border p-4 space-y-2">
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground"><Network className="w-4 h-4" /> Red {h.network?.iface ? `(${h.network.iface})` : ""}</div>
              <div className="text-sm tabular-nums space-y-0.5">
                <div><span className="text-muted-foreground">Bajada </span><span className="text-lg font-semibold">{fmtBps(h.network?.rx_bps)}</span></div>
                <div><span className="text-muted-foreground">Subida </span><span className="text-lg font-semibold">{fmtBps(h.network?.tx_bps)}</span></div>
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                Total: ↓ {fmtBytes(h.network?.rx_bytes)} · ↑ {fmtBytes(h.network?.tx_bytes)}
              </div>
            </div>
          </div>
        )}

        {tenants.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Por ISP</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 pr-3">ISP</th>
                    <th className="py-2 pr-3 text-right">ONUs</th>
                    <th className="py-2 pr-3 text-right">Routers</th>
                    <th className="py-2 pr-3 text-right">Antenas</th>
                    <th className="py-2 pr-3 text-right">VPN</th>
                    <th className="py-2 pr-3 text-right">Tráfico VPN ahora</th>
                    <th className="py-2 pr-3 text-right">Tráfico VPN total</th>
                    <th className="py-2 pr-3 text-right">Escritorios</th>
                    <th className="py-2 text-right">Usuarios</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((t) => {
                    const limitPct = t.onu_limit ? Math.round((t.onus / t.onu_limit) * 100) : null;
                    return (
                      <tr key={t.id} className="border-b last:border-0 align-top">
                        <td className="py-2 pr-3">
                          <div className="font-medium">{t.name}</div>
                          {!t.is_active && <Badge variant="outline" className="mt-0.5 text-[10px]">Inactivo</Badge>}
                          {t.tunnels?.length > 0 && (
                            <div className="text-[11px] text-muted-foreground">
                              {t.tunnels.map((x: any) => (
                                <span key={x.tunnel_ip || x.name} className="mr-2 whitespace-nowrap" title={x.link ? `${x.link.iface} · ↓ ${fmtBps(x.link.rx_bps)} ↑ ${fmtBps(x.link.tx_bps)}` : "Desconectada"}>
                                  {x.link ? "●" : "○"} {x.name}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {t.onus}{t.onu_limit ? <span className="text-muted-foreground"> / {t.onu_limit}</span> : ""}
                          {limitPct != null && limitPct >= 90 && <div className="text-[11px] text-amber-600 dark:text-amber-400">Cupo al {limitPct}%</div>}
                          {t.onus_blocked > 0 && <div className="text-[11px] text-destructive">{t.onus_blocked} bloqueadas</div>}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{t.routers}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{t.cpes}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {t.vpn_connected} / {t.vpn_total}
                          <div className="text-[11px] text-muted-foreground">conectadas</div>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                          ↓ {fmtBps(t.traffic.rx_bps)}<br />↑ {fmtBps(t.traffic.tx_bps)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                          ↓ {fmtBytes(t.traffic.rx_bytes)}<br />↑ {fmtBytes(t.traffic.tx_bytes)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {t.desktops.count}
                          {t.desktops.count > 0 && (
                            <div className="text-[11px] text-muted-foreground whitespace-nowrap">{t.desktops.cpu}% CPU · {fmtBytes(t.desktops.mem)}</div>
                          )}
                        </td>
                        <td className="py-2 text-right tabular-nums">{t.users}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground">
              "Tráfico VPN ahora" es la velocidad desde la lectura anterior (vista desde el VPS: ↓ lo que llega de los routers, ↑ lo que se les envía).
              El total se reinicia cuando el túnel se reconecta.
            </p>
          </div>
        )}

        {containers.length > 0 && (
          <div className="space-y-2">
            <button type="button" className="flex items-center gap-1 text-sm font-semibold" onClick={() => setShowContainers((v) => !v)}>
              {showContainers ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              Servicios ({containers.length} contenedores)
            </button>
            {showContainers && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-2 pr-3">Contenedor</th>
                      <th className="py-2 pr-3 text-right">CPU</th>
                      <th className="py-2 pr-3 text-right">Memoria</th>
                      <th className="py-2 text-right">Red (desde que arrancó)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {containers.map((c) => (
                      <tr key={c.name} className="border-b last:border-0">
                        <td className="py-1.5 pr-3 font-mono text-xs">
                          {c.name}
                          {c.tenant_id !== undefined && (
                            <span className="ml-2 font-sans text-muted-foreground">
                              escritorio · {c.tenant_id ? tenantName.get(c.tenant_id) || "ISP" : "super admin"}
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{c.cpu.toFixed(1)}%</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">
                          {fmtBytes(c.mem)}
                          {totalMem > 0 && <span className="text-muted-foreground"> ({c.mem_percent.toFixed(1)}%)</span>}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-xs">↓ {fmtBytes(c.net_rx)} · ↑ {fmtBytes(c.net_tx)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
