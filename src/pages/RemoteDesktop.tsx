import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { remoteDesktopUrl } from "@/lib/api-client";

/**
 * Ruta heredada /vnc: el visor propio interfería con KasmVNC (pantalla negra y
 * sin gestos en celular). Ahora redirige DIRECTO al escritorio remoto, que trae
 * su propia barra táctil con zoom, desplazamiento y teclado en pantalla.
 */
export default function RemoteDesktop() {
  const [params] = useSearchParams();
  const port = Number(params.get("port")) || 8081;
  const url = useMemo(() => remoteDesktopUrl(port), [port]);

  useEffect(() => {
    // Cookie del panel para que los assets/websocket de KasmVNC pasen la
    // autorización de Nginx (no llevan ?token).
    const token = localStorage.getItem("vps_auth_token");
    if (token) {
      document.cookie = `omnisync_web_token=${encodeURIComponent(token)}; Path=/; SameSite=Lax; Max-Age=43200`;
    }
    window.location.replace(url);
  }, [url]);

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-background">
      <p className="text-sm text-muted-foreground">Abriendo el escritorio remoto…</p>
    </div>
  );
}
