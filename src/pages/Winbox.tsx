import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Copy, Loader2, MonitorCog, Power, ExternalLink, Router } from "lucide-react";
import { getToken, remoteDesktopUrl } from "@/lib/api-client";
import { winboxApi } from "@/lib/winbox-api";

/**
 * WinBox remoto: cada usuario tiene su propio WinBox 4 en el VPS, que solo
 * alcanza los routers de su ISP por la VPN. Desde ahí se usa RoMON para llegar
 * a las antenas MikroTik detrás de cada router.
 */
export default function Winbox() {
  const qc = useQueryClient();
  const [opening, setOpening] = useState(false);
  const [closing, setClosing] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["winbox-status"],
    queryFn: () => winboxApi.status(),
    refetchInterval: 30_000,
  });
  const routers = data?.routers || [];

  const open = async () => {
    // La pestaña se abre en el clic (si no, el navegador la bloquea) y se
    // dirige al visor cuando el WinBox está listo y aislado.
    const tab = window.open("", "_blank");
    setOpening(true);
    try {
      await winboxApi.session();
      const token = getToken();
      if (token) {
        document.cookie = `omnisync_web_token=${encodeURIComponent(token)}; Path=/; SameSite=Lax; Max-Age=43200`;
      }
      const url = remoteDesktopUrl("winbox");
      if (tab) tab.location.href = url;
      else window.location.href = url;
      qc.invalidateQueries({ queryKey: ["winbox-status"] });
    } catch (e: any) {
      tab?.close();
      toast.error(e?.message || "No se pudo abrir WinBox");
    } finally {
      setOpening(false);
    }
  };

  const close = async () => {
    setClosing(true);
    try {
      await winboxApi.close();
      toast.success("WinBox cerrado: se borraron las direcciones y claves guardadas");
      qc.invalidateQueries({ queryKey: ["winbox-status"] });
    } catch (e: any) {
      toast.error(e?.message || "No se pudo cerrar WinBox");
    } finally {
      setClosing(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copiado: ${text}`);
    } catch {
      toast.info(text);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="p-4 md:p-8 md:ml-64 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <MonitorCog className="h-6 w-6 text-primary" /> WinBox remoto
            </h1>
            <p className="text-sm text-muted-foreground">
              WinBox 4 en el servidor, solo para ti. Llega a tus routers por la VPN y, con RoMON, a las antenas MikroTik.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {data?.running && (
              <Button variant="outline" onClick={close} disabled={closing}>
                {closing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />} Cerrar WinBox
              </Button>
            )}
            <Button onClick={open} disabled={opening || isLoading || data?.installed === false}>
              {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />} Abrir WinBox
            </Button>
          </div>
        </header>

        {data?.installed === false && (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              WinBox todavía no está instalado en el servidor. El administrador debe ejecutar <code>update.sh</code>.
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Tus routers</CardTitle>
            <CardDescription>
              En WinBox, escribe la dirección en <b>Connect to</b> con el usuario y la clave del router.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
            {!isLoading && !routers.length && (
              <p className="text-sm text-muted-foreground">No tienes routers asignados con VPN activa.</p>
            )}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {routers.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 rounded-md border p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-medium truncate">
                      <Router className="h-4 w-4 shrink-0 text-primary" /> {r.name}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">{r.address}</div>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => copy(r.address)} aria-label={`Copiar ${r.address}`}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Llegar a las antenas con RoMON</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <ol className="list-decimal space-y-1 pl-5">
              <li>Escribe la dirección del router de la sede, su usuario y clave, y pulsa <b>Connect to RoMON</b> (en vez de Connect).</li>
              <li>En la pestaña <b>RoMON Neighbors</b> aparecen las antenas MikroTik de esa sede.</li>
              <li>Elige una antena y entra con su usuario y clave.</li>
            </ol>
            <p className="text-muted-foreground">
              El router debe tener RoMON activo (<code>/tool romon set enabled=yes</code>), igual que las antenas.
              {" "}Tu WinBox se cierra solo tras {data?.idleMinutes ?? 15} minutos sin usarlo{" "}
              <Badge variant="outline" className="ml-1">no guarda claves</Badge>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
