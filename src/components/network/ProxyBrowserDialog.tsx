import { useEffect } from "react";
import { toast } from "sonner";
import { browserApi, remoteDesktopViewerUrl } from "@/lib/api-client";

export interface ProxyBrowserTarget {
  title: string;
  directUrl: string;
  proxyUrl?: string;
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
        // Cada usuario tiene su propio escritorio remoto (puerto y credenciales
        // temporales): nadie ve las pestañas de otro operador.
        // 1) Se asegura el escritorio del usuario (respuesta inmediata) y se
        //    abre el visor de una vez para no esperar a que cargue la pestaña.
        const session = await browserApi.session();
        if (cancelled) return;
        const port = Number(session?.port) || 8081;
        window.open(
          remoteDesktopViewerUrl(port, target.title, { user: session?.user, password: session?.password }),
          "_blank",
          "noopener,noreferrer",
        );
        toast.success(`${target.title}: abriendo en el escritorio remoto`);
        // 2) La navegación al equipo se lanza en paralelo.
        browserApi.open(target.directUrl).catch(() => undefined);
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
