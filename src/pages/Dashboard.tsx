import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api-client";
import { useAuth } from "@/hooks/useAuth";
import { useModuleEnabled } from "@/hooks/useTenantBranding";
import { useMyPermissions } from "@/hooks/usePermissions";
import KpiCard, { KpiTone } from "@/components/dashboard/KpiCard";
import OpticalMeter from "@/components/onu/OpticalMeter";
import { Antenna, Wifi, Server, Settings, Activity, SignalHigh, SignalLow, RefreshCw } from "lucide-react";


interface OverviewEntry {
  deviceId: string;
  manufacturer: string;
  model: string;
  serial: string;
  rxPower: number | null;
  txPower: number | null;
  alias: string | null;
  pppoeUsername: string | null;
  activeSsids?: string[];
  lastInform: string | null;
  informInterval?: number | null;
}

const MIN_OFFLINE_MS = 5 * 60 * 1000;
const GRACE_MS = 90 * 1000;

const offlineThreshold = (informInterval?: number | null) => {
  const interval = Number(informInterval);
  if (!Number.isFinite(interval) || interval <= 0) return MIN_OFFLINE_MS;
  return Math.max(MIN_OFFLINE_MS, interval * 2 * 1000 + GRACE_MS);
};

const isOffline = (d: { lastInform: string | null; informInterval?: number | null }) => {
  if (!d?.lastInform) return true;
  const t = new Date(d.lastInform).getTime();
  if (!Number.isFinite(t)) return true;
  return Date.now() - t > offlineThreshold(d.informInterval);
};

