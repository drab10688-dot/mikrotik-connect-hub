import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { cpeApi } from "@/lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import KpiCard, { type KpiTone } from "@/components/dashboard/KpiCard";
import { Cable, PlugZap, RadioTower, RotateCcw, SignalLow, Unplug, Users, UserX, Wifi, WifiOff } from "lucide-react";

/**
 * Salud de los clientes POR SEDE (cada MikroTik / VPN). La API ya entrega solo
 * las sedes que el usuario puede ver: el admin todas las de su ISP, el
 * técnico solo los routers que tiene asignados.
 */
export function ClientHealthSummary() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["cpe-summary-all"],
    queryFn: () => cpeApi.summaryAll(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
  const sedes: any[] = data?.sedes || [];
  const [sedeId, setSedeId] = useState<string>("");

  // Sede inicial: la última elegida en el panel (si la puede ver) o la primera
  useEffect(() => {
    if (!sedes.length || sedes.some((s) => s.id === sedeId)) return;
    const stored = localStorage.getItem("mikrotik_device_id");
    setSedeId(sedes.some((s) => s.id === stored) ? stored! : sedes[0].id);
  }, [sedes, sedeId]);

  const s: any = sedes.find((x) => x.id === sedeId) || {};
  const choose = (id: string) => {
    setSedeId(id);
    localStorage.setItem("mikrotik_device_id", id);
  };
  const openAntennas = () => {
    if (sedeId) localStorage.setItem("mikrotik_device_id", sedeId);
    navigate("/mikrotik");
  };

  const n = (v: any) => (s.ok ? Number(v) || 0 : 0);
  const kpis: { label: string; value: number; icon: any; tone: KpiTone; hint?: string }[] = [
    { label: "PPPoE conectados", value: n(s.pppoe_active), icon: Users, tone: "success", hint: "sesiones activas ahora" },
    { label: "PPPoE caídos", value: n(s.pppoe_down), icon: UserX, tone: "danger", hint: `usuarios del router sin sesión (de ${n(s.pppoe_total)}; RADIUS no cuenta)` },
    { label: "DHCP activos", value: n(s.dhcp_active), icon: Wifi, tone: "info", hint: s.dhcp_down ? `${s.dhcp_down} fijos sin conexión` : undefined },
    { label: "Antenas responden", value: n(s.antennas_responding), icon: RadioTower, tone: "success", hint: `de ${n(s.antennas_known)} identificadas` },
    { label: "Antenas sin respuesta", value: n(s.antennas_silent), icon: WifiOff, tone: "warning", hint: "cliente conectado, antena no contesta" },
    { label: "LAN desconectada", value: n(s.lan_down), icon: Unplug, tone: "danger", hint: "router del cliente o cable" },
    { label: "LAN lenta", value: n(s.lan_slow), icon: Cable, tone: "warning", hint: "10 Mbps o half-duplex: cable/conector" },
    { label: "Señal mala", value: n(s.signal_bad), icon: SignalLow, tone: "warning", hint: "peor que −75 dBm" },
    { label: "Reiniciadas hoy", value: n(s.rebooted_today), icon: RotateCcw, tone: "neutral", hint: "encendidas hace < 24 h: corte de luz, fuente o PoE" },
  ];

  if (!isLoading && !sedes.length) return null;

  return (
    <Card className="mb-8">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2"><PlugZap className="w-5 h-5 text-primary" /> Clientes y antenas</CardTitle>
          <CardDescription>
            Por sede (MikroTik / VPN). Las antenas se revisan solas cada 15 min; la LAN se lee en las que el panel ya identificó.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={sedeId} onValueChange={choose}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Sede" /></SelectTrigger>
            <SelectContent>
              {sedes.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={openAntennas} disabled={!sedeId}>Ver antenas</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {sedeId && !s.ok && !isLoading && (
          <p className="text-sm text-amber-600 dark:text-amber-400">El router de esta sede no respondió; revisa su VPN en el Monitor de red.</p>
        )}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {kpis.map((k) => (
            <KpiCard key={k.label} label={k.label} value={k.value} icon={k.icon} tone={k.tone} hint={k.hint} loading={isLoading} onClick={openAntennas} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
