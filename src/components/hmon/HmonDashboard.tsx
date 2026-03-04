import { useState, useMemo, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Wifi, Users, Activity, HardDrive, Clock,
  Search, RefreshCw, ArrowDown, ArrowUp,
  Zap, Server, Globe, TrendingUp
} from "lucide-react";
import { useHotspotActiveUsers, usePPPoEActive, useSystemResources, useHotspotUsers, usePPPoEUsers } from "@/hooks/useMikrotikData";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const formatBytes = (bytes: number) => {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

const PIE_COLORS = ["hsl(var(--primary))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];

export function HmonDashboard() {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const historyRef = useRef<{ time: string; hotspot: number; pppoe: number }[]>([]);
  const [history, setHistory] = useState<typeof historyRef.current>([]);

  const { data: hotspotActiveData, isLoading: l1 } = useHotspotActiveUsers();
  const { data: pppoeActiveData, isLoading: l2 } = usePPPoEActive();
  const { data: systemInfo, isLoading: l3 } = useSystemResources();
  const { data: hotspotUsersData } = useHotspotUsers();
  const { data: pppoeUsersData } = usePPPoEUsers();

  const ha = useMemo(() => (Array.isArray(hotspotActiveData) ? hotspotActiveData : []), [hotspotActiveData]);
  const pa = useMemo(() => (Array.isArray(pppoeActiveData) ? pppoeActiveData : []), [pppoeActiveData]);
  const hu = useMemo(() => (Array.isArray(hotspotUsersData) ? hotspotUsersData : []), [hotspotUsersData]);
  const pu = useMemo(() => (Array.isArray(pppoeUsersData) ? pppoeUsersData : []), [pppoeUsersData]);
  const sys = (systemInfo as any[])?.[0];

  useEffect(() => {
    const now = new Date();
    const t = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
    historyRef.current = [...historyRef.current.slice(-29), { time: t, hotspot: ha.length, pppoe: pa.length }];
    setHistory([...historyRef.current]);
  }, [ha.length, pa.length]);

  const cpu = parseInt(sys?.["cpu-load"] || "0");
  const totalMem = parseInt(sys?.["total-memory"] || "0");
  const freeMem = parseInt(sys?.["free-memory"] || "0");
  const memPct = totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 100) : 0;

  const bw = useMemo(() => {
    let i = 0, o = 0;
    ha.forEach((u: any) => { i += parseInt(u["bytes-in"] || "0"); o += parseInt(u["bytes-out"] || "0"); });
    pa.forEach((u: any) => { i += parseInt(u["bytes-in"] || "0"); o += parseInt(u["bytes-out"] || "0"); });
    return { in: i, out: o, total: i + o };
  }, [ha, pa]);

  const allActive = useMemo(() => {
    const hs = ha.map((u: any) => ({ name: u.user || u.name || "-", ip: u.address || "-", mac: u["mac-address"] || "-", profile: u.profile || "default", uptime: u.uptime || "0s", bytesIn: parseInt(u["bytes-in"] || "0"), bytesOut: parseInt(u["bytes-out"] || "0"), type: "hotspot" as const }));
    const pp = pa.map((u: any) => ({ name: u.name || "-", ip: u.address || "-", mac: u["caller-id"] || "-", profile: u.profile || "default", uptime: u.uptime || "0s", bytesIn: parseInt(u["bytes-in"] || "0"), bytesOut: parseInt(u["bytes-out"] || "0"), type: "pppoe" as const }));
    return [...hs, ...pp];
  }, [ha, pa]);

  const filtered = useMemo(() => {
    let list = allActive;
    if (activeTab === "hotspot") list = list.filter(u => u.type === "hotspot");
    if (activeTab === "pppoe") list = list.filter(u => u.type === "pppoe");
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      list = list.filter(u => u.name.toLowerCase().includes(s) || u.ip.includes(s) || u.mac.toLowerCase().includes(s));
    }
    return list;
  }, [allActive, activeTab, searchTerm]);

  const profileDist = useMemo(() => {
    const c: Record<string, number> = {};
    allActive.forEach(u => { c[u.profile] = (c[u.profile] || 0) + 1; });
    return Object.entries(c).map(([name, value]) => ({ name, value }));
  }, [allActive]);

  const top5 = useMemo(() => [...allActive].sort((a, b) => (b.bytesIn + b.bytesOut) - (a.bytesIn + a.bytesOut)).slice(0, 5), [allActive]);

  const loading = l1 || l2 || l3;

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-l-4 border-l-primary">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Total Activos</p>
                <p className="text-2xl font-bold">{loading ? "..." : allActive.length}</p>
                <p className="text-[10px] text-muted-foreground">de {hu.length + pu.length} registrados</p>
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
                <p className="text-2xl font-bold">{loading ? "..." : ha.length}</p>
                <p className="text-[10px] text-muted-foreground">{hu.length} reg.</p>
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
                <p className="text-2xl font-bold">{loading ? "..." : pa.length}</p>
                <p className="text-[10px] text-muted-foreground">{pu.length} reg.</p>
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
                <p className="text-lg font-bold">{formatBytes(bw.total)}</p>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] flex items-center text-[hsl(var(--chart-2))]"><ArrowDown className="h-2.5 w-2.5" />{formatBytes(bw.in)}</span>
                  <span className="text-[10px] flex items-center text-[hsl(var(--chart-4))]"><ArrowUp className="h-2.5 w-2.5" />{formatBytes(bw.out)}</span>
                </div>
              </div>
              <div className="p-2 rounded-full bg-[hsl(var(--chart-4))]/10"><Activity className="h-4 w-4 text-[hsl(var(--chart-4))]" /></div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* System */}
      <Card>
        <CardContent className="py-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground flex items-center gap-1"><Zap className="h-3 w-3" /> CPU</span><span className="font-bold">{l3 ? "..." : `${cpu}%`}</span></div>
              <Progress value={cpu} className="h-1.5" />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground flex items-center gap-1"><HardDrive className="h-3 w-3" /> RAM</span><span className="font-bold">{l3 ? "..." : `${memPct}%`}</span></div>
              <Progress value={memPct} className="h-1.5" />
            </div>
            <div className="flex items-center gap-2"><Clock className="h-3.5 w-3.5 text-muted-foreground" /><div><p className="text-[10px] text-muted-foreground">Uptime</p><p className="text-xs font-semibold">{sys?.uptime || "..."}</p></div></div>
            <div className="flex items-center gap-2"><Server className="h-3.5 w-3.5 text-muted-foreground" /><div><p className="text-[10px] text-muted-foreground">Board</p><p className="text-xs font-semibold">{sys?.["board-name"] || "..."}</p></div></div>
          </div>
        </CardContent>
      </Card>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-3.5 w-3.5 text-primary" /> Historial</CardTitle></CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="h-[180px]">
              {history.length > 1 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history}>
                    <defs>
                      <linearGradient id="gHS" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.3} /><stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0} /></linearGradient>
                      <linearGradient id="gPP" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(var(--chart-3))" stopOpacity={0.3} /><stop offset="95%" stopColor="hsl(var(--chart-3))" stopOpacity={0} /></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="time" tick={{ fontSize: 9 }} /><YAxis tick={{ fontSize: 9 }} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "11px" }} />
                    <Area type="monotone" dataKey="hotspot" name="Hotspot" stroke="hsl(var(--chart-2))" fill="url(#gHS)" strokeWidth={2} />
                    <Area type="monotone" dataKey="pppoe" name="PPPoE" stroke="hsl(var(--chart-3))" fill="url(#gPP)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-xs"><RefreshCw className="h-3.5 w-3.5 mr-2 animate-spin" /> Recopilando datos...</div>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-sm">Perfiles</CardTitle></CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="h-[140px]">
              {profileDist.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={profileDist} cx="50%" cy="50%" innerRadius={30} outerRadius={55} paddingAngle={3} dataKey="value">{profileDist.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}</Pie><Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "11px" }} /></PieChart>
                </ResponsiveContainer>
              ) : <div className="flex items-center justify-center h-full text-muted-foreground text-xs">Sin datos</div>}
            </div>
            {profileDist.map((p, i) => (
              <div key={p.name} className="flex items-center justify-between text-[10px]">
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} /><span className="text-muted-foreground">{p.name}</span></div>
                <span className="font-medium">{p.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Top 5 */}
      {top5.length > 0 && (
        <Card>
          <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-sm">Top 5 Consumidores</CardTitle></CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
              {top5.map((u, i) => (
                <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 border">
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">{i + 1}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{u.name}</p>
                    <p className="text-[10px] text-muted-foreground">↓{formatBytes(u.bytesIn)} ↑{formatBytes(u.bytesOut)}</p>
                  </div>
                  <Badge variant={u.type === "hotspot" ? "default" : "secondary"} className="text-[9px] shrink-0">{u.type === "hotspot" ? "HS" : "PPP"}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Users Table */}
      <Card>
        <CardHeader className="pb-2 pt-3 px-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
            <CardTitle className="text-sm">Usuarios Activos ({filtered.length})</CardTitle>
            <div className="relative md:w-56"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" /><Input placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-7 h-7 text-xs" /></div>
          </div>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-1">
            <TabsList className="h-7">
              <TabsTrigger value="all" className="text-[10px] h-6 px-2">Todos ({allActive.length})</TabsTrigger>
              <TabsTrigger value="hotspot" className="text-[10px] h-6 px-2">Hotspot ({ha.length})</TabsTrigger>
              <TabsTrigger value="pppoe" className="text-[10px] h-6 px-2">PPPoE ({pa.length})</TabsTrigger>
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
                  <TableHead className="text-[10px] text-right">Uptime</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length > 0 ? filtered.map((u, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs font-medium">{u.name}</TableCell>
                    <TableCell><Badge variant={u.type === "hotspot" ? "default" : "secondary"} className="text-[9px]">{u.type === "hotspot" ? "HS" : "PPP"}</Badge></TableCell>
                    <TableCell className="text-[10px] font-mono">{u.ip}</TableCell>
                    <TableCell className="text-[10px] font-mono text-muted-foreground">{u.mac}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[9px]">{u.profile}</Badge></TableCell>
                    <TableCell className="text-[10px] text-right text-[hsl(var(--chart-2))]">{formatBytes(u.bytesIn)}</TableCell>
                    <TableCell className="text-[10px] text-right text-[hsl(var(--chart-4))]">{formatBytes(u.bytesOut)}</TableCell>
                    <TableCell className="text-[10px] text-right text-muted-foreground">{u.uptime}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-xs">Sin usuarios activos</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
