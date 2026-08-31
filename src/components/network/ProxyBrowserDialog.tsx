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
    // Se abre SIN "noopener" para conservar la referencia y poder redirigir
    // la pestaña al visor (con noopener window.open devuelve null y la
    // pestaña se quedaba en about:blank).
    const win = window.open("about:blank", "_blank");
    if (win) win.opener = null;

    (async () => {
      const url = remoteDesktopUrl('browser');
      try {
        await browserApi.session();
        if (cancelled) return;

        // Primero se envía la navegación al escritorio (así la pestaña remota
        // ya trae la IP/puerto del equipo) y después se muestra el visor.
        let navError = '';
        try {
          await browserApi.open(target.directUrl, target.mikrotikId);
        } catch (e: any) {
          navError = e?.message || "No hay ruta VPN hacia el equipo";
        }
        if (cancelled) return;

        if (win && !win.closed) win.location.replace(url);
        else window.open(url, "_blank");

        if (navError) toast.error(navError);
        else toast.success(`${target.title}: abriendo ${target.directUrl}`);
      } catch (e: any) {
        if (win && !win.closed) win.close();
        if (!cancelled) toast.error(e?.message || "No se pudo iniciar tu escritorio remoto");
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
