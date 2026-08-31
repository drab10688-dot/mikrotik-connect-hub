import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { remoteDesktopMobileUrl } from "@/lib/api-client";

/**
 * Visor MÓVIL (Android/iPhone) del escritorio remoto.
 * No modifica el visor de escritorio: abre KasmVNC con la resolución adaptada
 * al celular y con la barra táctil (zoom, desplazamiento, teclado) visible.
 */
export default function RemoteDesktopMobile() {
  const [params] = useSearchParams();
  const port = Number(params.get("port")) || 8081;
  const url = useMemo(() => remoteDesktopMobileUrl(port), [port]);
  const [redirecting, setRedirecting] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("vps_auth_token");
    if (token) {
      document.cookie = `omnisync_web_token=${encodeURIComponent(token)}; Path=/; SameSite=Lax; Max-Age=43200`;
    }
    const t = setTimeout(() => {
      setRedirecting(false);
      window.location.replace(url);
    }, 300);
    return () => clearTimeout(t);
  }, [url]);

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      <p className="text-sm text-muted-foreground">
        {redirecting ? "Abriendo el escritorio remoto en tu celular…" : "Si no abre solo, toca el botón:"}
      </p>
      <a
        href={url}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        Abrir escritorio remoto
      </a>
      <p className="max-w-sm text-xs text-muted-foreground">
        En el celular: arrastra con un dedo para desplazar, pellizca para hacer zoom y usa el
        botón del teclado en la barra lateral de KasmVNC para escribir.
      </p>
    </div>
  );
}
