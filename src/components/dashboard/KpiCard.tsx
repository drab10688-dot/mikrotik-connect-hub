import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type KpiTone = "neutral" | "success" | "danger" | "warning" | "info";

const TONE: Record<KpiTone, { icon: string; bar: string; value: string; glow: string }> = {
  neutral: {
    icon: "text-foreground bg-muted",
    bar: "bg-muted-foreground/40",
    value: "text-foreground",
    glow: "from-muted-foreground/10",
  },
  success: {
    icon: "text-success bg-success/10 ring-success/25",
    bar: "bg-gradient-success",
    value: "text-success",
    glow: "from-success/15",
  },
  danger: {
    icon: "text-destructive bg-destructive/10 ring-destructive/25",
    bar: "bg-gradient-danger",
    value: "text-destructive",
    glow: "from-destructive/15",
  },
  warning: {
    icon: "text-warning bg-warning/10 ring-warning/25",
    bar: "bg-gradient-warning",
    value: "text-warning",
    glow: "from-warning/15",
  },
  info: {
    icon: "text-primary bg-primary/10 ring-primary/25",
    bar: "bg-gradient-primary",
    value: "text-primary",
    glow: "from-primary/15",
  },
};

interface KpiCardProps {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone?: KpiTone;
  hint?: string;
  loading?: boolean;
  onClick?: () => void;
  active?: boolean;
}

export default function KpiCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  hint,
  loading,
  onClick,
  active,
}: KpiCardProps) {
  const t = TONE[tone];
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={cn(
        "glass-panel group overflow-hidden p-0 transition-smooth animate-fade-in-up",
        onClick && "cursor-pointer hover:-translate-y-0.5 hover:glass-panel-glow",
        active && "glass-panel-glow border-primary/50"
      )}
    >
      <span className={cn("absolute inset-x-0 top-0 h-[3px]", t.bar)} aria-hidden />
      <span
        className={cn(
          "pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-gradient-to-br to-transparent blur-2xl opacity-70",
          t.glow
        )}
        aria-hidden
      />
      <div className="relative p-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground truncate">
              {label}
            </p>
            <p className={cn("mt-1.5 text-3xl font-bold tabular-nums leading-none", t.value)}>
              {loading ? <span className="opacity-40">—</span> : value}
            </p>
            {hint && <p className="mt-2 text-[11px] text-muted-foreground truncate">{hint}</p>}
          </div>
          <span
            className={cn(
              "h-11 w-11 shrink-0 rounded-xl flex items-center justify-center ring-1 ring-border/60 transition-smooth group-hover:scale-105",
              t.icon
            )}
          >
            <Icon className="h-5 w-5" />
          </span>
        </div>
      </div>
    </div>
  );
}
