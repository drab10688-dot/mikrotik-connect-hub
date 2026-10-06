import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { browserApi, remoteDesktopUrl, remoteDesktopMobileUrl, isMobileDevice } from "@/lib/api-client";
import { useMyPermissions } from "@/hooks/usePermissions";


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
  const { can } = useMyPermissions();

  useEffect(() => {
    if (!target) {
      startedTargetRef.current = null;
      return;
    }

    const targetKey = `${target.directUrl}|${target.mikrotikId || ""}`;
    if (startedTargetRef.current === targetKey) return;
    startedTargetRef.current = targetKey;

    // Técnicos: el escritorio remoto es un permiso aparte que da el admin
    if (!can("escritorio")) {
      toast.error("No tienes permiso para el escritorio remoto. Pídeselo al administrador de tu ISP.");
      onOpenChangeRef.current(false);
      return;
    }

    // Se abre SIN "noopener" para conservar la referencia y poder redirigir
    // la pestaña al visor (con noopener window.open devuelve null y la
    // pestaña se quedaba en about:blank).
    const win = window.open("about:blank", "_blank");
    if (win) win.opener = null;

    (async () => {
      // En celular se usa la variante móvil (resolución de teléfono + barra
      // táctil); en portátil se conserva EXACTAMENTE el visor que ya funciona.
      const mobile = isMobileDevice();
      const url = mobile ? remoteDesktopMobileUrl('browser') : remoteDesktopUrl('browser');
      try {
        // Primero se crea Chromium con la IP y el puerto como página inicial.
        // Sólo después se dirige esta misma pestaña al visor. Si el visor se
        // abre antes, auth_request crea un navegador vacío y se pierde la URL.
        const res = await browserApi.open(target.directUrl, target.mikrotikId, mobile);

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
