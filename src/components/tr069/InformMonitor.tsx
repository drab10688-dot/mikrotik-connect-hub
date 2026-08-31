import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api-client";
import { RefreshCw, RadioTower, AlertTriangle } from "lucide-react";

interface InformDevice {
  deviceId: string;
  serial: string;
  manufacturer: string | null;
  model: string | null;
  lastInform: string | null;
  secondsAgo: number | null;
  urlToken: string | null;
  visible: boolean;
}

interface MonitorData {
  acsOnline: boolean;
  unrestricted: boolean;
  totals: { acs: number; visible: number; informing5m: number };
  devices: InformDevice[];
}

const ago = (s: number | null) => {
  if (s === null) return "sin reportes";
  if (s < 60) return `hace ${s}s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
};

const InformMonitor = () => {
  const [data, setData] = useState<MonitorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (spinner = true) => {
    if (spinner) setLoading(true);
    try {
      const res = await api("/genieacs/inform-monitor");
      setData(res as MonitorData);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "No se pudo consultar el ACS");
    } finally {
      if (spinner) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = window.setInterval(() => load(false), 5000);
    return () => window.clearInterval(t);
  }, [load]);

  const totals = data?.totals;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <RadioTower className="w-5 h-5 text-primary" />
          </div>
          <div>
            <CardTitle>Monitor TR-069 en vivo</CardTitle>
            <CardDescription>
              Muestra si el ACS está recibiendo reportes (Inform) de las ONUs. Se actualiza cada 5 s.
            </CardDescription>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={data?.acsOnline === false || error ? "destructive" : "secondary"}>
            ACS {data?.acsOnline === false || error ? "sin conexión" : "en línea"}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {totals && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { l: "Reportando (5 min)", v: totals.informing5m },
              { l: "ONUs de este ISP", v: totals.visible },
              { l: "Vistas por el ACS", v: totals.acs },
            ].map((k) => (
              <div key={k.l} className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{k.l}</p>
                <p className="text-2xl font-semibold">{k.v}</p>
              </div>
            ))}
          </div>
        )}


        {!loading && data && data.devices.length === 0 ? (
          <p className="text-muted-foreground text-center py-6 text-sm">
            El ACS no ha recibido ningún Inform. Verifica la URL TR-069 en la ONU y que tenga ruta hacia el servidor.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ONU</TableHead>
                <TableHead>Enlace</TableHead>
                <TableHead className="text-right">Último Inform</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.devices || []).slice(0, 15).map((d) => {
                const live = d.secondsAgo !== null && d.secondsAgo <= 300;
                return (
                  <TableRow key={d.deviceId}>
                    <TableCell>
                      <div className="font-medium">{d.serial}</div>
                      <div className="text-xs text-muted-foreground">
                        {[d.manufacturer, d.model].filter(Boolean).join(" ") || "—"}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{d.urlToken ? `token ${d.urlToken}` : "sin token"}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={live ? "secondary" : "destructive"}>{ago(d.secondsAgo)}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

export default InformMonitor;
