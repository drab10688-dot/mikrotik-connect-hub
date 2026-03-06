import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { vpsApi } from "@/lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Container,
  Play,
  Square,
  RefreshCw,
  Loader2,
  HardDrive,
  MemoryStick,
  ScrollText,
  Download,
  ExternalLink,
} from "lucide-react";

interface VpsDockerManagerProps {
  mikrotikId: string | null;
}

interface ContainerInfo {
  status: string;
  ports?: string;
}

interface RawContainerInfo {
  name: string;
  status: string;
  ports?: string;
}

interface VpsStatus {
  containers?: Record<string, ContainerInfo> | RawContainerInfo[];
  containers_map?: Record<string, ContainerInfo>;
  system?: {
    disk?: { total: string; used: string; free: string; percent: string };
    memory?: { total: string; used: string; free: string };
  };
  disk?: string;
  memory?: string;
}

interface ManagedService {
  key: string;
  aliases: string[];
  label: string;
  icon: string;
  desc: string;
  openPath?: string;
}

const SERVICES: ManagedService[] = [
  { key: "api", aliases: ["api", "routeros-proxy", "omnisync-api"], label: "RouterOS API", icon: "🔌", desc: "Proxy REST para MikroTik" },
  { key: "freeradius", aliases: ["freeradius", "radius", "omnisync-freeradius"], label: "FreeRADIUS", icon: "🔐", desc: "Autenticación Hotspot/PPPoE" },
  { key: "mariadb", aliases: ["mariadb", "radius-db", "omnisync-mariadb"], label: "MariaDB", icon: "🗄️", desc: "Base de datos RADIUS" },
  { key: "phpnuxbill", aliases: ["phpnuxbill", "omnisync-phpnuxbill"], label: "PHPNuxBill", icon: "💳", desc: "Facturación ISP", openPath: "/nuxbill/" },
];

const OPTIONAL_SERVICES: ManagedService[] = [
  { key: "cms-cdata", aliases: ["cms-cdata", "omnisync-cms-cdata"], label: "CMS C-Data", icon: "📡", desc: "Gestión OLT/ONU", openPath: "/cms-cdata/" },
  { key: "mikhmon", aliases: ["mikhmon", "omnisync-mikhmon"], label: "Mikhmon", icon: "📶", desc: "Hotspot Monitor", openPath: "/mikhmon/" },
  { key: "wireguard", aliases: ["wireguard", "omnisync-wireguard"], label: "WireGuard VPN", icon: "🔒", desc: "VPN acceso remoto" },
];

const getApiOrigin = () => {
  const stored = localStorage.getItem("vps_api_url");
  if (!stored) return window.location.origin;
  return stored.replace(/\/api\/?$/i, "").replace(/\/$/, "");
};

const normalizeContainers = (status?: VpsStatus): Record<string, ContainerInfo> => {
  const map: Record<string, ContainerInfo> = {};

  const register = (name: string, info: ContainerInfo) => {
    map[name] = info;
    const normalized = name.replace(/^omnisync-/, "");
    map[normalized] = info;
  };

  if (!status) return map;

  if (status.containers_map && typeof status.containers_map === "object") {
    Object.entries(status.containers_map).forEach(([name, info]) => register(name, info));
  }

  if (Array.isArray(status.containers)) {
    status.containers.forEach((container) => register(container.name, { status: container.status, ports: container.ports }));
  } else if (status.containers && typeof status.containers === "object") {
    Object.entries(status.containers).forEach(([name, info]) => register(name, info));
  }

  return map;
};

const getStatusBadge = (containerStatus?: string) => {
  if (containerStatus?.toLowerCase().includes("up") || containerStatus?.toLowerCase().includes("running")) {
    return <Badge variant="outline" className="text-[9px] border-green-500/30 text-green-600">Running</Badge>;
  }
  return <Badge variant="destructive" className="text-[9px]">Stopped</Badge>;
};

