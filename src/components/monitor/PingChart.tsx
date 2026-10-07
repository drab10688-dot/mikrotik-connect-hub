import { useMemo, useRef, useState } from "react";

export type PingPoint = { t: string; vpn_rtt: number | null; inet_rtt: number | null; loss: number | null; down: boolean; no_internet: boolean };

const W = 600;
const H = 140;
const PAD = { l: 34, r: 8, t: 8, b: 18 };

/**
 * Ping de un router en el tiempo: internet (línea continua) y VPN (punteada),
 * con las caídas marcadas abajo. Un solo eje (ms); al pasar el mouse se ven
 * los valores del momento.
 */
export function PingChart({ points, threshold }: { points: PingPoint[]; threshold?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);

  const { max, x, y, ticks } = useMemo(() => {
    const vals = points.flatMap((p) => [p.vpn_rtt, p.inet_rtt]).filter((v): v is number => v != null);
    const top = Math.max(50, threshold ? threshold * 1.2 : 0, ...vals);
    const step = top > 600 ? 200 : top > 300 ? 100 : top > 120 ? 50 : 20;
    const max = Math.ceil(top / step) * step;
    const n = Math.max(1, points.length - 1);
    const x = (i: number) => PAD.l + (i / n) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
    const ticks: number[] = [];
    for (let v = 0; v <= max; v += step * (max / step > 4 ? 2 : 1)) ticks.push(v);
    return { max, x, y, ticks };
  }, [points, threshold]);

  const path = (key: "vpn_rtt" | "inet_rtt") => {
    let d = "";
    let pen = false;
    points.forEach((p, i) => {
      const v = p[key];
      if (v == null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(Math.min(v, max)).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  if (!points.length) {
    return <div className="h-[140px] grid place-items-center text-xs text-muted-foreground">Sin mediciones todavía (se mide cada minuto)</div>;
  }

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (points.length - 1));
    setHover(Math.min(points.length - 1, Math.max(0, i)));
  };
  const hp = hover != null ? points[hover] : null;
  const time = (t: string) => new Date(t).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  const barW = Math.max(1.5, (W - PAD.l - PAD.r) / points.length);

  return (
    <div className="relative">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-[140px]"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Ping en el tiempo: internet y VPN"
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="hsl(var(--border))" strokeWidth={1} />
            <text x={PAD.l - 4} y={y(v) + 3} textAnchor="end" fontSize={9} fill="hsl(var(--muted-foreground))">{v}</text>
          </g>
        ))}
        {threshold != null && threshold < max && (
          <line x1={PAD.l} x2={W - PAD.r} y1={y(threshold)} y2={y(threshold)} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 3" strokeWidth={1} />
        )}
        {/* Caídas: franja abajo (rojo = no responde, ámbar = sin internet) */}
        {points.map((p, i) =>
          p.down || p.no_internet ? (
            <rect key={i} x={x(i) - barW / 2} y={H - PAD.b + 2} width={barW} height={5} rx={1}
              fill={p.down ? "hsl(var(--destructive))" : "rgb(245 158 11)"} />
          ) : null,
        )}
        <path d={path("vpn_rtt")} fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="4 3" />
        <path d={path("inet_rtt")} fill="none" stroke="hsl(var(--primary))" strokeWidth={2} strokeLinejoin="round" />
        {hp && hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="hsl(var(--foreground))" strokeOpacity={0.3} />
            {hp.inet_rtt != null && <circle cx={x(hover)} cy={y(Math.min(hp.inet_rtt, max))} r={4} fill="hsl(var(--primary))" stroke="hsl(var(--card))" strokeWidth={2} />}
          </g>
        )}
      </svg>
      {hp && (
        <div className="pointer-events-none absolute top-0 right-0 rounded-md border bg-popover px-2 py-1 text-[11px] shadow-sm tabular-nums">
          <div className="font-medium">{time(hp.t)}</div>
          <div>Internet: {hp.inet_rtt != null ? `${hp.inet_rtt} ms` : "—"}</div>
          <div>VPN: {hp.vpn_rtt != null ? `${hp.vpn_rtt} ms` : "—"}</div>
          {!!hp.loss && <div>Pérdida máx.: {hp.loss}%</div>}
          {hp.down && <div className="text-destructive">No respondió</div>}
          {!hp.down && hp.no_internet && <div className="text-amber-600 dark:text-amber-400">Sin internet</div>}
        </div>
      )}
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><svg width="16" height="6"><line x1="0" x2="16" y1="3" y2="3" stroke="hsl(var(--primary))" strokeWidth="2" /></svg> Internet (desde el router)</span>
        <span className="flex items-center gap-1"><svg width="16" height="6"><line x1="0" x2="16" y1="3" y2="3" stroke="hsl(var(--muted-foreground))" strokeWidth="1.5" strokeDasharray="4 3" /></svg> VPN (VPS → router)</span>
        <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-3 rounded-sm bg-destructive" /> No responde</span>
        <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-3 rounded-sm bg-amber-500" /> Sin internet</span>
        {threshold != null && <span>· umbral {threshold} ms (línea punteada fina)</span>}
      </div>
    </div>
  );
}
