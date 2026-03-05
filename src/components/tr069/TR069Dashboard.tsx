import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import {
  Wifi, RotateCcw, Signal, Power, Loader2, Router, Activity,
  Thermometer, Cpu, Clock, Globe, Upload, Download, Terminal,
  AlertTriangle, Zap, Settings, Eye, ChevronDown, ChevronUp, Trash2,
  Radio, Network, HardDrive
} from "lucide-react";

interface DeviceMonitor {
  uptime: number | null;
  manufacturer: string;
  model: string;
  serial: string;
  softwareVersion: string;
  hardwareVersion: string;
  rxPower: number | null;
  txPower: number | null;
  cpuUsage: number | null;
  memoryUsage: number | null;
  temperature: number | null;
  wanStatus: string;
  wanIP: string;
  wanUptime: number | null;
  wifiClients: { mac: string; signal: number | null; active: boolean }[];
  wifiSSID: string;
  wifiEnabled: boolean | null;
  lastInformTime: string | null;
}

interface TrafficInterface {
  name: string;
  bytesReceived: number;
  bytesSent: number;
  packetsReceived: number;
  packetsSent: number;
}

interface SignalEntry {
  deviceId: string;
  manufacturer: string;
  model: string;
  serial: string;
  rxPower: number | null;
  txPower: number | null;
  quality: 'excellent' | 'good' | 'fair' | 'critical' | 'unknown';
  lastInform: string | null;
}