export function VpsDockerManager({ mikrotikId }: VpsDockerManagerProps) {
  const queryClient = useQueryClient();
  const [logsService, setLogsService] = useState<string | null>(null);
  const [logs, setLogs] = useState("");

  const { data: status, isLoading } = useQuery<VpsStatus>({
    queryKey: ["vps-status", mikrotikId],
    queryFn: async () => vpsApi.status(mikrotikId!),
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
        setLogs(data?.output || data?.logs || "Sin logs");
        setLogsService(vars.service || "all");
      } else {
        toast.success(data?.message || `Docker ${vars.action} ejecutado`);
      }
    },
    onError: (err: any) => toast.error(err.message),
  });

  const containersByName = useMemo(() => normalizeContainers(status), [status]);

  if (!mikrotikId) return null;

  const diskText = status?.system?.disk
    ? `${status.system.disk.used} / ${status.system.disk.total} (${status.system.disk.percent})`
    : status?.disk;

  const memoryText = status?.system?.memory
    ? `${status.system.memory.used} / ${status.system.memory.total}`
    : status?.memory;

  const openServicePanel = (path: string) => {
    window.open(`${getApiOrigin()}${path}`, "_blank", "noopener,noreferrer");
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
            <CardDescription className="text-[10px]">Gestión de servicios Docker en tu VPS</CardDescription>
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
        {(diskText || memoryText) && (
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2 rounded-lg bg-muted/50 border">
              <div className="flex items-center gap-1.5 mb-1">
                <HardDrive className="h-3 w-3 text-muted-foreground" />
                <span className="text-[10px] font-medium">Disco</span>
              </div>
              <p className="text-xs font-mono">{diskText || "N/D"}</p>
            </div>
            <div className="p-2 rounded-lg bg-muted/50 border">
              <div className="flex items-center gap-1.5 mb-1">
                <MemoryStick className="h-3 w-3 text-muted-foreground" />
                <span className="text-[10px] font-medium">RAM</span>
              </div>
              <p className="text-xs font-mono">{memoryText || "N/D"}</p>
            </div>
          </div>
        )}

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

        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Servicios principales</p>
          {SERVICES.map((svc) => {
            const container = svc.aliases.map((alias) => containersByName[alias]).find(Boolean);

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
                  {svc.openPath && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] px-2"
                      onClick={() => openServicePanel(svc.openPath!)}
                    >
                      <ExternalLink className="h-3 w-3 mr-1" />
                      Abrir
                    </Button>
                  )}
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

        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Servicios opcionales</p>
          {OPTIONAL_SERVICES.map((svc) => {
            const container = svc.aliases.map((alias) => containersByName[alias]).find(Boolean);
            const isRunning = container?.status?.toLowerCase().includes("up") || container?.status?.toLowerCase().includes("running");

            return (
              <div key={svc.key} className="flex items-center gap-2 p-2 rounded-lg border bg-card hover:bg-muted/30 transition-colors">
                <span className="text-sm">{svc.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">{svc.label}</span>
                    {container ? getStatusBadge(container.status) : (
                      <Badge variant="outline" className="text-[9px] text-muted-foreground">No instalado</Badge>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate">{svc.desc}</p>
                </div>
                <div className="flex gap-1">
                  {isRunning ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-6 text-[10px] px-2"
                      onClick={() => dockerMutation.mutate({ action: "stop", service: svc.key })}
                      disabled={dockerMutation.isPending}
                    >
                      <Square className="h-3 w-3 mr-1" />
                      Detener
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="default"
                      className="h-6 text-[10px] px-2"
                      onClick={() => dockerMutation.mutate({ action: "up", service: svc.key })}
                      disabled={dockerMutation.isPending}
                    >
                      <Play className="h-3 w-3 mr-1" />
                      Iniciar
                    </Button>
                  )}
                  {svc.openPath && isRunning && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] px-2"
                      onClick={() => openServicePanel(svc.openPath!)}
                    >
                      <ExternalLink className="h-3 w-3 mr-1" />
                      Abrir
                    </Button>
                  )}
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
