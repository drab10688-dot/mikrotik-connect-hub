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
        const opened = await browserApi.open(target.directUrl);
        if (cancelled) return;
        const port = Number(opened?.port) || 8081;
        window.open(
          remoteDesktopViewerUrl(port, target.title, { user: opened?.user, password: opened?.password }),
          "_blank",
          "noopener,noreferrer",
        );
        toast.success(`${target.title}: abriendo en el escritorio remoto`);
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
