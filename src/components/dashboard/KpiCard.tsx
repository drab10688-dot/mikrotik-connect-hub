import { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export type KpiTone = "neutral" | "success" | "danger" | "warning" | "info";

const TONE: Record<KpiTone, { icon: string; bar: string; value: string }> = {
  neutral: { icon: "text-foreground bg-muted", bar: "bg-muted-foreground/40", value: "text-foreground" },
  success: { icon: "text-success bg-success/10", bar: "bg-success", value: "text-success" },
  danger: { icon: "text-destructive bg-destructive/10", bar: "bg-destructive", value: "text-destructive" },
  warning: { icon: "text-warning bg-warning/10", bar: "bg-warning", value: "text-warning" },
  info: { icon: "text-primary bg-primary/10", bar: "bg-primary", value: "text-primary" },
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
    <Card
      onClick={onClick}
      className={`relative overflow-hidden transition-shadow ${onClick ? "cursor-pointer hover:shadow-md" : ""} ${
        active ? "ring-2 ring-ring" : ""
      }`}
    >
      <span className={`absolute inset-x-0 top-0 h-1 ${t.bar}`} aria-hidden />
      <CardContent className="p-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground truncate">{label}</p>
            <p className={`mt-1 text-2xl md:text-3xl font-bold tabular-nums ${t.value}`}>
              {loading ? "…" : value}
            </p>
            {hint && <p className="mt-1 text-[11px] text-muted-foreground truncate">{hint}</p>}
          </div>
          <span className={`h-10 w-10 shrink-0 rounded-lg flex items-center justify-center ${t.icon}`}>
            <Icon className="h-5 w-5" />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
