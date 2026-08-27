import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Area, AreaChart } from "recharts";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { Activity, TrendingDown, TrendingUp, Minus, RefreshCcw, Loader2, Signal, Thermometer, ArrowLeft, Bell, AlertTriangle, CheckCircle, XCircle, Settings2, Globe } from "lucide-react";

interface SignalReading {
  rx_power: number | null;
  tx_power: number | null;
  quality: string;
  temperature: number | null;
  wan_status: string | null;
  recorded_at: string;
}

interface SignalStats {
  totalReadings: number;
  rxPower: { min: number; max: number; avg: number; current: number; trend: string } | null;
  txPower: { min: number; max: number; avg: number; current: number } | null;
}

interface OverviewEntry {
  device_id: string;
  name: string;
  serial: string | null;
  manufacturer: string | null;
  model: string | null;
  rx_power: number | null;
  tx_power: number | null;
  quality: string;
  temperature: number | null;
  wan_status: string | null;
  recorded_at: string;
  trend: string;
}

interface SignalAlert {
  id: string;
  device_id: string;
  serial: string | null;
  alias: string | null;
  rx_power: string | number;
  threshold: string | number;
  sent_successfully: boolean;
  error_message: string | null;
  created_at: string;
}

interface GlobalSignalConfig {
  alerts_enabled: boolean;
  default_threshold: number;
  default_chat_id: string | null;
  cooldown_minutes: number;
  auto_cleanup_days: number;
}

const qualityColors: Record<string, string> = {
  excellent: "bg-chart-2/20 text-chart-2",
  good: "bg-primary/20 text-primary",
  fair: "bg-chart-4/20 text-chart-4",
  critical: "bg-destructive/20 text-destructive",
  unknown: "bg-muted text-muted-foreground",
};

const qualityLabels: Record<string, string> = {
  excellent: "Excelente",
  good: "Buena",
  fair: "Regular",
  critical: "Crítica",
  unknown: "Sin datos",
};

const trendIcons: Record<string, React.ReactNode> = {
  improving: <TrendingUp className="w-4 h-4 text-chart-2" />,
  stable: <Minus className="w-4 h-4 text-muted-foreground" />,
  degrading: <TrendingDown className="w-4 h-4 text-destructive" />,
};

const trendLabels: Record<string, string> = {
  improving: "Mejorando",
  stable: "Estable",
  degrading: "Degradando",
  insufficient: "Sin suficientes datos",
};

const num = (v: string | number | null | undefined) =>
  v === null || v === undefined ? null : typeof v === "number" ? v : parseFloat(v);

