import { useEffect } from "react";
import { toast } from "sonner";
import { browserApi, remoteDesktopUrl } from "@/lib/api-client";

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
        const st = await browserApi.status();
        if (!st?.running) throw new Error(st?.hint || "El navegador remoto no está activo");
        await browserApi.open(target.directUrl);
        if (cancelled) return;
        // Abrir el visor del escritorio remoto en una pestaña nueva.
        window.open(remoteDesktopUrl("browser"), "_blank", "noopener,noreferrer");
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
