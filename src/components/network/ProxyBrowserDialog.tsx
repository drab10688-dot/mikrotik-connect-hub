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
    (async () => {
      try {
        // Cada usuario tiene su propio escritorio remoto. El acceso es por el
        // puerto 8081 (HTTPS): Nginx valida el token del panel y enruta al
        // contenedor privado del usuario — sin cuadro de usuario/clave.
        // 1) Se asegura el escritorio del usuario (respuesta inmediata) y se
        //    abre el visor de una vez para no esperar a que cargue la pestaña.
        await browserApi.session();
        if (cancelled) return;
        window.open(
          remoteDesktopViewerUrl('browser', target.title),
          "_blank",
          "noopener,noreferrer",
        );
        toast.success(`${target.title}: abriendo en tu escritorio remoto`);
        // 2) La navegación al equipo se lanza en paralelo.
        browserApi.open(target.directUrl, target.mikrotikId).catch((e: any) => {
          if (!cancelled) toast.error(e?.message || "No hay ruta VPN hacia el equipo");
        });
      } catch (e: any) {
        if (!cancelled) toast.error(e?.message || "No se pudo usar el navegador remoto");
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
