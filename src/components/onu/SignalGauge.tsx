interface SignalGaugeProps {
  rx: number | null;
  tx: number | null;
  size?: number;
}

function quality(dbm: number | null) {
  if (dbm === null || dbm === undefined) return { label: "Sin dato", cls: "text-muted-foreground", stroke: "hsl(var(--muted-foreground))" };
  if (dbm > -20) return { label: "Excelente", cls: "text-green-500", stroke: "hsl(142 71% 45%)" };
  if (dbm > -25) return { label: "Buena", cls: "text-yellow-500", stroke: "hsl(45 93% 47%)" };
  if (dbm > -28) return { label: "Regular", cls: "text-orange-500", stroke: "hsl(25 95% 53%)" };
  return { label: "Crítica", cls: "text-destructive", stroke: "hsl(var(--destructive))" };
}

// -8 dBm => 100% ; -32 dBm => 0%
function toPercent(dbm: number | null) {
  if (dbm === null || dbm === undefined) return 0;
  const pct = ((dbm + 32) / 24) * 100;
  return Math.max(0, Math.min(100, pct));
}

export default function SignalGauge({ rx, tx, size = 84 }: SignalGaugeProps) {
  const q = quality(rx);
  const pct = toPercent(rx);
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;

  return (
    <div className="flex items-center gap-3">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" strokeWidth={stroke}
            className="stroke-muted"
          />
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" strokeWidth={stroke} strokeLinecap="round"
            stroke={q.stroke}
            strokeDasharray={`${dash} ${c - dash}`}
            style={{ transition: "stroke-dasharray 600ms ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
          <span className={`text-sm font-bold ${q.cls}`}>{rx != null ? rx : "—"}</span>
          <span className="text-[9px] text-muted-foreground mt-0.5">dBm Rx</span>
        </div>
      </div>
      <div className="text-xs space-y-1">
        <p className={`font-semibold ${q.cls}`}>{q.label}</p>
        <p className="text-muted-foreground">
          Tx <span className="font-semibold text-foreground">{tx != null ? `${tx} dBm` : "—"}</span>
        </p>
      </div>
    </div>
  );
}
