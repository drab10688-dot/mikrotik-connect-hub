import { useEffect } from "react";
import { toast } from "sonner";
import { browserApi, remoteDesktopUrl } from "@/lib/api-client";


export interface ProxyBrowserTarget {
  title: string;
  directUrl: string;
  proxyUrl?: string;
  mikrotikId?: string;
}

/**
 * Abre el equipo directamente en el escritorio remoto (VNC) en una pestaña
 * nueva: lanza la URL en el Chromium del VPS y abre el visor en otra ventana.
 */
export function ProxyBrowserDialog({
  target,
  onOpenChange,
}: {
  target: ProxyBrowserTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  useEffect(() => {
    if (!target) return;

    let cancelled = false;
    // La pestaña se abre de inmediato (evita el bloqueador de ventanas) y se
    // queda en espera hasta que el equipo YA esté cargando en el escritorio.
    const win = window.open("about:blank", "_blank", "noopener,noreferrer");

    (async () => {
      try {
        await browserApi.session();
        if (cancelled) return;
        // IMPORTANTE: primero se envía la IP:puerto al escritorio y sólo
        // después se muestra el visor, así la pestaña abre ya con el equipo.
        await browserApi.open(target.directUrl, target.mikrotikId);
        if (cancelled) return;
        const url = remoteDesktopUrl('browser');
        if (win && !win.closed) win.location.replace(url);
        else window.open(url, "_blank", "noopener,noreferrer");
        toast.success(`${target.title}: abriendo ${target.directUrl}`);
      } catch (e: any) {
        if (win && !win.closed) win.close();
        if (!cancelled) toast.error(e?.message || "No hay ruta VPN hacia el equipo");
      } finally {
        if (!cancelled) onOpenChange(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [target, onOpenChange]);


  return null;
}
