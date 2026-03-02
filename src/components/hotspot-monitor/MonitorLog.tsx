import { useState, useMemo, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export function MonitorLog() {
  const [searchTerm, setSearchTerm] = useState("");
  const logRef = useRef<LogEntry[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const prevHotspot = useRef<Set<string>>(new Set());
  const prevPppoe = useRef<Set<string>>(new Set());

  const { data: hotspotActiveData } = useHotspotActiveUsers();
  const { data: pppoeActiveData } = usePPPoEActive();

  const hotspotActive = useMemo(() => (Array.isArray(hotspotActiveData) ? hotspotActiveData : []), [hotspotActiveData]);
  const pppoeActive = useMemo(() => (Array.isArray(pppoeActiveData) ? pppoeActiveData : []), [pppoeActiveData]);

  // Detect connection/disconnection events
  useEffect(() => {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;

    const currentHotspot = new Set(hotspotActive.map((u: any) => u.user || u.name || "unknown"));
    const currentPppoe = new Set(pppoeActive.map((u: any) => u.name || "unknown"));

    const newEntries: LogEntry[] = [];

    // New hotspot connections
    currentHotspot.forEach(user => {
      if (!prevHotspot.current.has(user)) {
        const u = hotspotActive.find((h: any) => (h.user || h.name) === user);
        newEntries.push({ time: timeStr, user, ip: u?.address || "-", type: "hotspot", event: "connect" });
      }
    });
    // Hotspot disconnections
    prevHotspot.current.forEach(user => {
      if (!currentHotspot.has(user)) {
        newEntries.push({ time: timeStr, user, ip: "-", type: "hotspot", event: "disconnect" });
      }
    });

    // New PPPoE connections
    currentPppoe.forEach(user => {
      if (!prevPppoe.current.has(user)) {
        const u = pppoeActive.find((h: any) => h.name === user);
        newEntries.push({ time: timeStr, user, ip: u?.address || "-", type: "pppoe", event: "connect" });
      }
    });
    // PPPoE disconnections
    prevPppoe.current.forEach(user => {
      if (!currentPppoe.has(user)) {
        newEntries.push({ time: timeStr, user, ip: "-", type: "pppoe", event: "disconnect" });
      }
    });

    prevHotspot.current = currentHotspot;
    prevPppoe.current = currentPppoe;

    if (newEntries.length > 0) {
      logRef.current = [...newEntries, ...logRef.current].slice(0, 200);
      setLogs([...logRef.current]);
    }
  }, [hotspotActive, pppoeActive]);

  const filteredLogs = useMemo(() => {
    if (!searchTerm) return logs;
    const term = searchTerm.toLowerCase();
    return logs.filter(l => l.user.toLowerCase().includes(term) || l.ip.includes(term));
  }, [logs, searchTerm]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScrollText className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold">Hotspot Log</h2>
          <Badge variant="outline" className="text-[10px]">{logs.length} eventos</Badge>
        </div>
        <div className="relative md:w-56">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-7 h-7 text-xs" />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[500px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px] w-20">Hora</TableHead>
                  <TableHead className="text-[10px]">Usuario (IP)</TableHead>
                  <TableHead className="text-[10px]">Mensaje</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.length > 0 ? filteredLogs.map((log, i) => (
                  <TableRow key={i} className={log.event === "disconnect" ? "opacity-60" : ""}>
                    <TableCell className="text-[10px] font-mono text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" />
                        {log.time}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className="font-medium">{log.user}</span>
                      <span className="text-[10px] text-muted-foreground ml-1">({log.ip})</span>
                    </TableCell>
                    <TableCell>
                      <Badge 
                        variant={log.event === "connect" ? "default" : "destructive"} 
                        className="text-[9px]"
                      >
                        {log.event === "connect" ? "login" : "logout"}
                      </Badge>
                      <Badge variant="outline" className="text-[9px] ml-1">
                        {log.type === "hotspot" ? "HS" : "PPP"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-12 text-muted-foreground text-xs">
                      Esperando eventos de conexión/desconexión...
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
