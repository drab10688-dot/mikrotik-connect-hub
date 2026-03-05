import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api-client";
import {
  Radio, RefreshCw, Wifi, Signal, Activity, Cpu, RotateCcw, Eye,
  Users, ArrowUpDown, Clock, Server
} from "lucide-react";

interface AntennaDevice {
  id: string;
  name: string;
  host: string;
  port: number;
  version: string;
  status: string;
}

interface AntennaStatus {
  id: string;
  name: string;
  host: string;
  status: string;
  connected_clients: number;
  signal: number | null;
  noise: number | null;
  ccq: number | null;
  uptime?: string;
  cpu?: number;
  board?: string;
  version?: string;
}

interface WirelessClient {
  mac_address: string;
  interface: string;
  signal_strength: number;
  signal_to_noise: number;
  tx_signal_strength: number;
  noise_floor: number;
  tx_ccq: number;
  rx_ccq: number;
  tx_rate: string;
  rx_rate: string;
  uptime: string;
  last_ip: string;
  distance: number;
  radio_name: string;
}

interface WirelessInterface {
  name: string;
  mode: string;
  ssid: string;
  band: string;
  frequency: string;
  channel_width: string;
  tx_power: string;
  noise_floor: number;
  running: boolean;
  disabled: boolean;
}

interface DeviceDetail {
  device_name: string;
  host: string;
  uptime: string;
  cpu_load: number;
  free_memory: number;
  total_memory: number;
  board_name: string;
  version: string;
  architecture: string;
  wireless_interfaces: WirelessInterface[];
  clients: WirelessClient[];
}

function signalColor(signal: number | null | undefined) {
  if (signal == null) return "text-muted-foreground";
  const abs = Math.abs(signal);
  if (abs <= 60) return "text-green-500";
  if (abs <= 70) return "text-yellow-500";
  if (abs <= 80) return "text-orange-500";
  return "text-red-500";
}