export default function SignalHistoryChart() {
  const [overview, setOverview] = useState<OverviewEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<SignalReading[]>([]);
  const [stats, setStats] = useState<SignalStats | null>(null);
  const [alerts, setAlerts] = useState<SignalAlert[]>([]);
  const [showAlerts, setShowAlerts] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [config, setConfig] = useState<GlobalSignalConfig>({
    alerts_enabled: false,
    default_threshold: -28,
    default_chat_id: null,
    cooldown_minutes: 60,
    auto_cleanup_days: 90,
  });
  const [savingConfig, setSavingConfig] = useState(false);
  const [loading, setLoading] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [hours, setHours] = useState("168");

  const loadOverview = async () => {
    setLoading(true);
    try {
      const res = await api(`/genieacs/acs-signal/overview`);
      setOverview(res.data || []);
    } catch (err: any) {
      toast.error("Error cargando señal: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async (deviceId: string) => {
    setLoading(true);
    try {
      const res = await api(`/genieacs/acs-signal/history/${encodeURIComponent(deviceId)}?hours=${hours}`);
      setHistory(res.data || []);
      setStats(res.stats || null);
    } catch (err: any) {
      toast.error("Error cargando historial: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCollect = async () => {
    setCollecting(true);
    try {
      const res = await api(`/genieacs/acs-signal/collect`, { method: "POST" });
      toast.success(res.message || "Recolección completada");
      if (selected) loadHistory(selected);
      loadOverview();
    } catch (err: any) {
      toast.error("Error recolectando: " + err.message);
    } finally {
      setCollecting(false);
    }
  };

  const loadAlerts = async () => {
    try {
      const res = await api(`/genieacs/acs-signal/alerts`);
      setAlerts(res.data || []);
    } catch { /* ignore */ }
  };

  const loadConfig = async () => {
    try {
      const res = await api(`/genieacs/acs-signal/config`);
      if (res.data) {
        setConfig({
          alerts_enabled: !!res.data.alerts_enabled,
          default_threshold: parseFloat(res.data.default_threshold ?? -28),
          default_chat_id: res.data.default_chat_id ?? null,
          cooldown_minutes: res.data.cooldown_minutes ?? 60,
          auto_cleanup_days: res.data.auto_cleanup_days ?? 90,
        });
      }
    } catch { /* ignore */ }
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      await api(`/genieacs/acs-signal/config`, { method: "PUT", body: config });
      toast.success("Configuración de alertas guardada");
      setShowConfig(false);
      loadConfig();
    } catch (err: any) {
      toast.error("Error: " + err.message);
    } finally {
      setSavingConfig(false);
    }
  };

  useEffect(() => { loadOverview(); loadConfig(); }, []);
  useEffect(() => { if (selected) loadHistory(selected); }, [selected, hours]);

  const chartData = history.map(r => ({
    time: new Date(r.recorded_at).toLocaleString("es", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
    rx: r.rx_power,
    tx: r.tx_power,
    temp: r.temperature,
  }));

  if (selected) {
    const info = overview.find(o => o.device_id === selected);
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => setSelected(null)}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h3 className="font-semibold text-foreground">
                Historial de Señal — {info?.name || selected}
              </h3>
              <p className="text-xs text-muted-foreground">
                {info?.manufacturer} {info?.model || ""} · SN {info?.serial || "—"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={hours} onValueChange={setHours}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="24">24 horas</SelectItem>
                <SelectItem value="72">3 días</SelectItem>
                <SelectItem value="168">7 días</SelectItem>
                <SelectItem value="720">30 días</SelectItem>
                <SelectItem value="2160">90 días</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={handleCollect} disabled={collecting}>
              {collecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Signal className="w-4 h-4 text-primary" />
                  <span className="text-xs text-muted-foreground">Rx Actual</span>
                </div>
                <p className="text-xl font-bold text-foreground">
                  {stats.rxPower ? `${stats.rxPower.current} dBm` : "—"}
                </p>
                {stats.rxPower && (
                  <div className="flex items-center gap-1 mt-1">
                    {trendIcons[stats.rxPower.trend] || trendIcons.stable}
                    <span className="text-xs text-muted-foreground">{trendLabels[stats.rxPower.trend]}</span>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Activity className="w-4 h-4 text-primary" />
                  <span className="text-xs text-muted-foreground">Rx Promedio</span>
                </div>
                <p className="text-xl font-bold text-foreground">
                  {stats.rxPower ? `${stats.rxPower.avg} dBm` : "—"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats.rxPower ? `Min: ${stats.rxPower.min} / Max: ${stats.rxPower.max}` : ""}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Signal className="w-4 h-4 text-accent-foreground" />
                  <span className="text-xs text-muted-foreground">Tx Actual</span>
                </div>
                <p className="text-xl font-bold text-foreground">
                  {stats.txPower ? `${stats.txPower.current} dBm` : "—"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats.txPower ? `Prom: ${stats.txPower.avg}` : ""}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Activity className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Lecturas</span>
                </div>
                <p className="text-xl font-bold text-foreground">{stats.totalReadings}</p>
                <p className="text-xs text-muted-foreground mt-1">en el período</p>
              </CardContent>
            </Card>
          </div>
        )}

        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm">Potencia Óptica (dBm)</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {chartData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                Aún no hay lecturas en este período.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="rxGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="txGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      color: "hsl(var(--card-foreground))",
                    }}
                    formatter={(value: number) => [`${value} dBm`]}
                  />
                  <ReferenceLine y={-25} stroke="hsl(var(--destructive))" strokeDasharray="5 5" label={{ value: "Umbral -25dBm", fill: "hsl(var(--destructive))", fontSize: 10 }} />
                  <ReferenceLine y={-28} stroke="hsl(var(--destructive))" strokeDasharray="3 3" label={{ value: "Crítico -28dBm", fill: "hsl(var(--destructive))", fontSize: 10 }} />
                  <Area type="monotone" dataKey="rx" name="Rx Power" stroke="hsl(var(--primary))" fill="url(#rxGradient)" strokeWidth={2} dot={false} connectNulls />
                  <Area type="monotone" dataKey="tx" name="Tx Power" stroke="hsl(var(--chart-2))" fill="url(#txGradient)" strokeWidth={2} dot={false} connectNulls />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {chartData.some(d => d.temp !== null) && (
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Thermometer className="w-4 h-4" /> Temperatura (°C)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                  <YAxis tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--card-foreground))" }} />
                  <Line type="monotone" dataKey="temp" name="Temperatura" stroke="hsl(var(--chart-4))" strokeWidth={2} dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-foreground">Historial de Señal Óptica</h3>
          <p className="text-xs text-muted-foreground">
            Todas las ONUs conectadas al ACS. Se recolecta automáticamente cada 15 minutos.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { loadConfig(); setShowConfig(true); }}>
            <Globe className="w-4 h-4 mr-2" /> Alertas
          </Button>
          <Button variant="outline" size="sm" onClick={() => { loadAlerts(); setShowAlerts(!showAlerts); }}>
            <Bell className="w-4 h-4 mr-2" /> Historial de alertas
          </Button>
          <Button size="sm" onClick={handleCollect} disabled={collecting}>
            {collecting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCcw className="w-4 h-4 mr-2" />}
            Recolectar ahora
          </Button>
        </div>
      </div>

      {config.alerts_enabled && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-3 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Globe className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-foreground">Alertas activas</span>
              <Badge className="bg-primary/20 text-primary text-xs">Umbral: {config.default_threshold} dBm</Badge>
              {config.default_chat_id && <Badge variant="outline" className="text-xs">Chat: {config.default_chat_id}</Badge>}
              <Badge variant="outline" className="text-xs">Cooldown: {config.cooldown_minutes} min</Badge>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { loadConfig(); setShowConfig(true); }}>
              <Settings2 className="w-4 h-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {showAlerts && (
        <Card className="border-dashed border-primary/50">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive" /> Historial de Alertas
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {alerts.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">No hay alertas registradas</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">ONU</TableHead>
                      <TableHead className="text-xs text-center">Rx (dBm)</TableHead>
                      <TableHead className="text-xs text-center">Umbral</TableHead>
                      <TableHead className="text-xs text-center">Estado</TableHead>
                      <TableHead className="text-xs">Fecha</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {alerts.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-mono text-xs">{a.alias || a.serial || a.device_id}</TableCell>
                        <TableCell className="text-center font-mono text-xs font-semibold text-destructive">
                          {num(a.rx_power)?.toFixed(0) ?? "—"}
                        </TableCell>
                        <TableCell className="text-center font-mono text-xs">{num(a.threshold)?.toFixed(0) ?? "—"}</TableCell>
                        <TableCell className="text-center">
                          {a.sent_successfully ? (
                            <Badge className="bg-chart-2/20 text-chart-2 text-xs"><CheckCircle className="w-3 h-3 mr-1" />Enviada</Badge>
                          ) : (
                            <Badge className="bg-destructive/20 text-destructive text-xs" title={a.error_message || ""}>
                              <XCircle className="w-3 h-3 mr-1" />Falló
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(a.created_at).toLocaleString("es")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {loading ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">Cargando...</CardContent></Card>
      ) : overview.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Signal className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>Aún no hay lecturas guardadas.</p>
            <p className="text-xs mt-1">Pulse "Recolectar ahora" para tomar la primera lectura de todas las ONUs del ACS.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ONU</TableHead>
                  <TableHead className="text-center">Rx (dBm)</TableHead>
                  <TableHead className="text-center">Tx (dBm)</TableHead>
                  <TableHead className="text-center">Calidad</TableHead>
                  <TableHead className="text-center">Tendencia</TableHead>
                  <TableHead className="text-xs">Última Lectura</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.map((entry) => (
                  <TableRow key={entry.device_id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelected(entry.device_id)}>
                    <TableCell>
                      <div>
                        <span className="text-sm font-medium">{entry.name}</span>
                        <div className="text-xs text-muted-foreground">{entry.manufacturer} {entry.model || ""}</div>
                      </div>
                    </TableCell>
                    <TableCell className="text-center font-mono text-sm font-semibold">
                      {entry.rx_power !== null ? Math.round(entry.rx_power) : "—"}
                    </TableCell>
                    <TableCell className="text-center font-mono text-sm">
                      {entry.tx_power !== null ? Math.round(entry.tx_power) : "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge className={qualityColors[entry.quality] || qualityColors.unknown}>
                        {qualityLabels[entry.quality] || entry.quality}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        {trendIcons[entry.trend] || trendIcons.stable}
                        <span className="text-xs">{trendLabels[entry.trend] || entry.trend}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(entry.recorded_at).toLocaleString("es")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSelected(entry.device_id); }}>
                        <Activity className="w-4 h-4 mr-1" /> Ver
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={showConfig} onOpenChange={setShowConfig}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="w-5 h-5" /> Alertas de Señal Óptica
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Switch
                checked={config.alerts_enabled}
                onCheckedChange={(v) => setConfig(p => ({ ...p, alerts_enabled: v }))}
              />
              <div>
                <Label>Activar alertas por Telegram</Label>
                <p className="text-xs text-muted-foreground">Se aplica a todas las ONUs del ACS</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Umbral Rx (dBm)</Label>
                <Input
                  type="number"
                  value={config.default_threshold}
                  onChange={(e) => setConfig(p => ({ ...p, default_threshold: parseFloat(e.target.value) }))}
                />
              </div>
              <div>
                <Label>Cooldown (min)</Label>
                <Input
                  type="number"
                  value={config.cooldown_minutes}
                  onChange={(e) => setConfig(p => ({ ...p, cooldown_minutes: parseInt(e.target.value || "60", 10) }))}
                />
              </div>
            </div>

            <div>
              <Label>Chat ID de Telegram</Label>
              <Input
                value={config.default_chat_id || ""}
                placeholder="Ej: 123456789"
                onChange={(e) => setConfig(p => ({ ...p, default_chat_id: e.target.value }))}
              />
            </div>

            <div>
              <Label>Retención del historial (días)</Label>
              <Input
                type="number"
                value={config.auto_cleanup_days}
                onChange={(e) => setConfig(p => ({ ...p, auto_cleanup_days: parseInt(e.target.value || "90", 10) }))}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowConfig(false)}>Cancelar</Button>
              <Button onClick={handleSaveConfig} disabled={savingConfig}>
                {savingConfig && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Guardar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