const sinceLabel = (lastInform: string | null) => {
  if (!lastInform) return "sin reportes";
  const diff = Date.now() - new Date(lastInform).getTime();
  if (!Number.isFinite(diff)) return "sin reportes";
  const min = Math.floor(diff / 60000);
  if (min < 60) return `hace ${Math.max(min, 1)} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
};

const Dashboard = () => {
  const navigate = useNavigate();
  const { isSuperAdmin } = useAuth();
  const { isEnabled } = useModuleEnabled();
  const { can } = useMyPermissions();
  const onusEnabled = isSuperAdmin || (isEnabled("onus") && can("onus"));

  useEffect(() => {
    if (isSuperAdmin) navigate("/admin/isps", { replace: true });
  }, [isSuperAdmin, navigate]);

  const [devices, setDevices] = useState<OverviewEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [acsOnline, setAcsOnline] = useState<boolean | null>(null);

  const load = useCallback(async (spinner = true) => {
    if (!onusEnabled) { setLoading(false); return; }
    if (spinner) setLoading(true);
    try {
      const res = await api("/genieacs/overview");
      const list: OverviewEntry[] = Array.isArray(res) ? res : (res?.data || []);
      setDevices(list);
      setAcsOnline(true);
    } catch {
      setAcsOnline(false);
    } finally {
      if (spinner) setLoading(false);
    }
  }, [onusEnabled]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = window.setInterval(() => load(false), 10000);
    return () => window.clearInterval(t);
  }, [load]);

  const online = devices.filter((d) => !isOffline(d));
  const offline = devices.length - online.length;
  const critical = devices.filter((d) => d.rxPower !== null && d.rxPower <= -28);
  const withWifi = devices.filter((d) => (d.activeSsids?.length || 0) > 0);

  const stats: { label: string; value: number; icon: typeof Antenna; tone: KpiTone; hint?: string }[] = [
    { label: "Total registradas", value: devices.length, icon: Antenna, tone: "neutral" },
    { label: "En línea", value: online.length, icon: Activity, tone: "success" },
    { label: "Desconectadas", value: offline, icon: SignalLow, tone: "danger" },
    { label: "Señal crítica", value: critical.length, icon: SignalHigh, tone: "warning", hint: "≤ −28 dBm" },
    { label: "Wi-Fi activo", value: withWifi.length, icon: Wifi, tone: "info" },
  ];


  const quickActions = [
    onusEnabled && { title: "Gestión de ONUs", description: "Señal, WiFi, PPPoE y alias", icon: Antenna, path: "/onus" },
    (isSuperAdmin || can("mikrotik")) && isEnabled("mikrotik") && { title: "Conexión MikroTik", description: "PPPoE, cableado y sesiones", icon: Server, path: "/mikrotik" },
    (isSuperAdmin || can("vpn")) && { title: "Credenciales y VPN", description: "Datos TR-069, STUN y script MikroTik", icon: Server, path: "/acs" },
    (isSuperAdmin || can("configuracion")) && { title: "Configuración", description: "Ajustes del panel", icon: Settings, path: "/settings" },
  ].filter(Boolean) as { title: string; description: string; icon: typeof Antenna; path: string }[];

  const recent = [...devices]
    .sort((a, b) => new Date(b.lastInform || 0).getTime() - new Date(a.lastInform || 0).getTime())
    .slice(0, 8);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="p-4 md:p-8 md:ml-64">
        <header className="mb-6 md:mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-foreground">Panel OmniACS</h1>
            <p className="text-muted-foreground">Monitoreo y gestión de ONUs por TR-069</p>
          </div>
          <div className="flex items-center gap-3">
            {onusEnabled && (
            <Badge variant={acsOnline === false ? "destructive" : "secondary"}>
              ACS {acsOnline === false ? "sin conexión" : acsOnline ? "en línea" : "…"}
            </Badge>
            )}
            {onusEnabled && (
            <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Actualizar
            </Button>
            )}
          </div>
        </header>

        {onusEnabled && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
          {stats.map((s) => (
            <KpiCard
              key={s.label}
              label={s.label}
              value={s.value}
              icon={s.icon}
              tone={s.tone}
              hint={s.hint}
              loading={loading}
              onClick={() => navigate("/onus")}
            />
          ))}
        </div>
        )}


        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Accesos rápidos</CardTitle>
            <CardDescription>Operaciones frecuentes</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {quickActions.map((action) => (
                <Button
                  key={action.path}
                  variant="outline"
                  className="h-auto p-6 flex flex-col items-center gap-3 hover:border-primary"
                  onClick={() => navigate(action.path)}
                >
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <action.icon className="w-6 h-6 text-primary" />
                  </div>
                  <div className="text-center">
                    <p className="font-semibold">{action.title}</p>
                    <p className="text-xs text-muted-foreground mt-1">{action.description}</p>
                  </div>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {onusEnabled && (
        <Card>
          <CardHeader>
            <CardTitle>Actividad reciente de ONUs</CardTitle>
            <CardDescription>Últimos reportes TR-069 recibidos</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground">Cargando…</p>
            ) : recent.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                Aún no hay ONUs reportando al ACS. Genera el script en TR-069 y VPN.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ONU</TableHead>
                    <TableHead>PPPoE</TableHead>
                    <TableHead>WiFi</TableHead>
                    <TableHead className="min-w-[150px]">Potencia óptica</TableHead>
                    <TableHead className="text-right">Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.map((d) => (
                    <TableRow
                      key={d.deviceId}
                      className="cursor-pointer"
                      onClick={() => navigate("/onus")}
                    >
                      <TableCell>
                        <div className="font-medium">{d.alias || d.pppoeUsername || d.serial}</div>
                        <div className="text-xs text-muted-foreground">
                          {d.manufacturer} {d.model}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{d.pppoeUsername || "—"}</TableCell>
                      <TableCell className="text-xs">
                        {d.activeSsids?.length ? d.activeSsids.join(" · ") : "—"}
                      </TableCell>
                      <TableCell>
                        <OpticalMeter compact rx={d.rxPower} tx={d.txPower} dimmed={isOffline(d)} />
                      </TableCell>

                      <TableCell className="text-right">
                        {isOffline(d) ? (
                          <Badge variant="destructive">Desconectada</Badge>
                        ) : (
                          <Badge variant="secondary">{sinceLabel(d.lastInform)}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
