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
        // La IP/puerto se pasa directo al arrancar el escritorio: Chromium
        // abre ya cargando el equipo (como antes). El visor se muestra de
        // inmediato y KasmVNC aparece en cuanto el contenedor termina.
        if (win && !win.closed) win.location.replace(url);
        else window.open(url, "_blank");

        let navError = '';
        let opened = false;
        for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
          try {
            await browserApi.open(target.directUrl, target.mikrotikId);
            opened = true;
            break;
          } catch (e: any) {
            navError = e?.message || "No hay ruta VPN hacia el equipo";
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
        if (cancelled) return;

        if (opened) toast.success(`${target.title}: abriendo ${target.directUrl}`);
        else toast.error(navError);
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
