import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { toast } from "sonner";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api-client";
import {
  Radio, Plus, RefreshCw, Settings2, Trash2, Edit, Power, Signal,
  Wifi, Activity, Thermometer, Cpu, RotateCcw, Eye, AlertTriangle
} from "lucide-react";

interface UbiquitiDevice {
  id: string;
  name: string;
  ip_address: string;
  username: string | null;
  password: string | null;
  model: string | null;
  mac_address: string | null;
  client_id: string | null;
  client_name?: string;
  notes: string | null;
  last_signal: number | null;
  last_noise: number | null;
  last_ccq: number | null;
  last_seen: string | null;
  created_at: string;
}

interface DeviceStatus {
  id: string;
  name: string;
  status: string;
  signal?: number;
  noise?: number;
  ccq?: number;
  uptime?: string;
  cpu?: number;
  last_signal?: number;
  last_noise?: number;
  last_ccq?: number;
  last_seen?: string;
}

interface DetailedStatus {
  device_name: string;
  firmware: string;
  uptime: string;
  signal: number | null;
  rssi: number | null;
  noise: number | null;
  ccq: number | null;
  tx_rate: number | null;
  rx_rate: number | null;
  frequency: number | null;
  channel_width: number | null;
  distance: number | null;
  tx_power: number | null;
  cpu: number | null;
  mem_total: number | null;
  mem_free: number | null;
  temperature: number | null;
}

interface GlobalConfig {
  id?: string;
  default_username: string;
}

const emptyDevice = { name: "", ip_address: "", username: "", password: "", model: "", mac_address: "", client_id: "", notes: "" };

function signalColor(signal: number | null | undefined) {
  if (signal == null) return "text-muted-foreground";
  if (signal >= -60) return "text-green-500";
  if (signal >= -70) return "text-yellow-500";
  if (signal >= -80) return "text-orange-500";
  return "text-red-500";
}

function signalBadge(signal: number | null | undefined) {
  if (signal == null) return <Badge variant="outline">Sin datos</Badge>;
  if (signal >= -60) return <Badge className="bg-green-600">Excelente</Badge>;
  if (signal >= -70) return <Badge className="bg-yellow-600">Buena</Badge>;
  if (signal >= -80) return <Badge className="bg-orange-600">Regular</Badge>;
  return <Badge variant="destructive">Débil</Badge>;
}

