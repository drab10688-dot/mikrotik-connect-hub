import { useState, useMemo, useEffect, useRef } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Wifi, Users, Activity, HardDrive, Clock, ArrowUpDown,
  Search, RefreshCw, Monitor, Signal, ArrowDown, ArrowUp,
  Zap, Server, Globe, TrendingUp
} from "lucide-react";
import { useHotspotActiveUsers, usePPPoEActive, useSystemResources, useHotspotUsers, usePPPoEUsers } from "@/hooks/useMikrotikData";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar } from "recharts";

export default function HotspotMonitor() {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const trafficHistoryRef = useRef<{ time: string; hotspot: number; pppoe: number; total: number }[]>([]);
  const [trafficHistory, setTrafficHistory] = useState<{ time: string; hotspot: number; pppoe: number; total: number }[]>([]);

  const { data: hotspotActiveData, isLoading: loadingHotspot } = useHotspotActiveUsers();
  const { data: pppoeActiveData, isLoading: loadingPPPoE } = usePPPoEActive();
  const { data: systemInfo, isLoading: loadingSystem } = useSystemResources();
  const { data: hotspotUsersData } = useHotspotUsers();
  const { data: pppoeUsersData } = usePPPoEUsers();

  const hotspotActive = useMemo(() => (Array.isArray(hotspotActiveData) ? hotspotActiveData : []), [hotspotActiveData]);
  const pppoeActive = useMemo(() => (Array.isArray(pppoeActiveData) ? pppoeActiveData : []), [pppoeActiveData]);
  const hotspotUsers = useMemo(() => (Array.isArray(hotspotUsersData) ? hotspotUsersData : []), [hotspotUsersData]);
  const pppoeUsers = useMemo(() => (Array.isArray(pppoeUsersData) ? pppoeUsersData : []), [pppoeUsersData]);
  const systemData = (systemInfo as any[])?.[0];

  // Track connection history over time
  useEffect(() => {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
    const newEntry = { time: timeStr, hotspot: hotspotActive.length, pppoe: pppoeActive.length, total: hotspotActive.length + pppoeActive.length };

    trafficHistoryRef.current = [...trafficHistoryRef.current.slice(-29), newEntry];
    setTrafficHistory([...trafficHistoryRef.current]);
  }, [hotspotActive.length, pppoeActive.length]);

  // System metrics
  const cpuLoad = parseInt(systemData?.["cpu-load"] || "0");
  const totalMemory = parseInt(systemData?.["total-memory"] || "0");
  const freeMemory = parseInt(systemData?.["free-memory"] || "0");
  const usedMemory = totalMemory - freeMemory;
  const memoryPercent = totalMemory > 0 ? Math.round((usedMemory / totalMemory) * 100) : 0;

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  // Calculate total bandwidth
  const totalBandwidth = useMemo(() => {
    let totalIn = 0, totalOut = 0;
    hotspotActive.forEach((u: any) => {
      totalIn += parseInt(u["bytes-in"] || "0");
      totalOut += parseInt(u["bytes-out"] || "0");
    });
    pppoeActive.forEach((u: any) => {
      totalIn += parseInt(u["bytes-in"] || "0");
      totalOut += parseInt(u["bytes-out"] || "0");
    });
    return { in: totalIn, out: totalOut, total: totalIn + totalOut };
  }, [hotspotActive, pppoeActive]);

  // All active users merged
  const allActiveUsers = useMemo(() => {
    const hotspot = hotspotActive.map((u: any) => ({
      name: u.user || u.name || "Sin nombre",
      ip: u.address || u["caller-id"] || "-",
      mac: u["mac-address"] || "-",
      profile: u.profile || "default",
      uptime: u.uptime || "0s",
      bytesIn: parseInt(u["bytes-in"] || "0"),
      bytesOut: parseInt(u["bytes-out"] || "0"),
      type: "hotspot" as const,
    }));
    const pppoe = pppoeActive.map((u: any) => ({
      name: u.name || "Sin nombre",
      ip: u.address || u["caller-id"] || "-",
      mac: u["caller-id"] || "-",
      profile: u.profile || "default",
      uptime: u.uptime || "0s",
      bytesIn: parseInt(u["bytes-in"] || "0"),
      bytesOut: parseInt(u["bytes-out"] || "0"),
      type: "pppoe" as const,
    }));
    return [...hotspot, ...pppoe];
  }, [hotspotActive, pppoeActive]);

  // Filtered users
  const filteredUsers = useMemo(() => {
    let users = allActiveUsers;
    if (activeTab === "hotspot") users = users.filter(u => u.type === "hotspot");
    if (activeTab === "pppoe") users = users.filter(u => u.type === "pppoe");
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      users = users.filter(u => u.name.toLowerCase().includes(term) || u.ip.includes(term) || u.mac.toLowerCase().includes(term));
    }
    return users;
  }, [allActiveUsers, activeTab, searchTerm]);

  // Profile distribution for pie chart
  const profileDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    allActiveUsers.forEach(u => { counts[u.profile] = (counts[u.profile] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [allActiveUsers]);

  const pieColors = ["hsl(var(--primary))", "hsl(var(--success))", "hsl(var(--warning))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];

  // Top consumers
  const topConsumers = useMemo(() =>
    [...allActiveUsers].sort((a, b) => (b.bytesIn + b.bytesOut) - (a.bytesIn + a.bytesOut)).slice(0, 5),
    [allActiveUsers]
  );

  const isLoading = loadingHotspot || loadingPPPoE || loadingSystem;

  return (
    <div className="flex min-h-screen w-full bg-background">
      <Sidebar />
      <div className="flex-1 p-4 md:p-6 lg:p-8 md:ml-64 overflow-x-hidden">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-foreground flex items-center gap-3">
                <Monitor className="h-7 w-7 text-primary" />
                Hotspot Monitor
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Monitoreo en tiempo real • Auto-refresh cada 10s
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1 text-xs">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                En vivo
              </Badge>
            </div>
          </div>

          {/* Main Stats - 4 cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border-l-4 border-l-primary">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Activos</p>
                    <p className="text-3xl font-bold mt-1">{isLoading ? "..." : allActiveUsers.length}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      de {hotspotUsers.length + pppoeUsers.length} registrados
                    </p>
                  </div>
                  <div className="p-3 rounded-full bg-primary/10">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-[hsl(var(--success))]">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Hotspot</p>
                    <p className="text-3xl font-bold mt-1">{isLoading ? "..." : hotspotActive.length}</p>
                    <p className="text-xs text-muted-foreground mt-1">{hotspotUsers.length} registrados</p>
                  </div>
                  <div className="p-3 rounded-full bg-[hsl(var(--success))]/10">
                    <Wifi className="h-5 w-5 text-[hsl(var(--success))]" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-[hsl(var(--warning))]">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">PPPoE</p>
                    <p className="text-3xl font-bold mt-1">{isLoading ? "..." : pppoeActive.length}</p>
                    <p className="text-xs text-muted-foreground mt-1">{pppoeUsers.length} registrados</p>
                  </div>
                  <div className="p-3 rounded-full bg-[hsl(var(--warning))]/10">
                    <Globe className="h-5 w-5 text-[hsl(var(--warning))]" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-[hsl(var(--chart-4))]">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Tráfico Total</p>
                    <p className="text-xl font-bold mt-1">{formatBytes(totalBandwidth.total)}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-green-600 flex items-center gap-0.5">
                        <ArrowDown className="h-3 w-3" />{formatBytes(totalBandwidth.in)}
                      </span>
                      <span className="text-xs text-blue-600 flex items-center gap-0.5">
                        <ArrowUp className="h-3 w-3" />{formatBytes(totalBandwidth.out)}
                      </span>
                    </div>
                  </div>
                  <div className="p-3 rounded-full bg-[hsl(var(--chart-4))]/10">
                    <Activity className="h-5 w-5 text-[hsl(var(--chart-4))]" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* System Resources Bar */}
          <Card>
            <CardContent className="py-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-1"><Zap className="h-3.5 w-3.5" /> CPU</span>
                    <span className="font-bold">{loadingSystem ? "..." : `${cpuLoad}%`}</span>
                  </div>
                  <Progress value={cpuLoad} className="h-2" />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-1"><HardDrive className="h-3.5 w-3.5" /> RAM</span>
                    <span className="font-bold">{loadingSystem ? "..." : `${memoryPercent}%`}</span>
                  </div>
                  <Progress value={memoryPercent} className="h-2" />
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Uptime</p>
                    <p className="text-sm font-semibold">{systemData?.uptime || "..."}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Board</p>
                    <p className="text-sm font-semibold">{systemData?.["board-name"] || "..."}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Connection History Chart */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Historial de Conexiones
                </CardTitle>
                <CardDescription className="text-xs">Usuarios activos en tiempo real</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[200px]">
                  {trafficHistory.length > 1 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trafficHistory}>
                        <defs>
                          <linearGradient id="gradHotspot" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(var(--success))" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="hsl(var(--success))" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="gradPppoe" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(var(--warning))" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="hsl(var(--warning))" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="time" className="text-xs" tick={{ fontSize: 10 }} />
                        <YAxis className="text-xs" tick={{ fontSize: 10 }} allowDecimals={false} />
                        <Tooltip
                          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
                        />
                        <Area type="monotone" dataKey="hotspot" name="Hotspot" stroke="hsl(var(--success))" fill="url(#gradHotspot)" strokeWidth={2} />
                        <Area type="monotone" dataKey="pppoe" name="PPPoE" stroke="hsl(var(--warning))" fill="url(#gradPppoe)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Recopilando datos...
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Profile Distribution */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Distribución por Perfil</CardTitle>
                <CardDescription className="text-xs">Usuarios activos por plan</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[200px]">
                  {profileDistribution.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={profileDistribution}
                          cx="50%"
                          cy="50%"
                          innerRadius={40}
                          outerRadius={70}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {profileDistribution.map((_, idx) => (
                            <Cell key={idx} fill={pieColors[idx % pieColors.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                      Sin datos
                    </div>
                  )}
                </div>
                {profileDistribution.length > 0 && (
                  <div className="space-y-1 mt-2">
                    {profileDistribution.map((p, i) => (
                      <div key={p.name} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: pieColors[i % pieColors.length] }} />
                          <span className="text-muted-foreground">{p.name}</span>
                        </div>
                        <span className="font-medium">{p.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Top Consumers */}
          {topConsumers.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <ArrowUpDown className="h-4 w-4 text-primary" />
                  Top 5 Consumidores
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                  {topConsumers.map((user, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{user.name}</p>
                        <p className="text-xs text-muted-foreground">
                          ↓{formatBytes(user.bytesIn)} ↑{formatBytes(user.bytesOut)}
                        </p>
                      </div>
                      <Badge variant={user.type === "hotspot" ? "default" : "secondary"} className="text-[10px] shrink-0">
                        {user.type === "hotspot" ? "HS" : "PPP"}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Active Users Table */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Usuarios Activos</CardTitle>
                  <CardDescription className="text-xs">{filteredUsers.length} conexiones</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1 md:w-64">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Buscar usuario, IP, MAC..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-9 h-9 text-sm"
                    />
                  </div>
                </div>
              </div>
              <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-2">
                <TabsList className="h-8">
                  <TabsTrigger value="all" className="text-xs h-7 px-3">
                    Todos ({allActiveUsers.length})
                  </TabsTrigger>
                  <TabsTrigger value="hotspot" className="text-xs h-7 px-3">
                    Hotspot ({hotspotActive.length})
                  </TabsTrigger>
                  <TabsTrigger value="pppoe" className="text-xs h-7 px-3">
                    PPPoE ({pppoeActive.length})
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Usuario</TableHead>
                      <TableHead className="text-xs">Tipo</TableHead>
                      <TableHead className="text-xs">IP</TableHead>
                      <TableHead className="text-xs">MAC</TableHead>
                      <TableHead className="text-xs">Perfil</TableHead>
                      <TableHead className="text-xs text-right">↓ Download</TableHead>
                      <TableHead className="text-xs text-right">↑ Upload</TableHead>
                      <TableHead className="text-xs text-right">Tiempo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.length > 0 ? (
                      filteredUsers.map((user, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium text-sm">{user.name}</TableCell>
                          <TableCell>
                            <Badge variant={user.type === "hotspot" ? "default" : "secondary"} className="text-[10px]">
                              {user.type === "hotspot" ? "Hotspot" : "PPPoE"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs font-mono">{user.ip}</TableCell>
                          <TableCell className="text-xs font-mono text-muted-foreground">{user.mac}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px]">{user.profile}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-right text-green-600 font-medium">
                            {formatBytes(user.bytesIn)}
                          </TableCell>
                          <TableCell className="text-xs text-right text-blue-600 font-medium">
                            {formatBytes(user.bytesOut)}
                          </TableCell>
                          <TableCell className="text-xs text-right text-muted-foreground">{user.uptime}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                          {isLoading ? (
                            <div className="flex items-center justify-center gap-2">
                              <RefreshCw className="h-4 w-4 animate-spin" />
                              Cargando datos de MikroTik...
                            </div>
                          ) : (
                            "No hay usuarios activos"
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
