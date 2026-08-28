interface OpticalMeterProps {
  rx: number | null;
  tx?: number | null;
  /** Versión compacta para filas de tabla */
  compact?: boolean;
  dimmed?: boolean;
}

type Tone = "ok" | "warn" | "crit" | "none";

const TONE: Record<Tone, { text: string; bar: string; track: string; label: string }> = {
  ok: { text: "text-success", bar: "bg-success", track: "bg-success/15", label: "Óptima" },
  warn: { text: "text-warning", bar: "bg-warning", track: "bg-warning/15", label: "Advertencia" },
  crit: { text: "text-destructive", bar: "bg-destructive", track: "bg-destructive/15", label: "Crítica" },
  none: { text: "text-muted-foreground", bar: "bg-muted-foreground", track: "bg-muted", label: "Sin dato" },
};

export function opticalTone(dbm: number | null | undefined): Tone {
  if (dbm === null || dbm === undefined || !Number.isFinite(dbm)) return "none";
  if (dbm > -25) return "ok";
  if (dbm > -28) return "warn";
  return "crit";
}

/** -8 dBm => 100% ; -32 dBm => 0% */
function toPercent(dbm: number | null | undefined) {
  if (dbm === null || dbm === undefined || !Number.isFinite(dbm)) return 0;
  return Math.max(4, Math.min(100, ((dbm + 32) / 24) * 100));
}

export default function OpticalMeter({ rx, tx = null, compact = false, dimmed = false }: OpticalMeterProps) {
  const tone = TONE[opticalTone(rx)];
  const pct = toPercent(rx);

  if (compact) {
    return (
      <div className={`w-32 space-y-1 ${dimmed ? "opacity-50 grayscale" : ""}`}>
        <div className="flex items-baseline justify-between gap-2">
          <span className={`text-sm font-semibold tabular-nums ${tone.text}`}>
            {rx != null ? `${rx.toFixed(1)}` : "—"}
            <span className="text-[10px] font-normal text-muted-foreground ml-0.5">dBm</span>
          </span>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            Tx {tx != null ? tx.toFixed(1) : "—"}
          </span>
        </div>
        <div className={`h-1.5 w-full rounded-full overflow-hidden ${tone.track}`}>
          <div
            className={`h-full rounded-full transition-all duration-500 ${tone.bar}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border bg-card p-4 space-y-3 ${dimmed ? "opacity-60" : ""}`}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Potencia de recepción</p>
          <p className={`text-3xl font-bold tabular-nums ${tone.text}`}>
            {rx != null ? rx.toFixed(2) : "—"}
            <span className="text-sm font-medium text-muted-foreground ml-1">dBm</span>
          </p>
        </div>
        <div className="text-right">
          <p className={`text-xs font-semibold ${tone.text}`}>{tone.label}</p>
          <p className="text-xs text-muted-foreground tabular-nums">
            Tx {tx != null ? `${tx.toFixed(2)} dBm` : "—"}
          </p>
        </div>
      </div>
      <div className={`h-2 w-full rounded-full overflow-hidden ${tone.track}`}>
        <div className={`h-full rounded-full transition-all duration-500 ${tone.bar}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full bg-destructive" /> ≤ −28</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full bg-warning" /> −25 a −27.9</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full bg-success" /> &gt; −25</span>
      </div>
    </div>
  );
}