export function UbiquitiManager() {
  const [devices, setDevices] = useState<UbiquitiDevice[]>([]);
  const [statuses, setStatuses] = useState<DeviceStatus[]>([]);
  const [globalConfig, setGlobalConfig] = useState<GlobalConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [editDevice, setEditDevice] = useState<UbiquitiDevice | null>(null);
  const [detailDevice, setDetailDevice] = useState<string | null>(null);
  const [detailStatus, setDetailStatus] = useState<DetailedStatus | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [form, setForm] = useState(emptyDevice);
  const [configForm, setConfigForm] = useState({ default_username: "ubnt", default_password: "" });

  const loadDevices = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet("/ubiquiti/devices");
      setDevices(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const data = await apiGet("/ubiquiti/config");
      if (data) {
        setGlobalConfig(data);
        setConfigForm({ default_username: data.default_username || "ubnt", default_password: "" });
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadDevices();
    loadConfig();
  }, [loadDevices, loadConfig]);

  const refreshAllStatuses = async () => {
    setRefreshing(true);
    try {
      const data = await apiGet("/ubiquiti/devices/status/all");
      setStatuses(data);
      toast.success("Señales actualizadas");
    } catch {
      toast.error("Error al consultar señales");
    }
    setRefreshing(false);
  };

  const handleAdd = async () => {
    if (!form.name || !form.ip_address) { toast.error("Nombre e IP son requeridos"); return; }
    try {
      await apiPost("/ubiquiti/devices", form);
      toast.success("Equipo agregado");
      setShowAddDialog(false);
      setForm(emptyDevice);
      loadDevices();
    } catch (e: any) { toast.error(e.message); }
  };

  const handleEdit = async () => {
    if (!editDevice) return;
    try {
      await apiPut(`/ubiquiti/devices/${editDevice.id}`, form);
      toast.success("Equipo actualizado");
      setEditDevice(null);
      setForm(emptyDevice);
      loadDevices();
    } catch (e: any) { toast.error(e.message); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este equipo?")) return;
    try {
      await apiDelete(`/ubiquiti/devices/${id}`);
      toast.success("Equipo eliminado");
      loadDevices();
    } catch (e: any) { toast.error(e.message); }
  };

  const handleReboot = async (id: string, name: string) => {
    if (!confirm(`¿Reiniciar ${name}?`)) return;
    try {
      await apiPost(`/ubiquiti/devices/${id}/reboot`, {});
      toast.success(`${name} reiniciándose...`);
    } catch (e: any) { toast.error(e.message); }
  };

  const handleViewDetail = async (id: string) => {
    setDetailDevice(id);
    setDetailLoading(true);
    setDetailStatus(null);
    try {
      const data = await apiGet(`/ubiquiti/devices/${id}/status`);
      setDetailStatus(data);
    } catch (e: any) {
      toast.error(e.message);
    }
    setDetailLoading(false);
  };

  const handleSaveConfig = async () => {
    if (!configForm.default_username || !configForm.default_password) {
      toast.error("Usuario y contraseña son requeridos");
      return;
    }
    try {
      await apiPut("/ubiquiti/config", configForm);
      toast.success("Credenciales globales guardadas");
      setShowConfigDialog(false);
      loadConfig();
    } catch (e: any) { toast.error(e.message); }
  };

  const getDeviceStatus = (id: string) => statuses.find((s) => s.id === id);

  const openEdit = (dev: UbiquitiDevice) => {
    setEditDevice(dev);
    setForm({
      name: dev.name,
      ip_address: dev.ip_address,
      username: dev.username || "",
      password: dev.password || "",
      model: dev.model || "",
      mac_address: dev.mac_address || "",
      client_id: dev.client_id || "",
      notes: dev.notes || "",
    });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Radio className="h-5 w-5" />
            Equipos Ubiquiti airOS
          </h3>
          <p className="text-sm text-muted-foreground">
            {devices.length} equipo{devices.length !== 1 ? "s" : ""} registrado{devices.length !== 1 ? "s" : ""}
            {globalConfig ? " · Credenciales globales configuradas" : ""}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setShowConfigDialog(true)}>
            <Settings2 className="h-4 w-4 mr-1" /> Credenciales Globales
          </Button>
          <Button variant="outline" size="sm" onClick={refreshAllStatuses} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Consultando..." : "Actualizar Señales"}
          </Button>
          <Button size="sm" onClick={() => { setForm(emptyDevice); setShowAddDialog(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Agregar Equipo
          </Button>
        </div>
      </div>

      {/* Device List */}
      {loading ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">Cargando equipos...</CardContent></Card>
      ) : devices.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <Radio className="h-12 w-12 mx-auto text-muted-foreground/40" />
            <p className="text-muted-foreground">No hay equipos Ubiquiti registrados</p>
            <p className="text-sm text-muted-foreground">Configura las credenciales globales y agrega tus antenas</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {devices.map((dev) => {
            const st = getDeviceStatus(dev.id);
            const sig = st?.signal ?? dev.last_signal;
            const noise = st?.noise ?? dev.last_noise;
            const ccq = st?.ccq ?? dev.last_ccq;

            return (
              <Card key={dev.id} className="relative group">
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Wifi className="h-4 w-4 text-primary" />
                        {dev.name}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-1">{dev.ip_address}</p>
                      {dev.model && <p className="text-xs text-muted-foreground">{dev.model}</p>}
                      {dev.client_name && (
                        <p className="text-xs text-muted-foreground mt-1">👤 {dev.client_name}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {st?.status === "online" ? (
                        <Badge className="bg-green-600 text-xs">Online</Badge>
                      ) : st?.status === "offline" ? (
                        <Badge variant="destructive" className="text-xs">Offline</Badge>
                      ) : st?.status === "no_credentials" ? (
                        <Badge variant="outline" className="text-xs">Sin credenciales</Badge>
                      ) : null}
                      {signalBadge(sig)}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Signal Info */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-xs text-muted-foreground">Señal</p>
                      <p className={`text-sm font-bold ${signalColor(sig)}`}>
                        {sig != null ? `${sig} dBm` : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Ruido</p>
                      <p className="text-sm font-medium">
                        {noise != null ? `${noise} dBm` : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">CCQ</p>
                      <p className="text-sm font-medium">
                        {ccq != null ? `${ccq}%` : "—"}
                      </p>
                    </div>
                  </div>

                  {st?.uptime && (
                    <p className="text-xs text-muted-foreground text-center">Uptime: {st.uptime}</p>
                  )}

                  {/* Actions */}
                  <div className="flex gap-1 justify-center pt-1">
                    <Button variant="ghost" size="sm" onClick={() => handleViewDetail(dev.id)} title="Ver detalle">
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(dev)} title="Editar">
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleReboot(dev.id, dev.name)} title="Reiniciar">
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(dev.id)} title="Eliminar" className="text-destructive hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  {!dev.username && !globalConfig && (
                    <div className="flex items-center gap-1 text-xs text-orange-500 justify-center">
                      <AlertTriangle className="h-3 w-3" />
                      Sin credenciales
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add Device Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Agregar Equipo Ubiquiti</DialogTitle></DialogHeader>
          <DeviceForm form={form} setForm={setForm} />
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={handleAdd}>Agregar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Device Dialog */}
      <Dialog open={!!editDevice} onOpenChange={(o) => !o && setEditDevice(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar Equipo</DialogTitle></DialogHeader>
          <DeviceForm form={form} setForm={setForm} />
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={handleEdit}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Global Config Dialog */}
      <Dialog open={showConfigDialog} onOpenChange={setShowConfigDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Credenciales Globales Ubiquiti</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Se usarán para todos los equipos que no tengan credenciales propias.
          </p>
          <div className="space-y-3">
            <div>
              <Label>Usuario por defecto</Label>
              <Input
                value={configForm.default_username}
                onChange={(e) => setConfigForm({ ...configForm, default_username: e.target.value })}
                placeholder="ubnt"
              />
            </div>
            <div>
              <Label>Contraseña por defecto</Label>
              <Input
                type="password"
                value={configForm.default_password}
                onChange={(e) => setConfigForm({ ...configForm, default_password: e.target.value })}
                placeholder="Contraseña"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={handleSaveConfig}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Status Dialog */}
      <Dialog open={!!detailDevice} onOpenChange={(o) => !o && setDetailDevice(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Detalle del Enlace</DialogTitle>
          </DialogHeader>
          {detailLoading ? (
            <div className="py-8 text-center text-muted-foreground">
              <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" />
              Conectando al equipo...
            </div>
          ) : detailStatus ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <InfoItem icon={<Wifi />} label="Dispositivo" value={detailStatus.device_name} />
                <InfoItem icon={<Activity />} label="Firmware" value={detailStatus.firmware} />
                <InfoItem icon={<Signal />} label="Señal" value={detailStatus.signal != null ? `${detailStatus.signal} dBm` : "N/A"} color={signalColor(detailStatus.signal)} />
                <InfoItem icon={<Signal />} label="Ruido" value={detailStatus.noise != null ? `${detailStatus.noise} dBm` : "N/A"} />
                <InfoItem icon={<Activity />} label="CCQ" value={detailStatus.ccq != null ? `${Math.round(detailStatus.ccq / 10)}%` : "N/A"} />
                <InfoItem icon={<Radio />} label="Frecuencia" value={detailStatus.frequency ? `${detailStatus.frequency} MHz` : "N/A"} />
                <InfoItem icon={<Activity />} label="TX Rate" value={detailStatus.tx_rate ? `${detailStatus.tx_rate} Mbps` : "N/A"} />
                <InfoItem icon={<Activity />} label="RX Rate" value={detailStatus.rx_rate ? `${detailStatus.rx_rate} Mbps` : "N/A"} />
                <InfoItem icon={<Power />} label="TX Power" value={detailStatus.tx_power ? `${detailStatus.tx_power} dBm` : "N/A"} />
                <InfoItem icon={<Activity />} label="Distancia" value={detailStatus.distance ? `${detailStatus.distance} m` : "N/A"} />
                <InfoItem icon={<Cpu />} label="CPU" value={detailStatus.cpu != null ? `${detailStatus.cpu}%` : "N/A"} />
                <InfoItem icon={<Thermometer />} label="Temperatura" value={detailStatus.temperature != null ? `${detailStatus.temperature}°C` : "N/A"} />
              </div>
              <p className="text-xs text-muted-foreground text-center">Uptime: {detailStatus.uptime}</p>
            </div>
          ) : (
            <p className="py-8 text-center text-muted-foreground">No se pudo obtener el estado del equipo</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DeviceForm({ form, setForm }: { form: typeof emptyDevice; setForm: (f: typeof emptyDevice) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Nombre *</Label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Torre Norte - LiteBeam" />
        </div>
        <div>
          <Label>IP del equipo *</Label>
          <Input value={form.ip_address} onChange={(e) => setForm({ ...form, ip_address: e.target.value })} placeholder="192.168.1.20" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Modelo</Label>
          <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="LiteBeam 5AC Gen2" />
        </div>
        <div>
          <Label>MAC Address</Label>
          <Input value={form.mac_address} onChange={(e) => setForm({ ...form, mac_address: e.target.value })} placeholder="AA:BB:CC:DD:EE:FF" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Usuario (vacío = global)</Label>
          <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="ubnt" />
        </div>
        <div>
          <Label>Contraseña (vacío = global)</Label>
          <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••" />
        </div>
      </div>
      <div>
        <Label>Notas</Label>
        <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Enlace principal torre centro" />
      </div>
    </div>
  );
}

function InfoItem({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground h-4 w-4 shrink-0">{icon}</span>
      <span className="text-muted-foreground">{label}:</span>
      <span className={`font-medium ${color || ""}`}>{value}</span>
    </div>
  );
}
