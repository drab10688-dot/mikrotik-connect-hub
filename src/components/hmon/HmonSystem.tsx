import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useSystemResources } from "@/hooks/useMikrotikData";
import { hotspotApi } from "@/lib/api-client";
import { getSelectedDeviceId } from "@/lib/mikrotik";
import { Power, PowerOff, Timer, Zap, HardDrive, Clock, Server, Calendar } from "lucide-react";
import { toast } from "sonner";

export function HmonSystem({ section }: { section: string }) {
  const deviceId = getSelectedDeviceId() || "";
  const { data: systemInfo, isLoading } = useSystemResources();
  const sys = (systemInfo as any[])?.[0];
  const [confirmAction, setConfirmAction] = useState<"reboot" | "shutdown" | null>(null);

  const cpu = parseInt(sys?.["cpu-load"] || "0");
  const totalMem = parseInt(sys?.["total-memory"] || "0");
  const freeMem = parseInt(sys?.["free-memory"] || "0");
  const memPct = totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 100) : 0;

  const rebootMutation = useMutation({
    mutationFn: () => hotspotApi.reboot(deviceId),
    onSuccess: () => { toast.success("Router reiniciando..."); setConfirmAction(null); },
    onError: (e: any) => toast.error(e.message || "Error"),
  });

  const shutdownMutation = useMutation({
    mutationFn: () => hotspotApi.shutdown(deviceId),
    onSuccess: () => { toast.success("Router apagándose..."); setConfirmAction(null); },
    onError: (e: any) => toast.error(e.message || "Error"),
  });

  const { data: schedulerData = [], isLoading: schedulerLoading } = useQuery({
    queryKey: ["hmon-scheduler", deviceId],
    queryFn: () => deviceId ? hotspotApi.scheduler(deviceId) : [],
    enabled: !!deviceId && section === "scheduler",
    refetchInterval: 30000,
  });

  if (!deviceId) return <div className="text-center py-12 text-muted-foreground text-sm">No hay dispositivo conectado</div>;

  if (section === "reboot") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2"><Power className="h-5 w-5 text-primary" /><h2 className="text-lg font-bold">Reiniciar Router</h2></div>
        <Card>
          <CardContent className="py-8 text-center space-y-4">
            <Power className="h-12 w-12 text-primary mx-auto" />
            <p className="text-sm text-muted-foreground">Reiniciar el router MikroTik. Todos los usuarios activos serán desconectados temporalmente.</p>
            <Button variant="destructive" onClick={() => setConfirmAction("reboot")} disabled={rebootMutation.isPending}>
              <Power className="h-4 w-4 mr-2" />Reiniciar Router
            </Button>
          </CardContent>
        </Card>
        <AlertDialog open={confirmAction === "reboot"} onOpenChange={() => setConfirmAction(null)}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>¿Reiniciar Router?</AlertDialogTitle><AlertDialogDescription>Todos los usuarios activos serán desconectados.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => rebootMutation.mutate()} className="bg-destructive hover:bg-destructive/90">Reiniciar</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  if (section === "shutdown") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2"><PowerOff className="h-5 w-5 text-destructive" /><h2 className="text-lg font-bold">Apagar Router</h2></div>
        <Card>
          <CardContent className="py-8 text-center space-y-4">
            <PowerOff className="h-12 w-12 text-destructive mx-auto" />
            <p className="text-sm text-muted-foreground">Apagar el router MikroTik. Se requiere acceso físico para volver a encenderlo.</p>
            <Button variant="destructive" onClick={() => setConfirmAction("shutdown")} disabled={shutdownMutation.isPending}>
              <PowerOff className="h-4 w-4 mr-2" />Apagar Router
            </Button>
          </CardContent>
        </Card>
        <AlertDialog open={confirmAction === "shutdown"} onOpenChange={() => setConfirmAction(null)}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>¿Apagar Router?</AlertDialogTitle><AlertDialogDescription>Necesitarás acceso físico para encenderlo de nuevo.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => shutdownMutation.mutate()} className="bg-destructive hover:bg-destructive/90">Apagar</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // Scheduler section
  if (section === "scheduler") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2"><Calendar className="h-5 w-5 text-primary" /><h2 className="text-lg font-bold">Programador</h2></div>
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="text-[10px]">Nombre</TableHead>
                  <TableHead className="text-[10px]">Inicio</TableHead>
                  <TableHead className="text-[10px]">Intervalo</TableHead>
                  <TableHead className="text-[10px]">Próximo</TableHead>
                  <TableHead className="text-[10px]">Estado</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {schedulerLoading ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-xs text-muted-foreground">Cargando...</TableCell></TableRow>
                  ) : schedulerData.length > 0 ? schedulerData.map((s: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-medium">{s.name || "-"}</TableCell>
                      <TableCell className="text-[10px]">{s["start-date"] || "-"} {s["start-time"] || ""}</TableCell>
                      <TableCell className="text-[10px]">{s.interval || "none"}</TableCell>
                      <TableCell className="text-[10px]">{s["next-run"] || "-"}</TableCell>
                      <TableCell><Badge variant={s.disabled === "true" ? "secondary" : "default"} className="text-[9px]">{s.disabled === "true" ? "Inactivo" : "Activo"}</Badge></TableCell>
                    </TableRow>
                  )) : (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-xs">Sin tareas programadas</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Default: system info
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><Timer className="h-5 w-5 text-primary" /><h2 className="text-lg font-bold">Sistema</h2></div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-3 space-y-1.5">
          <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground flex items-center gap-1"><Zap className="h-3 w-3" />CPU</span><span className="font-bold">{isLoading ? "..." : `${cpu}%`}</span></div>
          <Progress value={cpu} className="h-1.5" />
        </CardContent></Card>
        <Card><CardContent className="p-3 space-y-1.5">
          <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground flex items-center gap-1"><HardDrive className="h-3 w-3" />RAM</span><span className="font-bold">{isLoading ? "..." : `${memPct}%`}</span></div>
          <Progress value={memPct} className="h-1.5" />
        </CardContent></Card>
        <Card><CardContent className="p-3 flex items-center gap-2"><Clock className="h-3.5 w-3.5 text-muted-foreground" /><div><p className="text-[10px] text-muted-foreground">Uptime</p><p className="text-xs font-semibold">{sys?.uptime || "..."}</p></div></CardContent></Card>
        <Card><CardContent className="p-3 flex items-center gap-2"><Server className="h-3.5 w-3.5 text-muted-foreground" /><div><p className="text-[10px] text-muted-foreground">Board</p><p className="text-xs font-semibold">{sys?.["board-name"] || "..."}</p></div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Información del Sistema</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div><span className="text-muted-foreground">Versión:</span> <span className="font-medium">{sys?.version || "..."}</span></div>
            <div><span className="text-muted-foreground">Arquitectura:</span> <span className="font-medium">{sys?.["architecture-name"] || "..."}</span></div>
            <div><span className="text-muted-foreground">Plataforma:</span> <span className="font-medium">{sys?.platform || "..."}</span></div>
            <div><span className="text-muted-foreground">CPU:</span> <span className="font-medium">{sys?.cpu || "..."} ({sys?.["cpu-count"] || "?"})</span></div>
            <div><span className="text-muted-foreground">HDD Libre:</span> <span className="font-medium">{sys?.["free-hdd-space"] ? `${(parseInt(sys["free-hdd-space"]) / 1048576).toFixed(1)} MB` : "..."}</span></div>
            <div><span className="text-muted-foreground">Modelo:</span> <span className="font-medium">{sys?.["board-name"] || "..."}</span></div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
