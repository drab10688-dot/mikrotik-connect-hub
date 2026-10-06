import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { cpeApi } from "@/lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import KpiCard, { type KpiTone } from "@/components/dashboard/KpiCard";
import { Cable, PlugZap, RadioTower, RotateCcw, SignalLow, Unplug, Users, UserX, Wifi, WifiOff } from "lucide-react";

type Totals = Record<string, number>;

/**
 * Salud de los clientes del ISP (todas las sedes que el usuario puede ver):
 * conexiones PPPoE y DHCP, antenas que responden y problemas del lado del
 * cliente detectados en la antena (LAN caída o lenta, señal, reinicios).
 */
export function ClientHealthSummary() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["cpe-summary-all"],
    queryFn: () => cpeApi.summaryAll(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
  const t: Totals = data?.total || {};
  const sedes: any[] = data?.sedes || [];

  const openSede = (id?: string) => {
    if (id) localStorage.setItem("mikrotik_device_id", id);
    navigate("/mikrotik");
  };

  const kpis: { label: string; value: number; icon: any; tone: KpiTone; hint?: string }[] = [
    { label: "PPPoE conectados", value: t.pppoe_active || 0, icon: Users, tone: "success", hint: `de ${t.pppoe_total || 0} habilitados` },
    { label: "PPPoE caídos", value: t.pppoe_down || 0, icon: UserX, tone: "danger", hint: "habilitados sin sesión" },
    { label: "DHCP activos", value: t.dhcp_active || 0, icon: Wifi, tone: "info", hint: t.dhcp_down ? `${t.dhcp_down} fijos sin conexión` : undefined },
    { label: "Antenas responden", value: t.antennas_responding || 0, icon: RadioTower, tone: "success", hint: `de ${t.antennas_known || 0} identificadas` },
    { label: "Antenas sin respuesta", value: t.antennas_silent || 0, icon: WifiOff, tone: "warning", hint: "cliente conectado, antena no contesta" },
    { label: "LAN desconectada", value: t.lan_down || 0, icon: Unplug, tone: "danger", hint: "router del cliente o cable" },
    { label: "LAN lenta", value: t.lan_slow || 0, icon: Cable, tone: "warning", hint: "10 Mbps o half-duplex: cable/conector" },
    { label: "Señal mala", value: t.signal_bad || 0, icon: SignalLow, tone: "warning", hint: "peor que −75 dBm" },
    { label: "Reiniciadas hoy", value: t.rebooted_today || 0, icon: RotateCcw, tone: "neutral", hint: "encendidas hace < 24 h: fuente/PoE o luz" },
  ];

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><PlugZap className="w-5 h-5 text-primary" /> Clientes y antenas</CardTitle>
        <CardDescription>
          Conexiones de tus sedes y lo que reportan las antenas de los clientes (se revisan solas cada 15 min; la LAN se lee en
          las antenas que el panel ya identificó).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {kpis.map((k) => (
            <KpiCard key={k.label} label={k.label} value={k.value} icon={k.icon} tone={k.tone} hint={k.hint} loading={isLoading} onClick={() => openSede()} />
          ))}
        </div>

        {sedes.length > 1 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3">Sede</th>
                  <th className="py-2 pr-3 text-right">PPPoE</th>
                  <th className="py-2 pr-3 text-right">Caídos</th>
                  <th className="py-2 pr-3 text-right">DHCP</th>
                  <th className="py-2 pr-3 text-right">Antenas</th>
                  <th className="py-2 pr-3 text-right">LAN caída</th>
                  <th className="py-2 pr-3 text-right">LAN lenta</th>
                  <th className="py-2 text-right">Señal mala</th>
                </tr>
              </thead>
              <tbody>
                {sedes.map((s) => (
                  <tr key={s.id} className="border-b last:border-0 cursor-pointer hover:bg-muted/40" onClick={() => openSede(s.id)} title="Abrir la sede">
                    <td className="py-2 pr-3 font-medium">
                      {s.name}
                      {!s.ok && <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">sin respuesta del router</span>}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{s.ok ? `${s.pppoe_active} / ${s.pppoe_total}` : "—"}</td>
                    <td className={`py-2 pr-3 text-right tabular-nums ${s.pppoe_down ? "text-destructive" : ""}`}>{s.ok ? s.pppoe_down : "—"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{s.ok ? s.dhcp_active : "—"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {s.ok ? `${s.antennas_responding} / ${s.antennas_known}` : "—"}
                      {s.antennas_silent > 0 && <div className="text-[11px] text-amber-600 dark:text-amber-400">{s.antennas_silent} sin respuesta</div>}
                    </td>
                    <td className={`py-2 pr-3 text-right tabular-nums ${s.lan_down ? "text-destructive" : ""}`}>{s.ok ? s.lan_down : "—"}</td>
                    <td className={`py-2 pr-3 text-right tabular-nums ${s.lan_slow ? "text-amber-600 dark:text-amber-400" : ""}`}>{s.ok ? s.lan_slow : "—"}</td>
                    <td className="py-2 text-right tabular-nums">{s.ok ? s.signal_bad : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
