import { useState, useMemo, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useHotspotActiveUsers, usePPPoEActive } from "@/hooks/useMikrotikData";
import { Search, ScrollText, Clock } from "lucide-react";

interface LogEntry {
  time: string;
  user: string;
  ip: string;
  type: "hotspot" | "pppoe";
  event: "connect" | "disconnect";
}

export function HmonLog() {
  const [search, setSearch] = useState("");
  const logRef = useRef<LogEntry[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const prevHS = useRef<Set<string>>(new Set());
  const prevPP = useRef<Set<string>>(new Set());

  const { data: haData } = useHotspotActiveUsers();
  const { data: paData } = usePPPoEActive();
  const ha = useMemo(() => (Array.isArray(haData) ? haData : []), [haData]);
  const pa = useMemo(() => (Array.isArray(paData) ? paData : []), [paData]);

  useEffect(() => {
    const now = new Date();
    const t = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
    const curHS = new Set(ha.map((u: any) => u.user || u.name || "unknown"));
    const curPP = new Set(pa.map((u: any) => u.name || "unknown"));
    const entries: LogEntry[] = [];

    curHS.forEach(user => { if (!prevHS.current.has(user)) { const u = ha.find((h: any) => (h.user || h.name) === user); entries.push({ time: t, user, ip: u?.address || "-", type: "hotspot", event: "connect" }); } });
    prevHS.current.forEach(user => { if (!curHS.has(user)) entries.push({ time: t, user, ip: "-", type: "hotspot", event: "disconnect" }); });
    curPP.forEach(user => { if (!prevPP.current.has(user)) { const u = pa.find((h: any) => h.name === user); entries.push({ time: t, user, ip: u?.address || "-", type: "pppoe", event: "connect" }); } });
    prevPP.current.forEach(user => { if (!curPP.has(user)) entries.push({ time: t, user, ip: "-", type: "pppoe", event: "disconnect" }); });

    prevHS.current = curHS;
    prevPP.current = curPP;
    if (entries.length > 0) { logRef.current = [...entries, ...logRef.current].slice(0, 200); setLogs([...logRef.current]); }
  }, [ha, pa]);

  const filtered = useMemo(() => {
    if (!search) return logs;
    const s = search.toLowerCase();
    return logs.filter(l => l.user.toLowerCase().includes(s) || l.ip.includes(s));
  }, [logs, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScrollText className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold">Log de Conexiones</h2>
          <Badge variant="outline" className="text-[10px]">{logs.length} eventos</Badge>
        </div>
        <div className="relative md:w-56"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" /><Input placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-7 h-7 text-xs" /></div>
      </div>
      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[500px]">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-[10px] w-20">Hora</TableHead>
                <TableHead className="text-[10px]">Usuario (IP)</TableHead>
                <TableHead className="text-[10px]">Evento</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filtered.length > 0 ? filtered.map((log, i) => (
                  <TableRow key={i} className={log.event === "disconnect" ? "opacity-60" : ""}>
                    <TableCell className="text-[10px] font-mono text-muted-foreground"><div className="flex items-center gap-1"><Clock className="h-2.5 w-2.5" />{log.time}</div></TableCell>
                    <TableCell className="text-xs"><span className="font-medium">{log.user}</span><span className="text-[10px] text-muted-foreground ml-1">({log.ip})</span></TableCell>
                    <TableCell>
                      <Badge variant={log.event === "connect" ? "default" : "destructive"} className="text-[9px]">{log.event === "connect" ? "login" : "logout"}</Badge>
                      <Badge variant="outline" className="text-[9px] ml-1">{log.type === "hotspot" ? "HS" : "PPP"}</Badge>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={3} className="text-center py-12 text-muted-foreground text-xs">Esperando eventos...</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
