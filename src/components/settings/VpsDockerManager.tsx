import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { vpsApi } from "@/lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Server, Container, Play, Square, RefreshCw, Loader2,
  HardDrive, Cpu, MemoryStick, ArrowUpDown, ScrollText, Download
} from "lucide-react";

interface VpsDockerManagerProps {
  mikrotikId: string | null;
}

interface ContainerInfo {
  status: string;
  ports: string;
}

interface VpsStatus {
  tunnel: { status: string; url: string | null };
  containers: Record<string, ContainerInfo>;
  docker_installed: boolean;
  cloudflared_installed: boolean;
  system: {
    disk: { total: string; used: string; free: string; percent: string };
    memory: { total: string; used: string; free: string };
  };
}

const SERVICES = [
  { key: "routeros-proxy", label: "RouterOS API", icon: "🔌", desc: "Proxy REST para MikroTik" },
  { key: "radius", label: "FreeRADIUS", icon: "🔐", desc: "Autenticación Hotspot/PPPoE" },
  { key: "radius-db", label: "MariaDB", icon: "🗄️", desc: "Base de datos RADIUS" },
  { key: "netdata", label: "Netdata", icon: "📊", desc: "Monitoreo del VPS" },
  { key: "daloradius", label: "daloRADIUS", icon: "🌐", desc: "Panel web RADIUS" },
];

export function VpsDockerManager({ mikrotikId }: VpsDockerManagerProps) {
  const queryClient = useQueryClient();
  const [logsService, setLogsService] = useState<string | null>(null);
  const [logs, setLogs] = useState("");

  const { data: status, isLoading } = useQuery<VpsStatus>({
    queryKey: ["vps-status", mikrotikId],
    queryFn: async () => {
      const data = await vpsApi.status(mikrotikId!);
      return data;
    },
    enabled: !!mikrotikId,
    refetchInterval: 10000,
  });

  const dockerMutation = useMutation({
    mutationFn: async ({ action, service }: { action: string; service?: string }) => {
      const data = await vpsApi.docker(mikrotikId!, action, service);
      return data;
    },
    onSuccess: (data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["vps-status", mikrotikId] });
      if (vars.action === "logs") {
        setLogs(data?.logs || "Sin logs");
        setLogsService(vars.service || "all");
      } else {
        toast.success(`Docker ${vars.action}: ${data?.message || "OK"}`);
      }
    },
    onError: (err: any) => toast.error(err.message),
  });

  if (!mikrotikId) return null;

  const hasContainers = status?.containers && Object.keys(status.containers).length > 0;

  const getStatusBadge = (containerStatus: string) => {
    if (containerStatus?.toLowerCase().includes("up")) {
      return <Badge variant="outline" className="text-[9px] border-green-500/30 text-green-600">Running</Badge>;
    }
    return <Badge variant="destructive" className="text-[9px]">Stopped</Badge>;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Container className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-sm">Docker Containers (VPS)</CardTitle>
            <CardDescription className="text-[10px]">
              Gestión de servicios Docker en tu VPS
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[10px]"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["vps-status", mikrotikId] })}
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Actualizar
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* System Stats */}
        {status?.system && (
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2 rounded-lg bg-muted/50 border">
              <div className="flex items-center gap-1.5 mb-1">
                <HardDrive className="h-3 w-3 text-muted-foreground" />
                <span className="text-[10px] font-medium">Disco</span>
              </div>
              <p className="text-xs font-mono">
                {status.system.disk.used} / {status.system.disk.total}
                <span className="text-muted-foreground ml-1">({status.system.disk.percent})</span>
              </p>
            </div>
            <div className="p-2 rounded-lg bg-muted/50 border">
              <div className="flex items-center gap-1.5 mb-1">
                <MemoryStick className="h-3 w-3 text-muted-foreground" />
                <span className="text-[10px] font-medium">RAM</span>
              </div>
              <p className="text-xs font-mono">
                {status.system.memory.used} / {status.system.memory.total}
              </p>
            </div>
          </div>
        )}

        {/* Global Actions */}
        <div className="flex gap-2">
          <Button
            size="sm"
            className="h-7 text-[10px] flex-1"
            onClick={() => dockerMutation.mutate({ action: "up" })}
            disabled={dockerMutation.isPending}
          >
            <Play className="h-3 w-3 mr-1" />
            Iniciar Todos
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="h-7 text-[10px] flex-1"
            onClick={() => dockerMutation.mutate({ action: "down" })}
            disabled={dockerMutation.isPending}
          >
            <Square className="h-3 w-3 mr-1" />
            Detener Todos
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[10px]"
            onClick={() => dockerMutation.mutate({ action: "pull" })}
            disabled={dockerMutation.isPending}
          >
            <Download className="h-3 w-3 mr-1" />
            Update
          </Button>
        </div>

        {/* Container List */}
        <div className="space-y-1.5">
          {SERVICES.map((svc) => {
            const container = status?.containers?.[svc.key];
            return (
              <div key={svc.key} className="flex items-center gap-2 p-2 rounded-lg border bg-card hover:bg-muted/30 transition-colors">
                <span className="text-sm">{svc.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">{svc.label}</span>
                    {container ? getStatusBadge(container.status) : (
                      <Badge variant="outline" className="text-[9px] text-muted-foreground">No detectado</Badge>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate">{svc.desc}</p>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => dockerMutation.mutate({ action: "restart", service: svc.key })}
                    disabled={dockerMutation.isPending}
                    title="Reiniciar"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => dockerMutation.mutate({ action: "logs", service: svc.key })}
                    disabled={dockerMutation.isPending}
                    title="Ver logs"
                  >
                    <ScrollText className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Logs Panel */}
        {logsService && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">Logs: {logsService}</span>
              <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => { setLogsService(null); setLogs(""); }}>
                Cerrar
              </Button>
            </div>
            <pre className="text-[9px] font-mono bg-muted/50 border rounded-lg p-3 max-h-48 overflow-auto whitespace-pre-wrap">
              {logs || "Cargando..."}
            </pre>
          </div>
        )}

        {/* Loading indicator */}
        {(isLoading || dockerMutation.isPending) && (
          <div className="flex items-center justify-center py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground ml-2">
              {dockerMutation.isPending ? "Ejecutando..." : "Cargando estado..."}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}