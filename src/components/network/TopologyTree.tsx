import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { netAccessApi } from "@/lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Router, Radio, User, ChevronDown, ChevronRight, RefreshCw, MonitorCog } from "lucide-react";

/** Barra gráfica de señal (dBm) con color por calidad. */
function SignalBar({ signal, snr, quality }: { signal: number | null; snr: number | null; quality?: string }) {
  const pct = signal === null ? 0 : Math.max(0, Math.min(100, ((signal + 95) / 55) * 100));
  const tone =
    quality === "excelente" ? "bg-primary" :
    quality === "buena" ? "bg-primary/70" :
    quality === "regular" ? "bg-amber-500" :
    quality === "mala" ? "bg-destructive" : "bg-muted-foreground/40";

  return (
    <div className="flex items-center gap-2 min-w-[190px]">
      <div className="h-2 w-28 rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${tone} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono tabular-nums w-16">
        {signal !== null ? `${signal} dBm` : "s/d"}
      </span>
      {snr !== null && <span className="text-xs text-muted-foreground">SNR {snr}</span>}
    </div>
  );
}

interface Props {
  mikrotikId: string;
  onManage: (ip: string) => void;
  onAdvanced: (device: { ip: string; name: string; proxy_path: string }) => void;
}

export function TopologyTree({ mikrotikId, onManage, onAdvanced }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [sectorEdit, setSectorEdit] = useState<Record<string, string>>({});

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["topology", mikrotikId],
    queryFn: () => netAccessApi.topology(mikrotikId),
    enabled: !!mikrotikId,
    refetchInterval: 60000,
  });

  const saveSector = useMutation({
    mutationFn: (ap: any) =>
      netAccessApi.saveApCredentials({ ip: ap.ip, name: ap.name, brand: ap.brand, sector: sectorEdit[ap.ip] || null }),
    onSuccess: () => {
      toast.success("Sector actualizado");
      qc.invalidateQueries({ queryKey: ["topology", mikrotikId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const tree = data?.tree;
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  if (!mikrotikId) {
    return (
      <Card><CardContent className="py-6 text-sm text-muted-foreground">
        Selecciona un MikroTik en Ajustes para ver el árbol de la red.
      </CardContent></Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Router className="h-4 w-4" /> Árbol de red por sectores
          </CardTitle>
          <CardDescription>
            MikroTik → sector → AP/antena → cliente, con la señal de cada cliente en gráfico.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Actualizar
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {data?.totals && (
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary">{data.totals.sectors} sectores</Badge>
            <Badge variant="secondary">{data.totals.aps} APs</Badge>
            <Badge variant="secondary">{data.totals.clients_with_signal} clientes con señal</Badge>
            <Badge variant="outline">{data.totals.direct_clients} directos al router</Badge>
          </div>
        )}

        {tree && (
          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center gap-2 font-medium">
              <Router className="h-4 w-4 text-primary" />
              {tree.name} <span className="text-xs font-mono text-muted-foreground">{tree.host}</span>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => onAdvanced({ ip: tree.host, name: tree.name, proxy_path: tree.proxy_path })}
              >
                <MonitorCog className="h-4 w-4 mr-1" /> WebFig
              </Button>
            </div>

            {(tree.sectors || []).map((sector: any) => (
              <div key={sector.name} className="ml-4 border-l pl-4 space-y-2">
                <button
                  className="flex items-center gap-2 text-sm font-medium"
                  onClick={() => toggle(`s:${sector.name}`)}
                >
                  {open[`s:${sector.name}`] === false ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  {sector.name}
                  <Badge variant="outline" className="text-[10px]">{sector.aps.length} AP</Badge>
                </button>

                {open[`s:${sector.name}`] !== false && sector.aps.map((ap: any) => (
                  <div key={ap.id} className="ml-4 border-l pl-4 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Radio className={`h-4 w-4 ${ap.online ? "text-primary" : "text-destructive"}`} />
                      <span className="font-medium">{ap.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{ap.ip}</span>
                      <Badge variant="secondary" className="text-[10px]">{ap.brand}</Badge>
                      <Badge variant="outline" className="text-[10px]">{ap.total_clients} clientes</Badge>
                      {ap.error && <span className="text-xs text-destructive">{ap.error}</span>}
                      <div className="ml-auto flex items-center gap-1">
                        <Input
                          className="h-7 w-32 text-xs"
                          placeholder="Sector"
                          value={sectorEdit[ap.ip] ?? (sector.name === "Sin sector" ? "" : sector.name)}
                          onChange={(e) => setSectorEdit({ ...sectorEdit, [ap.ip]: e.target.value })}
                        />
                        <Button size="sm" variant="ghost" onClick={() => saveSector.mutate(ap)}>Guardar</Button>
                        <Button size="sm" variant="ghost" onClick={() => onManage(ap.ip)}>Mini-panel</Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onAdvanced({ ip: ap.ip, name: ap.name, proxy_path: ap.proxy_path })}
                        >
                          Avanzado
                        </Button>
                      </div>
                    </div>

                    {(ap.clients || []).map((c: any) => (
                      <div key={`${ap.id}-${c.mac}`} className="ml-4 border-l pl-4 flex flex-wrap items-center gap-3 py-1">
                        <User className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm">{c.name}</span>
                        <span className="font-mono text-[11px] text-muted-foreground">{c.ip || c.mac}</span>
                        <SignalBar signal={c.signal} snr={c.snr} quality={c.quality} />
                        {c.ccq !== null && c.ccq !== undefined && (
                          <span className="text-xs text-muted-foreground">CCQ {c.ccq}%</span>
                        )}
                        <span className="text-xs text-muted-foreground">{c.tx_rate || ""}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}

            {!!(tree.direct_clients || []).length && (
              <div className="ml-4 border-l pl-4">
                <button className="flex items-center gap-2 text-sm font-medium" onClick={() => toggle("direct")}>
                  {open.direct ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  Clientes directos del router
                  <Badge variant="outline" className="text-[10px]">{tree.direct_clients.length}</Badge>
                </button>
                {open.direct && tree.direct_clients.map((c: any) => (
                  <div key={c.name} className="ml-4 border-l pl-4 flex items-center gap-3 py-1">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm">{c.name}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{c.ip || "—"}</span>
                    {c.online ? <Badge className="text-[10px]">En línea</Badge> : <Badge variant="outline" className="text-[10px]">Fuera</Badge>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