function signalBadge(signal: number | null | undefined) {
  if (signal == null) return <Badge variant="outline">Sin datos</Badge>;
  const abs = Math.abs(signal);
  if (abs <= 60) return <Badge className="bg-green-600">Excelente</Badge>;
  if (abs <= 70) return <Badge className="bg-yellow-600">Buena</Badge>;
  if (abs <= 80) return <Badge className="bg-orange-600">Regular</Badge>;
  return <Badge variant="destructive">Débil</Badge>;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function MikrotikAntennaManager() {
  const [devices, setDevices] = useState<AntennaDevice[]>([]);
  const [statuses, setStatuses] = useState<AntennaStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [detailDevice, setDetailDevice] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<DeviceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet("/antennas/devices");
      setDevices(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadDevices(); }, [loadDevices]);

  const refreshAllStatuses = async () => {
    setRefreshing(true);
    try {
      const data = await apiGet("/antennas/status/all");
      setStatuses(data);
      toast.success("Señales actualizadas");
    } catch {
      toast.error("Error al consultar señales");
    }
    setRefreshing(false);
  };

  const handleReboot = async (id: string, name: string) => {
    if (!confirm(`¿Reiniciar ${name}?`)) return;
    try {
      await apiPost(`/antennas/devices/${id}/reboot`, {});
      toast.success(`${name} reiniciándose...`);
    } catch (e: any) { toast.error(e.message); }
  };

  const handleViewDetail = async (id: string) => {
    setDetailDevice(id);
    setDetailLoading(true);
    setDetailData(null);
    try {
      const data = await apiGet(`/antennas/devices/${id}/wireless`);
      setDetailData(data);
    } catch (e: any) {
      toast.error(`No se pudo conectar: ${e.message}`);
    }
    setDetailLoading(false);
  };

  const getDeviceStatus = (id: string) => statuses.find((s) => s.id === id);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Radio className="h-5 w-5" />
            Antenas MikroTik — Monitoreo Inalámbrico
          </h3>
          <p className="text-sm text-muted-foreground">
            {devices.length} dispositivo{devices.length !== 1 ? "s" : ""} · Señal en tiempo real de enlaces inalámbricos
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refreshAllStatuses} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Consultando..." : "Actualizar Señales"}
          </Button>
        </div>
      </div>

      {/* Device Cards */}
      {loading ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">Cargando dispositivos...</CardContent></Card>
      ) : devices.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <Radio className="h-12 w-12 mx-auto text-muted-foreground/40" />
            <p className="text-muted-foreground">No hay dispositivos MikroTik registrados</p>
            <p className="text-sm text-muted-foreground">Agrega tus antenas en Ajustes → Dispositivos</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {devices.map((dev) => {
            const st = getDeviceStatus(dev.id);

            return (
              <Card key={dev.id} className="relative group">
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Wifi className="h-4 w-4 text-primary" />
                        {st?.name || dev.name}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-1">{dev.host}:{dev.port}</p>
                      {st?.board && <p className="text-xs text-muted-foreground">{st.board}</p>}
                      {st?.version && <p className="text-xs text-muted-foreground">RouterOS {st.version}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {st?.status === "online" ? (
                        <Badge className="bg-green-600 text-xs">Online</Badge>
                      ) : st?.status === "offline" ? (
                        <Badge variant="destructive" className="text-xs">Offline</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">{dev.status}</Badge>
                      )}
                      {st && signalBadge(st.signal)}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Signal Info */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-xs text-muted-foreground">Señal</p>
                      <p className={`text-sm font-bold ${signalColor(st?.signal)}`}>
                        {st?.signal != null ? `${st.signal} dBm` : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Ruido</p>
                      <p className="text-sm font-medium">
                        {st?.noise != null ? `${st.noise} dBm` : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">CCQ</p>
                      <p className="text-sm font-medium">
                        {st?.ccq != null ? `${st.ccq}%` : "—"}
                      </p>
                    </div>
                  </div>

                  {/* Extra info */}
                  <div className="grid grid-cols-2 gap-2 text-center text-xs">
                    {st?.connected_clients != null && (
                      <div className="flex items-center justify-center gap-1 text-muted-foreground">
                        <Users className="h-3 w-3" />
                        {st.connected_clients} cliente{st.connected_clients !== 1 ? "s" : ""}
                      </div>
                    )}
                    {st?.cpu != null && (
                      <div className="flex items-center justify-center gap-1 text-muted-foreground">
                        <Cpu className="h-3 w-3" />
                        CPU {st.cpu}%
                      </div>
                    )}
                  </div>

                  {st?.uptime && (
                    <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1">
                      <Clock className="h-3 w-3" /> {st.uptime}
                    </p>
                  )}

                  {/* Actions */}
                  <div className="flex gap-1 justify-center pt-1">
                    <Button variant="ghost" size="sm" onClick={() => handleViewDetail(dev.id)} title="Ver detalle wireless">
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleReboot(dev.id, dev.name)} title="Reiniciar">
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
      <Dialog open={!!detailDevice} onOpenChange={(o) => !o && setDetailDevice(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Signal className="h-5 w-5" />
              Detalle del Enlace Inalámbrico
            </DialogTitle>
          </DialogHeader>
          {detailLoading ? (
            <div className="py-8 text-center text-muted-foreground">
              <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" />
              Conectando al equipo...
            </div>
          ) : detailData ? (
            <div className="space-y-4">
              {/* System Info */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Server className="h-4 w-4" /> Información del Sistema
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                    <InfoItem label="Nombre" value={detailData.device_name} />
                    <InfoItem label="Host" value={detailData.host} />
                    <InfoItem label="Board" value={detailData.board_name} />
                    <InfoItem label="RouterOS" value={detailData.version} />
                    <InfoItem label="Arquitectura" value={detailData.architecture} />
                    <InfoItem label="Uptime" value={detailData.uptime} />
                    <InfoItem label="CPU" value={`${detailData.cpu_load}%`} />
                    <InfoItem label="RAM" value={`${formatBytes(detailData.free_memory)} / ${formatBytes(detailData.total_memory)}`} />
                  </div>
                </CardContent>
              </Card>

              {/* Wireless Interfaces */}
              {detailData.wireless_interfaces.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Wifi className="h-4 w-4" /> Interfaces Inalámbricas
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {detailData.wireless_interfaces.map((wi, i) => (
                        <div key={i} className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm p-2 rounded bg-muted/30">
                          <InfoItem label="Interfaz" value={wi.name} />
                          <InfoItem label="SSID" value={wi.ssid || "—"} />
                          <InfoItem label="Modo" value={wi.mode} />
                          <InfoItem label="Frecuencia" value={wi.frequency ? `${wi.frequency} MHz` : "—"} />
                          <InfoItem label="Banda" value={wi.band || "—"} />
                          <InfoItem label="Ancho Canal" value={wi.channel_width || "—"} />
                          <InfoItem label="TX Power" value={wi.tx_power || "—"} />
                          <InfoItem label="Estado" value={wi.running ? "✅ Activa" : "❌ Inactiva"} />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Connected Clients */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Clientes Conectados ({detailData.clients.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {detailData.clients.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No hay clientes inalámbricos conectados
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {detailData.clients.map((client, i) => (
                        <div key={i} className="p-3 rounded-lg border bg-card space-y-2">
                          <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2">
                              <Wifi className="h-4 w-4 text-primary" />
                              <span className="text-sm font-medium">{client.radio_name || client.mac_address}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {signalBadge(client.signal_strength)}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                            <div>
                              <span className="text-muted-foreground">Señal: </span>
                              <span className={`font-medium ${signalColor(client.signal_strength)}`}>
                                {client.signal_strength} dBm
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Ruido: </span>
                              <span className="font-medium">{client.noise_floor} dBm</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">CCQ TX: </span>
                              <span className="font-medium">{client.tx_ccq}%</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">CCQ RX: </span>
                              <span className="font-medium">{client.rx_ccq}%</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">TX Rate: </span>
                              <span className="font-medium">{client.tx_rate || "—"}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">RX Rate: </span>
                              <span className="font-medium">{client.rx_rate || "—"}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">IP: </span>
                              <span className="font-medium">{client.last_ip || "—"}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Uptime: </span>
                              <span className="font-medium">{client.uptime || "—"}</span>
                            </div>
                            {client.distance > 0 && (
                              <div>
                                <span className="text-muted-foreground">Distancia: </span>
                                <span className="font-medium">{client.distance} m</span>
                              </div>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">MAC: {client.mac_address} · Interfaz: {client.interface}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            <p className="py-8 text-center text-muted-foreground">No se pudo obtener información del equipo</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-sm">
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium">{value || "—"}</span>
    </div>
  );
}