function formatUptime(seconds: number | null): string {
  if (!seconds) return "-";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function getSignalColor(dbm: number | null): string {
  if (dbm === null) return "text-muted-foreground";
  if (dbm > -20) return "text-green-500";
  if (dbm > -25) return "text-yellow-500";
  return "text-destructive";
}

export default function TR069Dashboard() {
  const [devices, setDevices] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<string>("unknown");
  const [selectedDevice, setSelectedDevice] = useState<any>(null);
  const [monitor, setMonitor] = useState<DeviceMonitor | null>(null);
  const [monitorLoading, setMonitorLoading] = useState(false);
  const [traffic, setTraffic] = useState<TrafficInterface[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedDevice, setExpandedDevice] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState("monitoring");
  const [files, setFiles] = useState<any[]>([]);
  const [signalOverview, setSignalOverview] = useState<SignalEntry[]>([]);
  const [signalLoading, setSignalLoading] = useState(false);

  // Dialogs
  const [showWifiDialog, setShowWifiDialog] = useState(false);
  const [showPppoeDialog, setShowPppoeDialog] = useState(false);
  const [showNetworkDialog, setShowNetworkDialog] = useState(false);
  const [showDiagDialog, setShowDiagDialog] = useState(false);
  const [showFirmwareDialog, setShowFirmwareDialog] = useState(false);
  const [showProvisionDialog, setShowProvisionDialog] = useState(false);

  // Forms
  const [wifiForm, setWifiForm] = useState({ ssid: "", password: "", band: "2.4g" });
  const [pppoeForm, setPppoeForm] = useState({ username: "", password: "" });
  const [networkForm, setNetworkForm] = useState({ dns1: "", dns2: "", mtu: "", vlanId: "" });
  const [diagForm, setDiagForm] = useState({ type: "ping", host: "8.8.8.8" });
  const [diagResult, setDiagResult] = useState<any>(null);
  const [firmwareForm, setFirmwareForm] = useState({ fileName: "" });
  const [provisionForm, setProvisionForm] = useState({
    ssid: "", wifiPassword: "", pppoeUser: "", pppoePass: "",
  });

  const loadDevices = useCallback(async () => {
    setLoading(true);
    try {
      const [healthRes, devicesRes] = await Promise.all([
        api("/genieacs/health").catch(() => ({ success: false })),
        api("/genieacs/devices").catch(() => ({ data: [] })),
      ]);
      setHealth(healthRes.success ? "online" : "offline");
      setDevices(devicesRes.data || []);
    } catch {
      setHealth("offline");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDevices(); }, [loadDevices]);

  const loadSignalOverview = useCallback(async () => {
    setSignalLoading(true);
    try {
      const res = await api("/genieacs/signal-overview");
      setSignalOverview(res.data || []);
    } catch {
      // silently fail
    } finally {
      setSignalLoading(false);
    }
  }, []);

  useEffect(() => {
    if (health === "online") loadSignalOverview();
  }, [health, loadSignalOverview]);

  const refreshDeviceSignal = async (deviceId: string) => {
    setActionLoading(`signal-${deviceId}`);
    try {
      await api(`/genieacs/devices/${encodeURIComponent(deviceId)}/refresh-signal`, { method: "POST" });
      toast.success("Lectura de señal óptica solicitada. Espere ~10s y refresque.");
      setTimeout(() => loadSignalOverview(), 10000);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const refreshAllSignals = async () => {
    setSignalLoading(true);
    try {
      // Request refresh for all devices in parallel
      await Promise.allSettled(
        devices.map((d: any) =>
          api(`/genieacs/devices/${encodeURIComponent(d._id)}/refresh-signal`, { method: "POST" }).catch(() => {})
        )
      );
      toast.success(`Lectura de señal solicitada a ${devices.length} ONUs. Esperando datos...`);
      setTimeout(() => loadSignalOverview(), 12000);
    } catch {
      toast.error("Error al solicitar lectura masiva");
    } finally {
      setSignalLoading(false);
    }
  };

  const loadMonitor = async (deviceId: string) => {
    setMonitorLoading(true);
    try {
      const [monRes, trafficRes] = await Promise.all([
        api(`/genieacs/devices/${encodeURIComponent(deviceId)}/monitor`),
        api(`/genieacs/devices/${encodeURIComponent(deviceId)}/traffic`).catch(() => ({ data: [] })),
      ]);
      setMonitor(monRes.data);
      setTraffic(trafficRes.data || []);
    } catch (err: any) {
      toast.error("Error cargando monitoreo: " + err.message);
    } finally {
      setMonitorLoading(false);
    }
  };

  const selectDevice = (device: any) => {
    const deviceId = device._id;
    setSelectedDevice(device);
    if (expandedDevice === deviceId) {
      setExpandedDevice(null);
      setMonitor(null);
    } else {
      setExpandedDevice(deviceId);
      loadMonitor(deviceId);
    }
  };

  const runAction = async (deviceId: string, action: string, body: any = {}) => {
    setActionLoading(`${action}-${deviceId}`);
    try {
      const res = await api(`/genieacs/devices/${encodeURIComponent(deviceId)}/${action}`, {
        method: "POST", body,
      });
      toast.success(res.message || `Acción ${action} enviada`);
      // Refresh monitor after action
      setTimeout(() => loadMonitor(deviceId), 3000);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleWifiSubmit = async () => {
    if (!selectedDevice) return;
    setActionLoading("wifi");
    try {
      const res = await api(`/genieacs/devices/${encodeURIComponent(selectedDevice._id)}/wifi`, {
        method: "POST", body: wifiForm,
      });
      toast.success(res.message);
      setShowWifiDialog(false);
    } catch (err: any) { toast.error(err.message); }
    finally { setActionLoading(null); }
  };

  const handlePppoeSubmit = async () => {
    if (!selectedDevice) return;
    setActionLoading("pppoe");
    try {
      const res = await api(`/genieacs/devices/${encodeURIComponent(selectedDevice._id)}/pppoe`, {
        method: "POST", body: pppoeForm,
      });
      toast.success(res.message);
      setShowPppoeDialog(false);
    } catch (err: any) { toast.error(err.message); }
    finally { setActionLoading(null); }
  };

  const handleNetworkSubmit = async () => {
    if (!selectedDevice) return;
    setActionLoading("network");
    try {
      const res = await api(`/genieacs/devices/${encodeURIComponent(selectedDevice._id)}/network`, {
        method: "POST", body: {
          ...networkForm,
          mtu: networkForm.mtu ? parseInt(networkForm.mtu) : undefined,
          vlanId: networkForm.vlanId ? parseInt(networkForm.vlanId) : undefined,
        },
      });
      toast.success(res.message);
      setShowNetworkDialog(false);
    } catch (err: any) { toast.error(err.message); }
    finally { setActionLoading(null); }
  };

  const handleDiagnostics = async () => {
    if (!selectedDevice) return;
    setActionLoading("diag");
    setDiagResult(null);
    try {
      await api(`/genieacs/devices/${encodeURIComponent(selectedDevice._id)}/diagnostics`, {
        method: "POST", body: diagForm,
      });
      toast.success(`Diagnóstico ${diagForm.type} iniciado, esperando resultados...`);
      // Poll for results after 10s
      setTimeout(async () => {
        try {
          const res = await api(`/genieacs/devices/${encodeURIComponent(selectedDevice._id)}/diagnostics/${diagForm.type}`);
          setDiagResult(res.data);
        } catch { toast.error("No se pudieron obtener los resultados"); }
        finally { setActionLoading(null); }
      }, 10000);
    } catch (err: any) {
      toast.error(err.message);
      setActionLoading(null);
    }
  };

  const handleFirmwareSubmit = async () => {
    if (!selectedDevice) return;
    setActionLoading("firmware");
    try {
      const res = await api(`/genieacs/devices/${encodeURIComponent(selectedDevice._id)}/firmware`, {
        method: "POST", body: firmwareForm,
      });
      toast.success(res.message);
      setShowFirmwareDialog(false);
    } catch (err: any) { toast.error(err.message); }
    finally { setActionLoading(null); }
  };

  const handleBulkFirmware = async () => {
    if (devices.length === 0) return;
    if (!confirm(`¿Enviar firmware a ${devices.length} dispositivos?`)) return;
    setActionLoading("bulk-firmware");
    try {
      const res = await api("/genieacs/firmware/bulk", {
        method: "POST",
        body: {
          deviceIds: devices.map((d: any) => d._id),
          fileName: firmwareForm.fileName,
        },
      });
      toast.success(res.message);
    } catch (err: any) { toast.error(err.message); }
    finally { setActionLoading(null); }
  };

  const handleWifiToggle = async (deviceId: string, band: string, enable: boolean) => {
    setActionLoading(`toggle-${band}-${deviceId}`);
    try {
      const res = await api(`/genieacs/devices/${encodeURIComponent(deviceId)}/wifi-toggle`, {
        method: "POST", body: { band, enable },
      });
      toast.success(res.message);
    } catch (err: any) { toast.error(err.message); }
    finally { setActionLoading(null); }
  };

  const getDeviceInfo = (device: any) => {
    const di = device?.InternetGatewayDevice?.DeviceInfo || device?.Device?.DeviceInfo || {};
    return {
      manufacturer: di?.Manufacturer?._value || "Desconocido",
      model: di?.ModelName?._value || di?.ProductClass?._value || "-",
      serial: di?.SerialNumber?._value || "-",
      softwareVersion: di?.SoftwareVersion?._value || "-",
      uptime: di?.UpTime?._value ? formatUptime(di.UpTime._value) : "-",
    };
  };

  if (health === "offline" && !loading) {
    return (
      <Card>
        <CardContent className="p-8 text-center space-y-3">
          <Signal className="w-12 h-12 mx-auto text-muted-foreground" />
          <p className="font-medium">GenieACS no está disponible</p>
          <p className="text-sm text-muted-foreground">
            Configure las ONUs con la URL del ACS: <code className="bg-muted px-2 py-1 rounded">http://[IP_DEL_VPS]:7547</code>
          </p>
          <Button onClick={loadDevices} variant="outline"><RotateCcw className="w-4 h-4 mr-2" /> Reintentar</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Badge variant={health === "online" ? "default" : "destructive"}>
            {health === "online" ? "ACS Online" : "ACS Offline"}
          </Badge>
          <span className="text-sm text-muted-foreground">{devices.length} dispositivos</span>
        </div>
        <Button onClick={loadDevices} disabled={loading} variant="outline" size="sm">
          <RotateCcw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Actualizar
        </Button>
      </div>

      {/* Sub-tabs */}
      <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
        <TabsList className="grid grid-cols-5 w-full">
          <TabsTrigger value="monitoring"><Activity className="w-3 h-3 mr-1" /> Monitor</TabsTrigger>
          <TabsTrigger value="config"><Settings className="w-3 h-3 mr-1" /> Config</TabsTrigger>
          <TabsTrigger value="maintenance"><HardDrive className="w-3 h-3 mr-1" /> Manten.</TabsTrigger>
          <TabsTrigger value="diagnostics"><Terminal className="w-3 h-3 mr-1" /> Diagnóst.</TabsTrigger>
          <TabsTrigger value="provisioning"><Zap className="w-3 h-3 mr-1" /> Provisión</TabsTrigger>
        </TabsList>

        {/* ═══ MONITORING TAB ═══ */}
        <TabsContent value="monitoring" className="space-y-4">
          {/* Signal Overview Panel */}
          {signalOverview.length > 0 && (
            <Card>
              <CardHeader className="p-4 pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Signal className="w-4 h-4 text-primary" /> Señal Óptica — Vista General
                  </CardTitle>
                  <Button size="sm" variant="outline" onClick={refreshAllSignals} disabled={signalLoading}>
                    <RotateCcw className={`w-3 h-3 mr-1 ${signalLoading ? "animate-spin" : ""}`} />
                    Leer Señal (GetParameterValues)
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">ONU</TableHead>
                      <TableHead className="text-xs">Serial</TableHead>
                      <TableHead className="text-xs text-center">Rx Power</TableHead>
                      <TableHead className="text-xs text-center">Tx Power</TableHead>
                      <TableHead className="text-xs text-center">Estado</TableHead>
                      <TableHead className="text-xs text-right">Última Lectura</TableHead>
                      <TableHead className="text-xs text-right"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {signalOverview.map((s) => {
                      const qualityConfig: Record<string, { label: string; color: string; bg: string }> = {
                        excellent: { label: "Excelente", color: "text-green-600 dark:text-green-400", bg: "bg-green-100 dark:bg-green-900/30" },
                        good: { label: "Buena", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-100 dark:bg-emerald-900/30" },
                        fair: { label: "Regular", color: "text-yellow-600 dark:text-yellow-400", bg: "bg-yellow-100 dark:bg-yellow-900/30" },
                        critical: { label: "Crítica", color: "text-destructive", bg: "bg-destructive/10" },
                        unknown: { label: "Sin datos", color: "text-muted-foreground", bg: "bg-muted" },
                      };
                      const q = qualityConfig[s.quality] || qualityConfig.unknown;

                      return (
                        <TableRow key={s.deviceId}>
                          <TableCell className="text-xs">
                            <span className="font-medium">{s.manufacturer}</span>{" "}
                            <span className="text-muted-foreground">{s.model}</span>
                          </TableCell>
                          <TableCell className="text-xs font-mono">{s.serial}</TableCell>
                          <TableCell className="text-center">
                            <span className={`text-sm font-bold ${getSignalColor(s.rxPower)}`}>
                              {s.rxPower !== null ? `${s.rxPower} dBm` : "—"}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className={`text-sm font-bold ${getSignalColor(s.txPower)}`}>
                              {s.txPower !== null ? `${s.txPower} dBm` : "—"}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className={`text-xs ${q.color} ${q.bg} border-0`}>
                              {s.quality === "critical" && <AlertTriangle className="w-3 h-3 mr-1" />}
                              {q.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-right text-muted-foreground">
                            {s.lastInform ? new Date(s.lastInform).toLocaleString() : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm" variant="ghost"
                              onClick={(e) => { e.stopPropagation(); refreshDeviceSignal(s.deviceId); }}
                              disabled={actionLoading === `signal-${s.deviceId}`}
                              title="Forzar lectura de señal"
                            >
                              {actionLoading === `signal-${s.deviceId}` ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Download className="w-3 h-3" />
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {loading ? (
            <Card><CardContent className="p-8 text-center"><Loader2 className="w-6 h-6 mx-auto animate-spin" /></CardContent></Card>
          ) : devices.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">No hay ONUs conectadas al ACS</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {devices.map((device: any) => {
                const info = getDeviceInfo(device);
                const deviceId = device._id;
                const isExpanded = expandedDevice === deviceId;

                return (
                  <Card key={deviceId} className="overflow-hidden">
                    <div
                      className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => selectDevice(device)}
                    >
                      <div className="flex items-center gap-4">
                        <Router className="w-5 h-5 text-primary" />
                        <div>
                          <p className="font-medium">{info.manufacturer} {info.model}</p>
                          <p className="text-xs text-muted-foreground font-mono">{info.serial}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right text-sm">
                          <p className="text-muted-foreground">Firmware: {info.softwareVersion}</p>
                          <p className="text-muted-foreground">Uptime: {info.uptime}</p>
                        </div>
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t p-4 space-y-4">
                        {monitorLoading ? (
                          <div className="flex items-center justify-center p-8">
                            <Loader2 className="w-6 h-6 animate-spin" />
                          </div>
                        ) : monitor ? (
                          <>
                            {/* Signal + System Stats */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                              <Card>
                                <CardContent className="p-3 text-center">
                                  <Signal className={`w-6 h-6 mx-auto mb-1 ${getSignalColor(monitor.rxPower)}`} />
                                  <p className="text-xs text-muted-foreground">Rx Power</p>
                                  <p className={`text-lg font-bold ${getSignalColor(monitor.rxPower)}`}>
                                    {monitor.rxPower !== null ? `${monitor.rxPower} dBm` : "N/A"}
                                  </p>
                                </CardContent>
                              </Card>
                              <Card>
                                <CardContent className="p-3 text-center">
                                  <Radio className={`w-6 h-6 mx-auto mb-1 ${getSignalColor(monitor.txPower)}`} />
                                  <p className="text-xs text-muted-foreground">Tx Power</p>
                                  <p className={`text-lg font-bold ${getSignalColor(monitor.txPower)}`}>
                                    {monitor.txPower !== null ? `${monitor.txPower} dBm` : "N/A"}
                                  </p>
                                </CardContent>
                              </Card>
                              <Card>
                                <CardContent className="p-3 text-center">
                                  <Cpu className="w-6 h-6 mx-auto mb-1 text-primary" />
                                  <p className="text-xs text-muted-foreground">CPU</p>
                                  <p className="text-lg font-bold">{monitor.cpuUsage !== null ? `${monitor.cpuUsage}%` : "N/A"}</p>
                                  {monitor.cpuUsage !== null && <Progress value={monitor.cpuUsage} className="h-1 mt-1" />}
                                </CardContent>
                              </Card>
                              <Card>
                                <CardContent className="p-3 text-center">
                                  <Thermometer className="w-6 h-6 mx-auto mb-1 text-orange-500" />
                                  <p className="text-xs text-muted-foreground">Temperatura</p>
                                  <p className="text-lg font-bold">{monitor.temperature !== null ? `${monitor.temperature}°C` : "N/A"}</p>
                                </CardContent>
                              </Card>
                            </div>

                            {/* WAN + WiFi Status */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <Card>
                                <CardHeader className="p-3 pb-1">
                                  <CardTitle className="text-sm flex items-center gap-2">
                                    <Globe className="w-4 h-4" /> Estado WAN
                                  </CardTitle>
                                </CardHeader>
                                <CardContent className="p-3 pt-0 space-y-1 text-sm">
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">Estado:</span>
                                    <Badge variant={monitor.wanStatus === 'Connected' ? 'default' : 'destructive'} className="text-xs">
                                      {monitor.wanStatus}
                                    </Badge>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">IP:</span>
                                    <span className="font-mono text-xs">{monitor.wanIP}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">Uptime WAN:</span>
                                    <span>{formatUptime(monitor.wanUptime)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-muted-foreground">Uptime Dispositivo:</span>
                                    <span>{formatUptime(monitor.uptime)}</span>
                                  </div>
                                </CardContent>
                              </Card>

                              <Card>
                                <CardHeader className="p-3 pb-1">
                                  <CardTitle className="text-sm flex items-center gap-2">
                                    <Wifi className="w-4 h-4" /> WiFi — {monitor.wifiSSID}
                                  </CardTitle>
                                </CardHeader>
                                <CardContent className="p-3 pt-0">
                                  <p className="text-xs text-muted-foreground mb-2">{monitor.wifiClients.length} clientes conectados</p>
                                  {monitor.wifiClients.length > 0 ? (
                                    <div className="space-y-1 max-h-32 overflow-y-auto">
                                      {monitor.wifiClients.map((c, i) => (
                                        <div key={i} className="flex justify-between text-xs bg-muted/50 px-2 py-1 rounded">
                                          <span className="font-mono">{c.mac}</span>
                                          <span>{c.signal !== null ? `${c.signal} dBm` : ""}</span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-xs text-muted-foreground">Sin clientes WiFi</p>
                                  )}
                                </CardContent>
                              </Card>
                            </div>

                            {/* Traffic Stats */}
                            {traffic.length > 0 && (
                              <Card>
                                <CardHeader className="p-3 pb-1">
                                  <CardTitle className="text-sm flex items-center gap-2">
                                    <Activity className="w-4 h-4" /> Tráfico por Interfaz
                                  </CardTitle>
                                </CardHeader>
                                <CardContent className="p-0">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead className="text-xs">Interfaz</TableHead>
                                        <TableHead className="text-xs text-right">↓ Recibidos</TableHead>
                                        <TableHead className="text-xs text-right">↑ Enviados</TableHead>
                                        <TableHead className="text-xs text-right">Paquetes ↓</TableHead>
                                        <TableHead className="text-xs text-right">Paquetes ↑</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {traffic.map((t, i) => (
                                        <TableRow key={i}>
                                          <TableCell className="text-xs font-medium">{t.name}</TableCell>
                                          <TableCell className="text-xs text-right">{formatBytes(t.bytesReceived)}</TableCell>
                                          <TableCell className="text-xs text-right">{formatBytes(t.bytesSent)}</TableCell>
                                          <TableCell className="text-xs text-right">{t.packetsReceived.toLocaleString()}</TableCell>
                                          <TableCell className="text-xs text-right">{t.packetsSent.toLocaleString()}</TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </CardContent>
                              </Card>
                            )}

                            {/* Quick actions */}
                            <div className="flex gap-2 flex-wrap">
                              <Button size="sm" variant="outline" onClick={() => loadMonitor(deviceId)}>
                                <RotateCcw className="w-3 h-3 mr-1" /> Refrescar
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => runAction(deviceId, "refresh", { parameterPath: "InternetGatewayDevice" })}>
                                <Download className="w-3 h-3 mr-1" /> Actualizar Parámetros
                              </Button>
                            </div>
                          </>
                        ) : (
                          <p className="text-center text-muted-foreground py-4">Seleccione un dispositivo para ver su monitoreo</p>
                        )}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ═══ CONFIG TAB ═══ */}
        <TabsContent value="config" className="space-y-4">
          {devices.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">No hay dispositivos conectados</CardContent></Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dispositivo</TableHead>
                      <TableHead>Serial</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {devices.map((device: any) => {
                      const info = getDeviceInfo(device);
                      const deviceId = device._id;
                      return (
                        <TableRow key={deviceId}>
                          <TableCell>
                            <p className="font-medium">{info.manufacturer} {info.model}</p>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{info.serial}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1 flex-wrap">
                              <Button size="sm" variant="outline" onClick={() => { setSelectedDevice(device); setWifiForm({ ssid: "", password: "", band: "2.4g" }); setShowWifiDialog(true); }}>
                                <Wifi className="w-3 h-3 mr-1" /> WiFi
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => { setSelectedDevice(device); setPppoeForm({ username: "", password: "" }); setShowPppoeDialog(true); }}>
                                <Network className="w-3 h-3 mr-1" /> PPPoE
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => { setSelectedDevice(device); setNetworkForm({ dns1: "", dns2: "", mtu: "", vlanId: "" }); setShowNetworkDialog(true); }}>
                                <Globe className="w-3 h-3 mr-1" /> DNS/MTU
                              </Button>
                              <Button size="sm" variant="ghost" title="Habilitar WiFi 2.4G"
                                onClick={() => handleWifiToggle(deviceId, "2.4g", true)}>
                                <Radio className="w-3 h-3" /> 2.4G
                              </Button>
                              <Button size="sm" variant="ghost" title="Habilitar WiFi 5G"
                                onClick={() => handleWifiToggle(deviceId, "5g", true)}>
                                <Radio className="w-3 h-3" /> 5G
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ═══ MAINTENANCE TAB ═══ */}
        <TabsContent value="maintenance" className="space-y-4">
          {devices.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">No hay dispositivos conectados</CardContent></Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dispositivo</TableHead>
                      <TableHead>Firmware</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {devices.map((device: any) => {
                      const info = getDeviceInfo(device);
                      const deviceId = device._id;
                      return (
                        <TableRow key={deviceId}>
                          <TableCell>
                            <p className="font-medium">{info.manufacturer} {info.model}</p>
                            <p className="text-xs font-mono text-muted-foreground">{info.serial}</p>
                          </TableCell>
                          <TableCell className="text-xs">{info.softwareVersion}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1 flex-wrap">
                              <Button size="sm" variant="outline"
                                disabled={!!actionLoading}
                                onClick={() => { if (confirm("¿Reiniciar esta ONU?")) runAction(deviceId, "reboot"); }}>
                                <Power className="w-3 h-3 mr-1" /> Reboot
                              </Button>
                              <Button size="sm" variant="outline" className="text-destructive"
                                disabled={!!actionLoading}
                                onClick={() => { if (confirm("¿Factory reset? Se perderá toda la configuración.")) runAction(deviceId, "factory-reset"); }}>
                                <AlertTriangle className="w-3 h-3 mr-1" /> Factory Reset
                              </Button>
                              <Button size="sm" variant="outline"
                                onClick={() => { setSelectedDevice(device); setShowFirmwareDialog(true); }}>
                                <Upload className="w-3 h-3 mr-1" /> Firmware
                              </Button>
                              <Button size="sm" variant="outline"
                                disabled={!!actionLoading}
                                onClick={() => runAction(deviceId, "config-backup")}>
                                <Download className="w-3 h-3 mr-1" /> Backup
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>

              {/* Bulk firmware */}
              <div className="p-4 border-t">
                <h4 className="text-sm font-medium mb-2">Actualización Masiva de Firmware (OTA)</h4>
                <div className="flex gap-2">
                  <Input
                    placeholder="Nombre del archivo de firmware"
                    value={firmwareForm.fileName}
                    onChange={e => setFirmwareForm({ fileName: e.target.value })}
                    className="max-w-xs"
                  />
                  <Button
                    variant="default" size="sm"
                    disabled={!firmwareForm.fileName || !!actionLoading}
                    onClick={handleBulkFirmware}
                  >
                    {actionLoading === "bulk-firmware" ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Upload className="w-4 h-4 mr-1" />}
                    Enviar a Todos ({devices.length})
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </TabsContent>

        {/* ═══ DIAGNOSTICS TAB ═══ */}
        <TabsContent value="diagnostics" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Diagnóstico Remoto desde la ONU</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Dispositivo</Label>
                  <Select onValueChange={v => setSelectedDevice(devices.find((d: any) => d._id === v) || null)}>
                    <SelectTrigger><SelectValue placeholder="Seleccionar ONU" /></SelectTrigger>
                    <SelectContent>
                      {devices.map((d: any) => {
                        const info = getDeviceInfo(d);
                        return <SelectItem key={d._id} value={d._id}>{info.manufacturer} {info.model} ({info.serial})</SelectItem>;
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select value={diagForm.type} onValueChange={v => setDiagForm(p => ({ ...p, type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ping">Ping</SelectItem>
                      <SelectItem value="traceroute">Traceroute</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Host destino</Label>
                  <Input value={diagForm.host} onChange={e => setDiagForm(p => ({ ...p, host: e.target.value }))} placeholder="8.8.8.8" />
                </div>
              </div>
              <Button
                onClick={handleDiagnostics}
                disabled={!selectedDevice || !diagForm.host || actionLoading === "diag"}
              >
                {actionLoading === "diag" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Terminal className="w-4 h-4 mr-2" />}
                Ejecutar {diagForm.type === "ping" ? "Ping" : "Traceroute"}
              </Button>

              {diagResult && (
                <Card className="bg-muted/50">
                  <CardContent className="p-4">
                    <h4 className="font-medium text-sm mb-2">
                      Resultado — {diagResult.state}
                    </h4>
                    {diagForm.type === "ping" ? (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                        <div><span className="text-muted-foreground">Host:</span> {diagResult.host}</div>
                        <div><span className="text-muted-foreground">Éxitos:</span> {diagResult.successCount}</div>
                        <div><span className="text-muted-foreground">Fallos:</span> {diagResult.failureCount}</div>
                        <div><span className="text-muted-foreground">Promedio:</span> {diagResult.avgResponseTime}ms</div>
                        <div><span className="text-muted-foreground">Mínimo:</span> {diagResult.minResponseTime}ms</div>
                        <div><span className="text-muted-foreground">Máximo:</span> {diagResult.maxResponseTime}ms</div>
                      </div>
                    ) : (
                      <div className="space-y-1 font-mono text-xs">
                        {diagResult.hops?.map((hop: any) => (
                          <div key={hop.hopNumber} className="flex gap-4">
                            <span className="w-6 text-right text-muted-foreground">{hop.hopNumber}</span>
                            <span className="w-32">{hop.address}</span>
                            <span>{hop.host}</span>
                            <span className="text-muted-foreground">{hop.rtt}ms</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ PROVISIONING TAB ═══ */}
        <TabsContent value="provisioning" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Zap className="w-4 h-4" /> Auto-Provisioning
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Cuando una ONU nueva se conecte al ACS, aplicará automáticamente la configuración WiFi y PPPoE definida aquí.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>SSID WiFi por defecto</Label>
                  <Input value={provisionForm.ssid} onChange={e => setProvisionForm(p => ({ ...p, ssid: e.target.value }))} placeholder="MiRedFibra" />
                </div>
                <div className="space-y-2">
                  <Label>Contraseña WiFi por defecto</Label>
                  <Input value={provisionForm.wifiPassword} onChange={e => setProvisionForm(p => ({ ...p, wifiPassword: e.target.value }))} placeholder="password123" />
                </div>
                <div className="space-y-2">
                  <Label>Usuario PPPoE por defecto</Label>
                  <Input value={provisionForm.pppoeUser} onChange={e => setProvisionForm(p => ({ ...p, pppoeUser: e.target.value }))} placeholder="cliente_nuevo" />
                </div>
                <div className="space-y-2">
                  <Label>Contraseña PPPoE por defecto</Label>
                  <Input value={provisionForm.pppoePass} onChange={e => setProvisionForm(p => ({ ...p, pppoePass: e.target.value }))} placeholder="pass123" />
                </div>
              </div>

              <Button
                onClick={async () => {
                  setActionLoading("provision");
                  try {
                    // Create a GenieACS preset for auto-provisioning
                    const parameterValues: [string, string, string][] = [];
                    if (provisionForm.ssid) {
                      parameterValues.push(["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", provisionForm.ssid, "xsd:string"]);
                    }
                    if (provisionForm.wifiPassword) {
                      parameterValues.push(
                        ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey", provisionForm.wifiPassword, "xsd:string"],
                        ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase", provisionForm.wifiPassword, "xsd:string"],
                      );
                    }
                    if (provisionForm.pppoeUser) {
                      parameterValues.push(["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username", provisionForm.pppoeUser, "xsd:string"]);
                    }
                    if (provisionForm.pppoePass) {
                      parameterValues.push(["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Password", provisionForm.pppoePass, "xsd:string"]);
                    }

                    const preset = {
                      weight: 0,
                      channel: "bootstrap",
                      events: { "0 BOOTSTRAP": true },
                      precondition: "true",
                      configurations: [
                        {
                          type: "value",
                          name: "OmniSync Auto-Provision",
                          parameterValues,
                        }
                      ],
                    };

                    await api("/genieacs/presets/omnisync-auto-provision", {
                      method: "PUT",
                      body: preset,
                    });
                    toast.success("Preset de auto-provisioning guardado. Las ONUs nuevas se configurarán automáticamente.");
                  } catch (err: any) {
                    toast.error(err.message);
                  } finally {
                    setActionLoading(null);
                  }
                }}
                disabled={(!provisionForm.ssid && !provisionForm.pppoeUser) || actionLoading === "provision"}
              >
                {actionLoading === "provision" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
                Guardar Preset de Auto-Provisioning
              </Button>
            </CardContent>
          </Card>

          {/* Bulk config by brand */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Settings className="w-4 h-4" /> Configuración Masiva por Marca
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Aplica la misma configuración WiFi a todas las ONUs de una marca/modelo específico.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Filtro por fabricante</Label>
                  <Input placeholder='ej: ZTE, Huawei, Latic' id="bulk-manufacturer" />
                </div>
                <div className="space-y-2">
                  <Label>Nuevo SSID</Label>
                  <Input placeholder="MiRedFibra" id="bulk-ssid" />
                </div>
                <div className="space-y-2">
                  <Label>Nueva contraseña WiFi</Label>
                  <Input placeholder="password" id="bulk-password" />
                </div>
              </div>
              <Button
                variant="outline"
                onClick={async () => {
                  const manufacturer = (document.getElementById("bulk-manufacturer") as HTMLInputElement)?.value;
                  const ssid = (document.getElementById("bulk-ssid") as HTMLInputElement)?.value;
                  const password = (document.getElementById("bulk-password") as HTMLInputElement)?.value;
                  if (!manufacturer || (!ssid && !password)) {
                    toast.error("Complete fabricante y al menos SSID o contraseña");
                    return;
                  }

                  const parameterValues: [string, string, string][] = [];
                  if (ssid) parameterValues.push(["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", ssid, "xsd:string"]);
                  if (password) {
                    parameterValues.push(
                      ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey", password, "xsd:string"],
                      ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase", password, "xsd:string"],
                    );
                  }

                  setActionLoading("bulk-config");
                  try {
                    const res = await api("/genieacs/bulk/config", {
                      method: "POST",
                      body: {
                        filter: { "InternetGatewayDevice.DeviceInfo.Manufacturer": manufacturer },
                        parameterValues,
                      },
                    });
                    toast.success(res.message);
                  } catch (err: any) { toast.error(err.message); }
                  finally { setActionLoading(null); }
                }}
                disabled={actionLoading === "bulk-config"}
              >
                {actionLoading === "bulk-config" ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Zap className="w-4 h-4 mr-1" />}
                Aplicar a Todos
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ═══ DIALOGS ═══ */}

      {/* WiFi Dialog */}
      <Dialog open={showWifiDialog} onOpenChange={setShowWifiDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle><Wifi className="w-5 h-5 inline mr-2" /> Configurar WiFi via TR-069</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Banda</Label>
              <Select value={wifiForm.band} onValueChange={v => setWifiForm(p => ({ ...p, band: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="2.4g">2.4 GHz</SelectItem>
                  <SelectItem value="5g">5 GHz</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>SSID</Label>
              <Input value={wifiForm.ssid} onChange={e => setWifiForm(p => ({ ...p, ssid: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Contraseña</Label>
              <Input value={wifiForm.password} onChange={e => setWifiForm(p => ({ ...p, password: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowWifiDialog(false)}>Cancelar</Button>
              <Button onClick={handleWifiSubmit} disabled={(!wifiForm.ssid && !wifiForm.password) || actionLoading === "wifi"}>
                {actionLoading === "wifi" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wifi className="w-4 h-4 mr-2" />}
                Aplicar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* PPPoE Dialog */}
      <Dialog open={showPppoeDialog} onOpenChange={setShowPppoeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle><Network className="w-5 h-5 inline mr-2" /> Configurar PPPoE via TR-069</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Usuario PPPoE</Label>
              <Input value={pppoeForm.username} onChange={e => setPppoeForm(p => ({ ...p, username: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Contraseña PPPoE</Label>
              <Input value={pppoeForm.password} onChange={e => setPppoeForm(p => ({ ...p, password: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowPppoeDialog(false)}>Cancelar</Button>
              <Button onClick={handlePppoeSubmit} disabled={(!pppoeForm.username && !pppoeForm.password) || actionLoading === "pppoe"}>
                {actionLoading === "pppoe" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Network className="w-4 h-4 mr-2" />}
                Aplicar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Network (DNS/MTU/VLAN) Dialog */}
      <Dialog open={showNetworkDialog} onOpenChange={setShowNetworkDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle><Globe className="w-5 h-5 inline mr-2" /> Configurar Red via TR-069</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>DNS Primario</Label>
                <Input value={networkForm.dns1} onChange={e => setNetworkForm(p => ({ ...p, dns1: e.target.value }))} placeholder="8.8.8.8" />
              </div>
              <div className="space-y-2">
                <Label>DNS Secundario</Label>
                <Input value={networkForm.dns2} onChange={e => setNetworkForm(p => ({ ...p, dns2: e.target.value }))} placeholder="8.8.4.4" />
              </div>
              <div className="space-y-2">
                <Label>MTU</Label>
                <Input value={networkForm.mtu} onChange={e => setNetworkForm(p => ({ ...p, mtu: e.target.value }))} placeholder="1492" />
              </div>
              <div className="space-y-2">
                <Label>VLAN ID</Label>
                <Input value={networkForm.vlanId} onChange={e => setNetworkForm(p => ({ ...p, vlanId: e.target.value }))} placeholder="100" />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowNetworkDialog(false)}>Cancelar</Button>
              <Button onClick={handleNetworkSubmit} disabled={actionLoading === "network"}>
                {actionLoading === "network" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Globe className="w-4 h-4 mr-2" />}
                Aplicar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Firmware Dialog */}
      <Dialog open={showFirmwareDialog} onOpenChange={setShowFirmwareDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle><Upload className="w-5 h-5 inline mr-2" /> Actualizar Firmware OTA</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              El archivo de firmware debe estar previamente cargado en GenieACS File Server.
            </p>
            <div className="space-y-2">
              <Label>Nombre del archivo de firmware</Label>
              <Input value={firmwareForm.fileName} onChange={e => setFirmwareForm({ fileName: e.target.value })} placeholder="firmware_v2.0.bin" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowFirmwareDialog(false)}>Cancelar</Button>
              <Button onClick={handleFirmwareSubmit} disabled={!firmwareForm.fileName || actionLoading === "firmware"}>
                {actionLoading === "firmware" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                Enviar Firmware
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
