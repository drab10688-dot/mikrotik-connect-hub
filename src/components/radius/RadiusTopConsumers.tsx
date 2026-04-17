import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { radiusApi } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trophy, ArrowDownUp } from "lucide-react";

interface Props {
  onSelectUser?: (username: string) => void;
}

const RANGES: Array<{ v: "24h"|"7d"|"30d"; label: string }> = [
  { v: "24h", label: "24h" },
  { v: "7d", label: "7d" },
  { v: "30d", label: "30d" },
];

export function RadiusTopConsumers({ onSelectUser }: Props) {
  const [range, setRange] = useState<"24h"|"7d"|"30d">("24h");
  const { data: top = [], isLoading } = useQuery({
    queryKey: ["radius", "monitor", "top", range],
    queryFn: () => radiusApi.monitorTop(range, 10),
    refetchInterval: 30000,
  });

  const max = Math.max(1, ...top.map((t: any) => Number(t.bytes_total || 0)));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="w-4 h-4 text-primary" />Top consumidores
        </CardTitle>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <Button
              key={r.v}
              size="sm"
              variant={range === r.v ? "default" : "ghost"}
              onClick={() => setRange(r.v)}
              className="h-7 px-2 text-xs"
            >
              {r.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center text-sm text-muted-foreground py-6">Cargando...</div>
        ) : top.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-6">Sin datos en el período</div>
        ) : (
          <div className="space-y-2">
            {top.map((t: any, idx: number) => {
              const total = Number(t.bytes_total || 0);
              const pct = (total / max) * 100;
              return (
                <button
                  key={t.username}
                  onClick={() => onSelectUser?.(t.username)}
                  className="w-full text-left group"
                >
                  <div className="flex items-center gap-2 text-xs mb-1">
                    <Badge variant="outline" className="w-6 justify-center">{idx + 1}</Badge>
                    <span className="font-mono group-hover:text-primary transition">{t.username}</span>
                    <span className="ml-auto flex items-center gap-1 text-muted-foreground">
                      <ArrowDownUp className="w-3 h-3" />{formatBytes(total)}
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-primary to-primary/60"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0; let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}
