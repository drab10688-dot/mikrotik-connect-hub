import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api-client";
import {
  Radio, RefreshCw, Wifi, Signal, Activity, Cpu, RotateCcw, Eye,
  Users, Clock, Server, Filter, AlertTriangle
} from "lucide-react";

// ─── Types ──────────────────────────────────────
interface UnifiedAntenna {
  id: string;
  name: string;
  host: string;
  brand: "mikrotik" | "ubiquiti" | "unknown";
  // Status fields
  status?: "online" | "offline" | "no_credentials" | "pending";
  signal?: number | null;
  noise?: number | null;
  ccq?: number | null;
  uptime?: string;
  cpu?: number;
  connected_clients?: number;
  board?: string;
  version?: string;
  model?: string;
  // Ubiquiti specific
  ubiquiti_id?: string;
  last_seen?: string | null;
  client_name?: string;
}

// ─── Helpers ────────────────────────────────────
const brandConfig = {
  mikrotik: { label: "MikroTik", color: "bg-sky-600", icon: "🔵" },
  ubiquiti: { label: "Ubiquiti", color: "bg-emerald-600", icon: "🟢" },
  unknown: { label: "Otro", color: "bg-muted", icon: "⚪" },
};

function signalColor(signal: number | null | undefined) {
  if (signal == null) return "text-muted-foreground";
  const abs = Math.abs(signal);
  if (abs <= 60) return "text-green-500";
  if (abs <= 70) return "text-yellow-500";
  if (abs <= 80) return "text-orange-500";
  return "text-red-500";
}

function signalQuality(signal: number | null | undefined): string {
  if (signal == null) return "unknown";
  const abs = Math.abs(signal);
  if (abs <= 60) return "excellent";
  if (abs <= 70) return "good";
  if (abs <= 80) return "fair";
  return "poor";
}

function signalBadge(signal: number | null | undefined) {
  const q = signalQuality(signal);
  if (q === "unknown") return <Badge variant="outline" className="text-xs">Sin datos</Badge>;
  if (q === "excellent") return <Badge className="bg-green-600 text-xs">Excelente</Badge>;
  if (q === "good") return <Badge className="bg-yellow-600 text-xs">Buena</Badge>;
  if (q === "fair") return <Badge className="bg-orange-600 text-xs">Regular</Badge>;
  return <Badge variant="destructive" className="text-xs">Débil</Badge>;
}

