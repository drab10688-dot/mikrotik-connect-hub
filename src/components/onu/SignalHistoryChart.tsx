import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Area, AreaChart } from "recharts";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { Activity, TrendingDown, TrendingUp, Minus, RefreshCcw, Loader2, Signal, Thermometer, Cpu, ArrowLeft } from "lucide-react";

interface SignalReading {
  rx_power: number | null;
  tx_power: number | null;
  quality: string;
  temperature: number | null;
  cpu_usage: number | null;
  wan_status: string | null;
  recorded_at: string;
}

interface SignalStats {
  totalReadings: number;
  rxPower: {
    min: number;
    max: number;
    avg: number;
    current: number;
    trend: string;
  } | null;
  txPower: {
    min: number;
    max: number;
    avg: number;
    current: number;
  } | null;
}

interface OverviewEntry {
  onu_id: string;
  serial_number: string;
  brand: string;
  model: string | null;
  client_name: string | null;
  rx_power: number | null;
  tx_power: number | null;
  quality: string;
  temperature: number | null;
  wan_status: string | null;
  recorded_at: string;
  trend: string;
}

interface SignalHistoryChartProps {
  mikrotikId: string;
}

const qualityColors: Record<string, string> = {
  excellent: "bg-green-500/20 text-green-700 dark:text-green-400",
  good: "bg-primary/20 text-primary",
  fair: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400",
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
  improving: <TrendingUp className="w-4 h-4 text-green-500" />,
  stable: <Minus className="w-4 h-4 text-muted-foreground" />,
  degrading: <TrendingDown className="w-4 h-4 text-destructive" />,
};

const trendLabels: Record<string, string> = {
  improving: "Mejorando",
  stable: "Estable",
  degrading: "Degradando",
  insufficient: "Sin suficientes datos",
};

export default function SignalHistoryChart({ mikrotikId }: SignalHistoryChartProps) {
  const [overview, setOverview] = useState<OverviewEntry[]>([]);
  const [selectedOnu, setSelectedOnu] = useState<string | null>(null);
  const [history, setHistory] = useState<SignalReading[]>([]);
  const [stats, setStats] = useState<SignalStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [hours, setHours] = useState("168");

  const loadOverview = async () => {
    setLoading(true);
    try {
      const res = await api(`/genieacs/signal-overview-history/${mikrotikId}`);
      setOverview(res.data || []);
    } catch (err: any) {
      toast.error("Error cargando overview: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async (onuId: string) => {
    setLoading(true);
    try {
      const res = await api(`/genieacs/signal-history/${onuId}?hours=${hours}`);
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
      const res = await api(`/genieacs/signal-collect/${mikrotikId}`, { method: "POST" });
      toast.success(res.message);
      if (selectedOnu) loadHistory(selectedOnu);
      else loadOverview();
    } catch (err: any) {
      toast.error("Error recolectando: " + err.message);
    } finally {
      setCollecting(false);
    }
  };

  useEffect(() => { loadOverview(); }, [mikrotikId]);

  useEffect(() => {
    if (selectedOnu) loadHistory(selectedOnu);
  }, [selectedOnu, hours]);

  const chartData = history.map(r => ({
    time: new Date(r.recorded_at).toLocaleString("es", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
    rx: r.rx_power,
    tx: r.tx_power,
    temp: r.temperature,
  }));

  if (selectedOnu) {
    const onuInfo = overview.find(o => o.onu_id === selectedOnu);
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => setSelectedOnu(null)}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h3 className="font-semibold text-foreground">
                Historial de Señal — {onuInfo?.serial_number || selectedOnu}
              </h3>
              <p className="text-xs text-muted-foreground">
                {onuInfo?.client_name || "Sin cliente"} · {onuInfo?.brand} {onuInfo?.model || ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={hours} onValueChange={setHours}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
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

        {/* Stats Cards */}
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

        {/* Chart */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm">Potencia Óptica (dBm)</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {chartData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                No hay datos de señal. Haga clic en recolectar para obtener la primera lectura.
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

        {/* Temperature chart if available */}
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

  // Overview mode
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-foreground">Historial de Señal Óptica</h3>
          <p className="text-xs text-muted-foreground">
            Monitoreo de potencia Rx/Tx para detectar degradación de fibra
          </p>
        </div>
        <Button onClick={handleCollect} disabled={collecting}>
          {collecting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCcw className="w-4 h-4 mr-2" />}
          Recolectar Señal
        </Button>
      </div>

      {loading ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">Cargando...</CardContent></Card>
      ) : overview.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Signal className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No hay datos de señal registrados.</p>
            <p className="text-xs mt-1">Haga clic en "Recolectar Señal" para obtener la primera lectura de las ONUs vinculadas al ACS.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ONU</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-center">Rx (dBm)</TableHead>
                  <TableHead className="text-center">Tx (dBm)</TableHead>
                  <TableHead className="text-center">Calidad</TableHead>
                  <TableHead className="text-center">Tendencia</TableHead>
                  <TableHead className="text-center">Temp</TableHead>
                  <TableHead className="text-xs">Última Lectura</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.map((entry) => (
                  <TableRow key={entry.onu_id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedOnu(entry.onu_id)}>
                    <TableCell>
                      <div>
                        <span className="font-mono text-xs">{entry.serial_number}</span>
                        <div className="text-xs text-muted-foreground capitalize">{entry.brand} {entry.model || ""}</div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {entry.client_name || <span className="text-muted-foreground text-xs">Sin vincular</span>}
                    </TableCell>
                    <TableCell className="text-center font-mono text-sm font-semibold">
                      {entry.rx_power !== null ? entry.rx_power.toFixed(2) : "—"}
                    </TableCell>
                    <TableCell className="text-center font-mono text-sm">
                      {entry.tx_power !== null ? entry.tx_power.toFixed(2) : "—"}
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
                    <TableCell className="text-center text-xs">
                      {entry.temperature !== null ? `${entry.temperature}°C` : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(entry.recorded_at).toLocaleString("es")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSelectedOnu(entry.onu_id); }}>
                        <Activity className="w-4 h-4 mr-1" /> Ver historial
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
