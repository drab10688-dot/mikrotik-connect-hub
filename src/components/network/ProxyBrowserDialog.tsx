import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { browserApi, remoteDesktopUrl, remoteDesktopMobileUrl, isMobileDevice } from "@/lib/api-client";


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
  const startedTargetRef = useRef<string | null>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  useEffect(() => {
    if (!target) {
      startedTargetRef.current = null;
      return;
    }

    const targetKey = `${target.directUrl}|${target.mikrotikId || ""}`;
    if (startedTargetRef.current === targetKey) return;
    startedTargetRef.current = targetKey;

    // Se abre SIN "noopener" para conservar la referencia y poder redirigir
    // la pestaña al visor (con noopener window.open devuelve null y la
    // pestaña se quedaba en about:blank).
    const win = window.open("about:blank", "_blank");
    if (win) win.opener = null;

    (async () => {
      // En celular se usa la variante móvil (resolución adaptada + barra táctil);
      // en portátil se conserva EXACTAMENTE el visor que ya funciona.
      const url = isMobileDevice() ? remoteDesktopMobileUrl('browser') : remoteDesktopUrl('browser');
      try {
        // Primero se crea Chromium con la IP y el puerto como página inicial.
        // Sólo después se dirige esta misma pestaña al visor. Si el visor se
        // abre antes, auth_request crea un navegador vacío y se pierde la URL.
        await browserApi.open(target.directUrl, target.mikrotikId);

        if (win && !win.closed) win.location.replace(url);
        else window.open(url, "_blank");
        toast.success(`${target.title}: abriendo ${target.directUrl}`);
      } catch (e: any) {
        if (win && !win.closed) win.close();
        toast.error(e?.message || "No se pudo iniciar tu escritorio remoto");
      } finally {
        onOpenChangeRef.current(false);
      }
    })();

  }, [target]);


  return null;
}