export function AntennasDashboard() {
  const [antennas, setAntennas] = useState<UnifiedAntenna[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [detailAntenna, setDetailAntenna] = useState<UnifiedAntenna | null>(null);
  const [detailData, setDetailData] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const unified: UnifiedAntenna[] = [];

    // Load MikroTik devices
    try {
      const mkDevices = await apiGet("/antennas/devices");
      for (const d of mkDevices) {
        unified.push({
          id: d.id,
          name: d.name,
          host: d.host,
          brand: "mikrotik",
          status: d.status === "active" ? undefined : "pending",
          version: d.version,
        });
      }
    } catch { /* ignore */ }

    // Load Ubiquiti devices
    try {
      const ubDevices = await apiGet("/ubiquiti/devices");
      for (const d of ubDevices) {
        unified.push({
          id: `ub-${d.id}`,
          ubiquiti_id: d.id,
          name: d.name,
          host: d.ip_address,
          brand: "ubiquiti",
          model: d.model,
          signal: d.last_signal,
          noise: d.last_noise,
          ccq: d.last_ccq,
          last_seen: d.last_seen,
          client_name: d.client_name,
        });
      }
    } catch { /* ignore */ }

    setAntennas(unified);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const refreshAllStatuses = async () => {
    setRefreshing(true);

    // Refresh MikroTik
    try {
      const mkStatuses = await apiGet("/antennas/status/all");
      setAntennas((prev) =>
        prev.map((a) => {
          if (a.brand !== "mikrotik") return a;
          const st = mkStatuses.find((s: any) => s.id === a.id);
          if (!st) return a;
          return {
            ...a,
            status: st.status,
            signal: st.signal,
            noise: st.noise,
            ccq: st.ccq,
            uptime: st.uptime,
            cpu: st.cpu,
            connected_clients: st.connected_clients,
            board: st.board,
            version: st.version || a.version,
            name: st.name || a.name,
          };
        })
      );
    } catch { /* ignore */ }

    // Refresh Ubiquiti
    try {
      const ubStatuses = await apiGet("/ubiquiti/devices/status/all");
      setAntennas((prev) =>
        prev.map((a) => {
          if (a.brand !== "ubiquiti") return a;
          const st = ubStatuses.find((s: any) => `ub-${s.id}` === a.id);
          if (!st) return a;
          return {
            ...a,
            status: st.status,
            signal: st.signal,
            noise: st.noise,
            ccq: st.ccq,
            uptime: st.uptime,
            cpu: st.cpu,
          };
        })
      );
    } catch { /* ignore */ }

    toast.success("Señales actualizadas");
    setRefreshing(false);
  };

  const handleReboot = async (antenna: UnifiedAntenna) => {
    if (!confirm(`¿Reiniciar ${antenna.name}?`)) return;
    try {
      if (antenna.brand === "mikrotik") {
        await apiPost(`/antennas/devices/${antenna.id}/reboot`, {});
      } else if (antenna.brand === "ubiquiti" && antenna.ubiquiti_id) {
        await apiPost(`/ubiquiti/devices/${antenna.ubiquiti_id}/reboot`, {});
      }
      toast.success(`${antenna.name} reiniciándose...`);
    } catch (e: any) { toast.error(e.message); }
  };

  const handleViewDetail = async (antenna: UnifiedAntenna) => {
    setDetailAntenna(antenna);
    setDetailLoading(true);
    setDetailData(null);
    try {
      if (antenna.brand === "mikrotik") {
        const data = await apiGet(`/antennas/devices/${antenna.id}/wireless`);
        setDetailData({ ...data, brand: "mikrotik" });
      } else if (antenna.brand === "ubiquiti" && antenna.ubiquiti_id) {
        const data = await apiGet(`/ubiquiti/devices/${antenna.ubiquiti_id}/status`);
        setDetailData({ ...data, brand: "ubiquiti" });
      }
    } catch (e: any) {
      toast.error(`No se pudo conectar: ${e.message}`);
    }
    setDetailLoading(false);
  };

  // Filter
  const filtered = brandFilter === "all"
    ? antennas
    : antennas.filter((a) => a.brand === brandFilter);

  // Counts
  const mkCount = antennas.filter((a) => a.brand === "mikrotik").length;
  const ubCount = antennas.filter((a) => a.brand === "ubiquiti").length;
  const onlineCount = antennas.filter((a) => a.status === "online").length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Radio className="h-5 w-5" />
            Monitoreo de Antenas
          </h3>
          <p className="text-sm text-muted-foreground">
            {antennas.length} antena{antennas.length !== 1 ? "s" : ""}
            {mkCount > 0 && ` · ${mkCount} MikroTik`}
            {ubCount > 0 && ` · ${ubCount} Ubiquiti`}
            {onlineCount > 0 && ` · ${onlineCount} online`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <Select value={brandFilter} onValueChange={setBrandFilter}>
            <SelectTrigger className="w-[150px] h-8">
              <Filter className="h-3 w-3 mr-1" />
              <SelectValue placeholder="Filtrar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="mikrotik">🔵 MikroTik</SelectItem>
              <SelectItem value="ubiquiti">🟢 Ubiquiti</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={refreshAllStatuses} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Consultando..." : "Actualizar Señales"}
          </Button>
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">Cargando antenas...</CardContent></Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <Radio className="h-12 w-12 mx-auto text-muted-foreground/40" />
            <p className="text-muted-foreground">No hay antenas registradas</p>
            <p className="text-sm text-muted-foreground">
              MikroTik: Ajustes → Dispositivos · Ubiquiti: pestaña Ubiquiti
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((ant) => {
            const bc = brandConfig[ant.brand];
            return (
              <Card key={ant.id} className="relative group">
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div className="space-y-1">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Wifi className="h-4 w-4 text-primary" />
                        {ant.name}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">{ant.host}</p>
                      {ant.model && <p className="text-xs text-muted-foreground">{ant.model}</p>}
                      {ant.board && <p className="text-xs text-muted-foreground">{ant.board}</p>}
                      {ant.client_name && <p className="text-xs text-muted-foreground">👤 {ant.client_name}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {/* Brand Badge */}
                      <Badge className={`${bc.color} text-xs text-white`}>
                        {bc.icon} {bc.label}
                      </Badge>
                      {/* Status */}
                      {ant.status === "online" ? (
                        <Badge className="bg-green-600 text-xs">Online</Badge>
                      ) : ant.status === "offline" ? (
                        <Badge variant="destructive" className="text-xs">Offline</Badge>
                      ) : ant.status === "no_credentials" ? (
                        <Badge variant="outline" className="text-xs">Sin cred.</Badge>
                      ) : null}
                      {/* Signal */}
                      {signalBadge(ant.signal)}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Signal Grid */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-xs text-muted-foreground">Señal</p>
                      <p className={`text-sm font-bold ${signalColor(ant.signal)}`}>
                        {ant.signal != null ? `${ant.signal} dBm` : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Ruido</p>
                      <p className="text-sm font-medium">
                        {ant.noise != null ? `${ant.noise} dBm` : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">CCQ</p>
                      <p className="text-sm font-medium">
                        {ant.ccq != null ? `${ant.ccq}%` : "—"}
                      </p>
                    </div>
                  </div>

                  {/* Extra info row */}
                  <div className="flex justify-center gap-4 text-xs text-muted-foreground">
                    {ant.connected_clients != null && (
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" /> {ant.connected_clients}
                      </span>
                    )}
                    {ant.cpu != null && (
                      <span className="flex items-center gap-1">
                        <Cpu className="h-3 w-3" /> {ant.cpu}%
                      </span>
                    )}
                    {ant.uptime && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {ant.uptime}
                      </span>
                    )}
                    {ant.version && (
                      <span>v{ant.version}</span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-1 justify-center pt-1">
                    <Button variant="ghost" size="sm" onClick={() => handleViewDetail(ant)} title="Ver detalle">
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleReboot(ant)} title="Reiniciar">
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!detailAntenna} onOpenChange={(o) => !o && setDetailAntenna(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Signal className="h-5 w-5" />
              {detailAntenna?.name} — Detalle del Enlace
              {detailAntenna && (
                <Badge className={`${brandConfig[detailAntenna.brand].color} text-white ml-2`}>
                  {brandConfig[detailAntenna.brand].label}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {detailLoading ? (
            <div className="py-8 text-center text-muted-foreground">
              <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" />
              Conectando al equipo...
            </div>
          ) : detailData?.brand === "mikrotik" ? (
            <MikrotikDetail data={detailData} />
          ) : detailData?.brand === "ubiquiti" ? (
            <UbiquitiDetail data={detailData} />
          ) : (
            <p className="py-8 text-center text-muted-foreground">No se pudo obtener información</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── MikroTik Detail View ───────────────────────
function MikrotikDetail({ data }: { data: any }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Server className="h-4 w-4" /> Sistema</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
            <Info label="Nombre" value={data.device_name} />
            <Info label="Board" value={data.board_name} />
            <Info label="RouterOS" value={data.version} />
            <Info label="Uptime" value={data.uptime} />
            <Info label="CPU" value={`${data.cpu_load}%`} />
            <Info label="RAM" value={`${formatB(data.free_memory)} / ${formatB(data.total_memory)}`} />
          </div>
        </CardContent>
      </Card>

      {data.wireless_interfaces?.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Wifi className="h-4 w-4" /> Interfaces Wireless</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.wireless_interfaces.map((w: any, i: number) => (
              <div key={i} className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm p-2 rounded bg-muted/30">
                <Info label="Interfaz" value={w.name} />
                <Info label="SSID" value={w.ssid} />
                <Info label="Modo" value={w.mode} />
                <Info label="Frecuencia" value={w.frequency ? `${w.frequency} MHz` : "—"} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="h-4 w-4" /> Clientes Conectados ({data.clients?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!data.clients?.length ? (
            <p className="text-sm text-muted-foreground text-center py-4">Sin clientes wireless</p>
          ) : (
            <div className="space-y-2">
              {data.clients.map((c: any, i: number) => (
                <div key={i} className="p-3 rounded-lg border bg-card space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium flex items-center gap-2">
                      <Wifi className="h-4 w-4 text-primary" />
                      {c.radio_name || c.mac_address}
                    </span>
                    {signalBadge(c.signal_strength)}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <span><span className="text-muted-foreground">Señal:</span> <span className={`font-medium ${signalColor(c.signal_strength)}`}>{c.signal_strength} dBm</span></span>
                    <span><span className="text-muted-foreground">Ruido:</span> <span className="font-medium">{c.noise_floor} dBm</span></span>
                    <span><span className="text-muted-foreground">CCQ TX:</span> <span className="font-medium">{c.tx_ccq}%</span></span>
                    <span><span className="text-muted-foreground">TX:</span> <span className="font-medium">{c.tx_rate || "—"}</span></span>
                    <span><span className="text-muted-foreground">RX:</span> <span className="font-medium">{c.rx_rate || "—"}</span></span>
                    <span><span className="text-muted-foreground">IP:</span> <span className="font-medium">{c.last_ip || "—"}</span></span>
                    <span><span className="text-muted-foreground">Uptime:</span> <span className="font-medium">{c.uptime || "—"}</span></span>
                    {c.distance > 0 && <span><span className="text-muted-foreground">Dist:</span> <span className="font-medium">{c.distance}m</span></span>}
                  </div>
                  <p className="text-xs text-muted-foreground">MAC: {c.mac_address}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Ubiquiti Detail View ───────────────────────
function UbiquitiDetail({ data }: { data: any }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <InfoCard icon={<Wifi />} label="Dispositivo" value={data.device_name} />
        <InfoCard icon={<Activity />} label="Firmware" value={data.firmware} />
        <InfoCard icon={<Signal />} label="Señal" value={data.signal != null ? `${data.signal} dBm` : "N/A"} color={signalColor(data.signal)} />
        <InfoCard icon={<Signal />} label="Ruido" value={data.noise != null ? `${data.noise} dBm` : "N/A"} />
        <InfoCard icon={<Activity />} label="CCQ" value={data.ccq != null ? `${Math.round(data.ccq / 10)}%` : "N/A"} />
        <InfoCard icon={<Radio />} label="Frecuencia" value={data.frequency ? `${data.frequency} MHz` : "N/A"} />
        <InfoCard icon={<Activity />} label="TX Rate" value={data.tx_rate ? `${data.tx_rate} Mbps` : "N/A"} />
        <InfoCard icon={<Activity />} label="RX Rate" value={data.rx_rate ? `${data.rx_rate} Mbps` : "N/A"} />
        <InfoCard icon={<Cpu />} label="CPU" value={data.cpu != null ? `${data.cpu}%` : "N/A"} />
        {data.temperature != null && <InfoCard icon={<Activity />} label="Temp" value={`${data.temperature}°C`} />}
        {data.distance != null && <InfoCard icon={<Activity />} label="Distancia" value={`${data.distance} m`} />}
        {data.tx_power != null && <InfoCard icon={<Signal />} label="TX Power" value={`${data.tx_power} dBm`} />}
      </div>
      <p className="text-xs text-muted-foreground text-center">Uptime: {data.uptime}</p>
    </div>
  );
}

// ─── Shared Components ──────────────────────────
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-sm">
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium">{value || "—"}</span>
    </div>
  );
}

function InfoCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm p-2 rounded bg-muted/30">
      <span className="text-muted-foreground h-4 w-4 shrink-0">{icon}</span>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`font-medium ${color || ""}`}>{value}</p>
      </div>
    </div>
  );
}

function formatB(bytes: number): string {
  if (!bytes) return "0";
  const k = 1024;
  const s = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + s[i];
}
