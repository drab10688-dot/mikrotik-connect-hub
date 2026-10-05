import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { netAccessApi, devicesApi } from "@/lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Router, Radio, User, ChevronDown, ChevronRight, RefreshCw, MonitorCog, RadioTower, Link2, Pencil } from "lucide-react";

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
  onAdvanced: (device: { ip: string; name: string; proxy_path: string }) => void;
}

type Edit = { tower: string; role: string; sector: string; mikrotik_id: string };

export function TopologyTree({ mikrotikId, onAdvanced }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<Record<string, Edit>>({});

  // Sedes (MikroTik) a las que se puede mover un AP
  const { data: sedes } = useQuery({
    queryKey: ["mikrotik-devices"],
    queryFn: () => devicesApi.list(),
  });

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["topology", mikrotikId],
    queryFn: () => netAccessApi.topology(mikrotikId),
    enabled: !!mikrotikId,
    refetchInterval: 60000,
  });

  // Solo envía ubicación: usuario y clave guardados se conservan
  const savePlace = useMutation({
    mutationFn: ({ ap, edit }: { ap: any; edit: Edit }) =>
      netAccessApi.saveApCredentials({
        ip: ap.ip,
        mikrotik_id: edit.mikrotik_id || mikrotikId,
        tower: edit.tower,
        role: edit.role,
        sector: edit.role === "ptp" ? "" : edit.sector,
      }),
    onSuccess: (_d, { ap }) => {
      toast.success("Ubicación guardada");
      setEditing(({ [ap.ip]: _, ...rest }) => rest);
      qc.invalidateQueries({ queryKey: ["topology", mikrotikId] });
      qc.invalidateQueries({ queryKey: ["ap-credentials"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const tree = data?.tree;
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const isOpen = (k: string) => open[k] !== false;

  if (!mikrotikId) {
    return (
      <Card><CardContent className="py-6 text-sm text-muted-foreground">
        Selecciona un MikroTik en Ajustes para ver el árbol de la red.
      </CardContent></Card>
    );
  }

  const ApRow = ({ ap }: { ap: any }) => {
    const edit = editing[ap.ip];
    return (
      <div className="ml-4 border-l pl-4 space-y-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {ap.role === "ptp"
            ? <Link2 className={`h-4 w-4 ${ap.online ? "text-primary" : "text-destructive"}`} />
            : <Radio className={`h-4 w-4 ${ap.online ? "text-primary" : "text-destructive"}`} />}
          <span className="font-medium">{ap.name}</span>
          <span className="font-mono text-xs text-muted-foreground">{ap.ip}</span>
          <Badge variant="secondary" className="text-[10px]">{ap.brand}</Badge>
          {ap.role !== "ptp" && <Badge variant="outline" className="text-[10px]">{ap.total_clients} clientes</Badge>}
          {!ap.mikrotik_id && <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-500">Sin sede</Badge>}
          {ap.error && <span className="text-xs text-destructive">{ap.error}</span>}
          <div className="ml-auto flex items-center gap-1">
            {!edit && (
              <Button
                size="sm"
                variant="ghost"
                title="Cambiar torre / tipo / sector"
                onClick={() => setEditing({ ...editing, [ap.ip]: { tower: ap.tower || "", role: ap.role || "sector", sector: ap.sector || "", mikrotik_id: ap.mikrotik_id || mikrotikId } })}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => onAdvanced({ ip: ap.ip, name: ap.name, proxy_path: ap.proxy_path })}>
              Avanzado
            </Button>
          </div>
        </div>

        {edit && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border p-2">
            <Input
              className="h-7 w-36 text-xs"
              placeholder="Torre"
              value={edit.tower}
              onChange={(e) => setEditing({ ...editing, [ap.ip]: { ...edit, tower: e.target.value } })}
            />
            <Select value={edit.mikrotik_id} onValueChange={(v) => setEditing({ ...editing, [ap.ip]: { ...edit, mikrotik_id: v } })}>
              <SelectTrigger className="h-7 w-48 text-xs" title="Sede (MikroTik) a la que pertenece"><SelectValue placeholder="Sede" /></SelectTrigger>
              <SelectContent>
                {((sedes as any[]) || []).map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={edit.role} onValueChange={(v) => setEditing({ ...editing, [ap.ip]: { ...edit, role: v } })}>
              <SelectTrigger className="h-7 w-36 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sector">Sector / AP</SelectItem>
                <SelectItem value="ptp">Enlace PtP</SelectItem>
              </SelectContent>
            </Select>
            {edit.role !== "ptp" && (
              <Input
                className="h-7 w-36 text-xs"
                placeholder="Sector"
                value={edit.sector}
                onChange={(e) => setEditing({ ...editing, [ap.ip]: { ...edit, sector: e.target.value } })}
              />
            )}
            <Button size="sm" className="h-7" onClick={() => savePlace.mutate({ ap, edit })} disabled={savePlace.isPending}>Guardar</Button>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditing(({ [ap.ip]: _, ...rest }) => rest)}>Cancelar</Button>
          </div>
        )}

        {(ap.clients || []).map((c: any) => (
          <div key={`${ap.id}-${c.mac}`} className="ml-4 border-l pl-4 flex flex-wrap items-center gap-3 py-1">
            {ap.role === "ptp" ? <Link2 className="h-3.5 w-3.5 text-muted-foreground" /> : <User className="h-3.5 w-3.5 text-muted-foreground" />}
            <span className="text-sm">{ap.role === "ptp" ? `Otro extremo · ${c.name}` : c.name}</span>
            <span className="font-mono text-[11px] text-muted-foreground">{c.ip || c.mac}</span>
            <SignalBar signal={c.signal} snr={c.snr} quality={c.quality} />
            {c.ccq !== null && c.ccq !== undefined && (
              <span className="text-xs text-muted-foreground">CCQ {c.ccq}%</span>
            )}
            <span className="text-xs text-muted-foreground">{[c.tx_rate, c.rx_rate].filter(Boolean).join(" / ")}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Router className="h-4 w-4" /> Árbol de red por torres
          </CardTitle>
          <CardDescription>
            MikroTik → torre → enlace PtP y sectores → clientes, con la señal de cada enlace. Usa el lápiz para
            ubicar cada AP en su torre.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Actualizar
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {data?.totals && (
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary">{(tree?.towers || []).length} torres</Badge>
            <Badge variant="secondary">{data.totals.aps} APs</Badge>
            <Badge variant="secondary">{data.totals.clients_with_signal} clientes con señal</Badge>
            <Badge variant="outline">{data.totals.direct_clients} sin AP identificado</Badge>
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

            {!(tree.towers || []).length && (
              <p className="ml-4 text-sm text-muted-foreground">
                No hay APs guardados en esta sede. En Conexión MikroTik → APs / Señal usa "Guardar en el mapa".
              </p>
            )}

            {(tree.towers || []).map((tower: any) => (
              <div key={tower.name} className="ml-4 border-l pl-4 space-y-2">
                <button className="flex items-center gap-2 text-sm font-semibold" onClick={() => toggle(`t:${tower.name}`)}>
                  {isOpen(`t:${tower.name}`) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <RadioTower className="h-4 w-4 text-primary" />
                  {tower.name}
                  <Badge variant="outline" className="text-[10px]">
                    {tower.sectors.reduce((n: number, s: any) => n + s.aps.length, 0)} AP
                  </Badge>
                </button>

                {isOpen(`t:${tower.name}`) && (
                  <>
                    {tower.ptp.map((ap: any) => <ApRow key={ap.id} ap={ap} />)}
                    {tower.sectors.map((sector: any) => (
                      <div key={sector.name} className="ml-4 border-l pl-4 space-y-2">
                        <button
                          className="flex items-center gap-2 text-sm font-medium"
                          onClick={() => toggle(`s:${tower.name}:${sector.name}`)}
                        >
                          {isOpen(`s:${tower.name}:${sector.name}`) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          {sector.name}
                          <Badge variant="outline" className="text-[10px]">{sector.aps.length} AP</Badge>
                        </button>
                        {isOpen(`s:${tower.name}:${sector.name}`) && sector.aps.map((ap: any) => <ApRow key={ap.id} ap={ap} />)}
                      </div>
                    ))}
                  </>
                )}
              </div>
            ))}

            {!!(tree.direct_clients || []).length && (
              <div className="ml-4 border-l pl-4">
                <button className="flex items-center gap-2 text-sm font-medium" onClick={() => toggle("direct")}>
                  {open.direct ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  Clientes PPPoE sin AP identificado
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
