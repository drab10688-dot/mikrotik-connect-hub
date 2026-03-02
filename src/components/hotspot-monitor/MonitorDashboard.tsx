import { useState, useMemo, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Wifi, Users, Activity, HardDrive, Clock, ArrowUpDown,
  Search, RefreshCw, Signal, ArrowDown, ArrowUp,
  Zap, Server, Globe, TrendingUp
} from "lucide-react";
import { useHotspotActiveUsers, usePPPoEActive, useSystemResources, useHotspotUsers, usePPPoEUsers } from "@/hooks/useMikrotikData";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

export function MonitorDashboard() {
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

  useEffect(() => {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
    const newEntry = { time: timeStr, hotspot: hotspotActive.length, pppoe: pppoeActive.length, total: hotspotActive.length + pppoeActive.length };
    trafficHistoryRef.current = [...trafficHistoryRef.current.slice(-29), newEntry];
    setTrafficHistory([...trafficHistoryRef.current]);
  }, [hotspotActive.length, pppoeActive.length]);

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

  const totalBandwidth = useMemo(() => {
    let totalIn = 0, totalOut = 0;
    hotspotActive.forEach((u: any) => { totalIn += parseInt(u["bytes-in"] || "0"); totalOut += parseInt(u["bytes-out"] || "0"); });
    pppoeActive.forEach((u: any) => { totalIn += parseInt(u["bytes-in"] || "0"); totalOut += parseInt(u["bytes-out"] || "0"); });
    return { in: totalIn, out: totalOut, total: totalIn + totalOut };
  }, [hotspotActive, pppoeActive]);

  const allActiveUsers = useMemo(() => {
    const hotspot = hotspotActive.map((u: any) => ({
      name: u.user || u.name || "Sin nombre", ip: u.address || u["caller-id"] || "-",
      mac: u["mac-address"] || "-", profile: u.profile || "default", uptime: u.uptime || "0s",
      bytesIn: parseInt(u["bytes-in"] || "0"), bytesOut: parseInt(u["bytes-out"] || "0"), type: "hotspot" as const,
    }));
    const pppoe = pppoeActive.map((u: any) => ({
      name: u.name || "Sin nombre", ip: u.address || u["caller-id"] || "-",
      mac: u["caller-id"] || "-", profile: u.profile || "default", uptime: u.uptime || "0s",
      bytesIn: parseInt(u["bytes-in"] || "0"), bytesOut: parseInt(u["bytes-out"] || "0"), type: "pppoe" as const,
    }));
    return [...hotspot, ...pppoe];
  }, [hotspotActive, pppoeActive]);

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

  const profileDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    allActiveUsers.forEach(u => { counts[u.profile] = (counts[u.profile] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [allActiveUsers]);

  const pieColors = ["hsl(var(--primary))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];

  const topConsumers = useMemo(() =>
    [...allActiveUsers].sort((a, b) => (b.bytesIn + b.bytesOut) - (a.bytesIn + a.bytesOut)).slice(0, 5),
    [allActiveUsers]
  );

  const isLoading = loadingHotspot || loadingPPPoE || loadingSystem;

  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-l-4 border-l-primary">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Total Activos</p>
                <p className="text-2xl font-bold">{isLoading ? "..." : allActiveUsers.length}</p>
                <p className="text-[10px] text-muted-foreground">de {hotspotUsers.length + pppoeUsers.length} reg.</p>
              </div>
              <div className="p-2 rounded-full bg-primary/10"><Users className="h-4 w-4 text-primary" /></div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-[hsl(var(--chart-2))]">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Hotspot</p>
                <p className="text-2xl font-bold">{isLoading ? "..." : hotspotActive.length}</p>
                <p className="text-[10px] text-muted-foreground">{hotspotUsers.length} reg.</p>
              </div>
              <div className="p-2 rounded-full bg-[hsl(var(--chart-2))]/10"><Wifi className="h-4 w-4 text-[hsl(var(--chart-2))]" /></div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-[hsl(var(--chart-3))]">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">PPPoE</p>
                <p className="text-2xl font-bold">{isLoading ? "..." : pppoeActive.length}</p>
                <p className="text-[10px] text-muted-foreground">{pppoeUsers.length} reg.</p>
              </div>
              <div className="p-2 rounded-full bg-[hsl(var(--chart-3))]/10"><Globe className="h-4 w-4 text-[hsl(var(--chart-3))]" /></div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-[hsl(var(--chart-4))]">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Tráfico</p>
                <p className="text-lg font-bold">{formatBytes(totalBandwidth.total)}</p>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-chart-2 flex items-center"><ArrowDown className="h-2.5 w-2.5" />{formatBytes(totalBandwidth.in)}</span>
                  <span className="text-[10px] text-chart-4 flex items-center"><ArrowUp className="h-2.5 w-2.5" />{formatBytes(totalBandwidth.out)}</span>
                </div>
              </div>
              <div className="p-2 rounded-full bg-[hsl(var(--chart-4))]/10"><Activity className="h-4 w-4 text-[hsl(var(--chart-4))]" /></div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* System Resources */}
      <Card>
        <CardContent className="py-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1"><Zap className="h-3 w-3" /> CPU</span>
                <span className="font-bold">{loadingSystem ? "..." : `${cpuLoad}%`}</span>
              </div>
              <Progress value={cpuLoad} className="h-1.5" />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1"><HardDrive className="h-3 w-3" /> RAM</span>
                <span className="font-bold">{loadingSystem ? "..." : `${memoryPercent}%`}</span>
              </div>
              <Progress value={memoryPercent} className="h-1.5" />
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <div>
                <p className="text-[10px] text-muted-foreground">Uptime</p>
                <p className="text-xs font-semibold">{systemData?.uptime || "..."}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Server className="h-3.5 w-3.5 text-muted-foreground" />
              <div>
                <p className="text-[10px] text-muted-foreground">Board</p>
                <p className="text-xs font-semibold">{systemData?.["board-name"] || "..."}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-3.5 w-3.5 text-primary" /> Historial de Conexiones</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="h-[180px]">
              {trafficHistory.length > 1 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trafficHistory}>
                    <defs>
                      <linearGradient id="gradHS" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradPP" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--chart-3))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--chart-3))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="time" tick={{ fontSize: 9 }} />
                    <YAxis tick={{ fontSize: 9 }} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "11px" }} />
                    <Area type="monotone" dataKey="hotspot" name="Hotspot" stroke="hsl(var(--chart-2))" fill="url(#gradHS)" strokeWidth={2} />
                    <Area type="monotone" dataKey="pppoe" name="PPPoE" stroke="hsl(var(--chart-3))" fill="url(#gradPP)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
                  <RefreshCw className="h-3.5 w-3.5 mr-2 animate-spin" /> Recopilando datos...
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-sm">Distribución por Perfil</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="h-[140px]">
              {profileDistribution.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={profileDistribution} cx="50%" cy="50%" innerRadius={30} outerRadius={55} paddingAngle={3} dataKey="value">
                      {profileDistribution.map((_, idx) => (<Cell key={idx} fill={pieColors[idx % pieColors.length]} />))}
                    </Pie>
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "11px" }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-xs">Sin datos</div>
              )}
            </div>
            {profileDistribution.length > 0 && (
              <div className="space-y-0.5 mt-1">
                {profileDistribution.map((p, i) => (
                  <div key={p.name} className="flex items-center justify-between text-[10px]">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: pieColors[i % pieColors.length] }} />
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
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2"><ArrowUpDown className="h-3.5 w-3.5 text-primary" /> Top 5 Consumidores</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
              {topConsumers.map((user, i) => (
                <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 border">
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">{i + 1}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{user.name}</p>
                    <p className="text-[10px] text-muted-foreground">↓{formatBytes(user.bytesIn)} ↑{formatBytes(user.bytesOut)}</p>
                  </div>
                  <Badge variant={user.type === "hotspot" ? "default" : "secondary"} className="text-[9px] shrink-0">{user.type === "hotspot" ? "HS" : "PPP"}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active Users Table */}
      <Card>
        <CardHeader className="pb-2 pt-3 px-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm">Usuarios Activos</CardTitle>
              <CardDescription className="text-[10px]">{filteredUsers.length} conexiones</CardDescription>
            </div>
            <div className="relative md:w-56">
              <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-7 h-7 text-xs" />
            </div>
          </div>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-1">
            <TabsList className="h-7">
              <TabsTrigger value="all" className="text-[10px] h-6 px-2">Todos ({allActiveUsers.length})</TabsTrigger>
              <TabsTrigger value="hotspot" className="text-[10px] h-6 px-2">Hotspot ({hotspotActive.length})</TabsTrigger>
              <TabsTrigger value="pppoe" className="text-[10px] h-6 px-2">PPPoE ({pppoeActive.length})</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px]">Usuario</TableHead>
                  <TableHead className="text-[10px]">Tipo</TableHead>
                  <TableHead className="text-[10px]">IP</TableHead>
                  <TableHead className="text-[10px]">MAC</TableHead>
                  <TableHead className="text-[10px]">Perfil</TableHead>
                  <TableHead className="text-[10px] text-right">↓ DL</TableHead>
                  <TableHead className="text-[10px] text-right">↑ UL</TableHead>
                  <TableHead className="text-[10px] text-right">Tiempo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.length > 0 ? (
                  filteredUsers.map((user, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium text-xs">{user.name}</TableCell>
                      <TableCell><Badge variant={user.type === "hotspot" ? "default" : "secondary"} className="text-[9px]">{user.type === "hotspot" ? "HS" : "PPP"}</Badge></TableCell>
                      <TableCell className="text-[10px] font-mono">{user.ip}</TableCell>
                      <TableCell className="text-[10px] font-mono text-muted-foreground">{user.mac}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[9px]">{user.profile}</Badge></TableCell>
                      <TableCell className="text-[10px] text-right text-chart-2 font-medium">{formatBytes(user.bytesIn)}</TableCell>
                      <TableCell className="text-[10px] text-right text-chart-4 font-medium">{formatBytes(user.bytesOut)}</TableCell>
                      <TableCell className="text-[10px] text-right text-muted-foreground">{user.uptime}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-xs">
                      {isLoading ? (<div className="flex items-center justify-center gap-2"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Cargando...</div>) : "No hay usuarios activos"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
