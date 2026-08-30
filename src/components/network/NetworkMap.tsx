import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { netAccessApi } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Router, Radio, User, RefreshCw, ZoomIn, ZoomOut, Maximize2, MonitorCog, Search } from "lucide-react";

interface Props {
  mikrotikId: string;
  onManage?: (ip: string) => void;
  onAdvanced?: (device: { ip: string; name: string; proxy_path: string }) => void;
}

type Node = {
  id: string;
  kind: "router" | "ap" | "client";
  label: string;
  sub?: string;
  x: number;
  y: number;
  quality?: string;
  online?: boolean;
  raw?: any;
};

type Link = { id: string; from: Node; to: Node; quality?: string };

const COL = { router: 90, ap: 430, client: 800 };
const ROW = 34;
const PAD = 60;

function toneOf(quality?: string, online?: boolean) {
  if (online === false) return "hsl(var(--destructive))";
  switch (quality) {
    case "excelente": return "hsl(var(--primary))";
    case "buena": return "hsl(var(--primary) / 0.7)";
    case "regular": return "hsl(38 92% 50%)";
    case "mala": return "hsl(var(--destructive))";
    default: return "hsl(var(--muted-foreground) / 0.45)";
  }
}

function curve(a: Node, b: Node) {
  const mx = (a.x + b.x) / 2;
  return `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
}

export function NetworkMap({ mikrotikId, onManage, onAdvanced }: Props) {
  const [zoom, setZoom] = useState(1);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Node | null>(null);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["topology", mikrotikId],
    queryFn: () => netAccessApi.topology(mikrotikId),
    enabled: !!mikrotikId,
    refetchInterval: 60000,
  });

  const { nodes, links, height, sectors } = useMemo(() => {
    const tree = data?.tree;
    const nodes: Node[] = [];
    const links: Link[] = [];
    const sectors: { name: string; y: number; count: number }[] = [];
    if (!tree) return { nodes, links, height: 300, sectors };

    const q = filter.trim().toLowerCase();
    const match = (s?: string) => !q || (s || "").toLowerCase().includes(q);

    let clientY = PAD;
    const apNodes: Node[] = [];

    for (const sector of tree.sectors || []) {
      const sectorStart = clientY;
      let sectorClients = 0;

      for (const ap of sector.aps || []) {
        const clients = (ap.clients || []).filter((c: any) => match(c.name) || match(c.ip) || match(ap.name));
        const apStart = clientY;
        const clientNodes: Node[] = [];

        for (const c of clients) {
          const n: Node = {
            id: `c:${ap.id}:${c.mac || c.name}`,
            kind: "client",
            label: c.name,
            sub: c.ip || c.mac,
            x: COL.client,
            y: clientY,
            quality: c.quality,
            raw: { ...c, ap },
          };
          nodes.push(n);
          clientNodes.push(n);
          clientY += ROW;
          sectorClients++;
        }
        if (!clients.length) clientY += ROW;

        const apNode: Node = {
          id: `a:${ap.id}`,
          kind: "ap",
          label: ap.name,
          sub: ap.ip,
          x: COL.ap,
          y: clientNodes.length ? (apStart + clientNodes[clientNodes.length - 1].y) / 2 : apStart,
          online: ap.online,
          raw: ap,
        };
        nodes.push(apNode);
        apNodes.push(apNode);
        clientNodes.forEach((cn) =>
          links.push({ id: `${apNode.id}->${cn.id}`, from: apNode, to: cn, quality: cn.quality })
        );
        clientY += ROW / 2;
      }

      sectors.push({ name: sector.name, y: (sectorStart + clientY) / 2, count: sectorClients });
      clientY += ROW / 2;
    }

    for (const c of tree.direct_clients || []) {
      if (!(match(c.name) || match(c.ip))) continue;
      const n: Node = {
        id: `d:${c.name}`,
        kind: "client",
        label: c.name,
        sub: c.ip || "—",
        x: COL.ap,
        y: clientY,
        online: c.online,
        raw: c,
      };
      nodes.push(n);
      clientY += ROW;
    }

    const routerNode: Node = {
      id: "router",
      kind: "router",
      label: tree.name,
      sub: tree.host,
      x: COL.router,
      y: Math.max(PAD, clientY / 2),
      raw: tree,
    };
    nodes.push(routerNode);
    for (const a of apNodes) links.push({ id: `r->${a.id}`, from: routerNode, to: a });
    for (const n of nodes) if (n.id.startsWith("d:")) links.push({ id: `r->${n.id}`, from: routerNode, to: n });

    return { nodes, links, height: Math.max(clientY + PAD, 320), sectors };
  }, [data, filter]);

  if (!mikrotikId) {
    return (
      <Card><CardContent className="py-6 text-sm text-muted-foreground">
        Selecciona un MikroTik en Ajustes para ver el mapa de la red.
      </CardContent></Card>
    );
  }

  const width = 1080;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 pl-7 w-56"
            placeholder="Buscar cliente o AP"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        {data?.totals && (
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary">{data.totals.sectors} sectores</Badge>
            <Badge variant="secondary">{data.totals.aps} APs</Badge>
            <Badge variant="secondary">{data.totals.clients_with_signal} con señal</Badge>
            <Badge variant="outline">{data.totals.direct_clients} directos</Badge>
          </div>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setZoom((z) => Math.max(0.5, z - 0.15))}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setZoom(1)}>
            <Maximize2 className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setZoom((z) => Math.min(2, z + 0.15))}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" className="h-8" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Actualizar
          </Button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-auto max-h-[70vh] bg-muted/20">
              <svg
                width={width * zoom}
                height={height * zoom}
                viewBox={`0 0 ${width} ${height}`}
                className="block"
              >
                {sectors.map((s) => (
                  <text key={s.name} x={COL.ap - 20} y={s.y - 22} textAnchor="end"
                    className="fill-muted-foreground" fontSize="11" fontWeight={600}>
                    {s.name} ({s.count})
                  </text>
                ))}

                {links.map((l) => (
                  <path
                    key={l.id}
                    d={curve(l.from, l.to)}
                    fill="none"
                    stroke={toneOf(l.quality, l.to.online)}
                    strokeWidth={l.to.kind === "ap" ? 2 : 1.2}
                    strokeDasharray={l.to.kind === "client" ? "4 3" : undefined}
                    opacity={0.85}
                  />
                ))}

                {nodes.map((n) => {
                  const active = selected?.id === n.id;
                  const color = n.kind === "client" ? toneOf(n.quality, n.online) : toneOf(undefined, n.online);
                  return (
                    <g key={n.id} onClick={() => setSelected(n)} className="cursor-pointer">
                      <circle
                        cx={n.x} cy={n.y}
                        r={n.kind === "router" ? 9 : n.kind === "ap" ? 7 : 4.5}
                        fill={n.kind === "client" ? color : "hsl(var(--background))"}
                        stroke={n.kind === "client" ? color : "hsl(var(--primary))"}
                        strokeWidth={2}
                      />
                      <text
                        x={n.kind === "client" ? n.x + 12 : n.x + 12}
                        y={n.y + 4}
                        fontSize={n.kind === "router" ? 13 : 11}
                        fontWeight={n.kind === "client" ? 400 : 600}
                        className={active ? "fill-primary" : "fill-foreground"}
                      >
                        {n.label}
                      </text>
                      {n.kind === "client" && n.raw?.signal != null && (
                        <text x={n.x + 12} y={n.y + 16} fontSize="9" className="fill-muted-foreground">
                          {n.raw.signal} dBm{n.raw.snr != null ? ` · SNR ${n.raw.snr}` : ""}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-3 text-sm">
            {!selected && <p className="text-muted-foreground">Haz clic en un nodo del mapa para ver detalles y acciones.</p>}
            {selected && (
              <>
                <div className="flex items-center gap-2 font-medium">
                  {selected.kind === "router" ? <Router className="h-4 w-4 text-primary" />
                    : selected.kind === "ap" ? <Radio className="h-4 w-4 text-primary" />
                    : <User className="h-4 w-4 text-muted-foreground" />}
                  {selected.label}
                </div>
                <div className="font-mono text-xs text-muted-foreground">{selected.sub}</div>

                {selected.kind === "client" && (
                  <div className="space-y-1 text-xs">
                    {selected.raw?.signal != null && <div>Señal: <span className="font-mono">{selected.raw.signal} dBm</span></div>}
                    {selected.raw?.snr != null && <div>SNR: <span className="font-mono">{selected.raw.snr}</span></div>}
                    {selected.raw?.ccq != null && <div>CCQ: <span className="font-mono">{selected.raw.ccq}%</span></div>}
                    {selected.raw?.tx_rate && <div>Tasa: <span className="font-mono">{selected.raw.tx_rate}</span></div>}
                    {selected.raw?.ap?.name && <div>Conectado a: {selected.raw.ap.name}</div>}
                    {selected.quality && <Badge variant="outline" className="text-[10px]">{selected.quality}</Badge>}
                  </div>
                )}

                {selected.kind === "ap" && (
                  <div className="space-y-1 text-xs">
                    <div>Marca: {selected.raw?.brand}</div>
                    <div>Clientes: {selected.raw?.total_clients}</div>
                    {selected.raw?.error && <div className="text-destructive">{selected.raw.error}</div>}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  {selected.kind !== "client" && onManage && (
                    <Button size="sm" variant="outline" onClick={() => onManage(selected.sub!)}>Mini-panel</Button>
                  )}
                  {selected.kind !== "client" && onAdvanced && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onAdvanced({
                          ip: selected.sub!,
                          name: selected.label,
                          proxy_path: selected.raw?.proxy_path,
                        })
                      }
                    >
                      <MonitorCog className="h-4 w-4 mr-1" /> Avanzado
                    </Button>
                  )}
                  {selected.kind === "client" && selected.raw?.ip && onManage && (
                    <Button size="sm" variant="outline" onClick={() => onManage(selected.raw.ip)}>Mini-panel</Button>
                  )}
                </div>
              </>
            )}

            <div className="pt-3 border-t space-y-1 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">Leyenda</div>
              <div className="flex items-center gap-2"><span className="h-2 w-6 rounded" style={{ background: toneOf("excelente") }} /> Excelente / Buena</div>
              <div className="flex items-center gap-2"><span className="h-2 w-6 rounded" style={{ background: toneOf("regular") }} /> Regular</div>
              <div className="flex items-center gap-2"><span className="h-2 w-6 rounded" style={{ background: toneOf("mala") }} /> Mala / Fuera de línea</div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
