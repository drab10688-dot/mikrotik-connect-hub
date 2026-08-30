import { useCallback, useEffect, useRef, useState } from "react";
import { Clipboard, ExternalLink, Maximize, Minimize, Monitor, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { browserApi, withAuthToken, remoteDesktopUrl } from "@/lib/api-client";

export interface ProxyBrowserTarget {
  title: string;
  directUrl: string;
  proxyUrl?: string;
}

export function ProxyBrowserDialog({
  target,
  onOpenChange,
}: {
  target: ProxyBrowserTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [browserKey, setBrowserKey] = useState(0);
  const [status, setStatus] = useState<string>("Verificando navegador remoto…");
  const [embedded, setEmbedded] = useState(false);

  useEffect(() => {
    setEmbedded(false);
  }, [browserKey]);


  useEffect(() => {
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  const launchRemote = useCallback(
    async (url: string, silent = false) => {
      setStatus("Abriendo en el navegador remoto…");
      try {
        const st = await browserApi.status();
        if (!st?.running) throw new Error(st?.hint || "El navegador remoto no está activo");
        await browserApi.open(url);
        setStatus("Navegador remoto listo");
        setBrowserKey((k) => k + 1);
        return true;
      } catch (e: any) {
        setStatus(e?.message || "No se pudo usar el navegador remoto");
        if (!silent) toast.error(e?.message || "No se pudo usar el navegador remoto");
        return false;
      }
    },
    []
  );

  useEffect(() => {
    if (!target) return;
    setBrowserKey((k) => k + 1);
    void launchRemote(target.directUrl, true);
  }, [target, launchRemote]);

  const copyUrl = async () => {
    if (!target) return;
    try {
      await navigator.clipboard.writeText(target.directUrl);
      toast.success("Dirección copiada");
    } catch {
      toast.error("No se pudo copiar; selecciona la dirección manualmente");
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await wrapRef.current?.requestFullscreen();
    } catch {
      toast.error("El navegador no permitió pantalla completa");
    }
  };

  const reload = async () => {
    if (target) await launchRemote(target.directUrl);
    else setBrowserKey((k) => k + 1);
  };

  // El escritorio remoto no pide clave propia: Nginx valida el token de sesión.
  const viewerUrl = remoteDesktopUrl("browser");

  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent
        ref={wrapRef}
        className="flex h-[92vh] w-[98vw] max-w-none flex-col gap-0 overflow-hidden p-0 sm:rounded-md"
      >
        <DialogHeader className="border-b bg-background px-4 py-3 pr-12">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="flex min-w-0 items-center gap-2 text-sm">
              <Monitor className="h-4 w-4 shrink-0" />
              <span className="truncate">{target?.title}</span>
            </DialogTitle>
            <span className="text-xs text-muted-foreground">{status}</span>
            <div className="ml-auto flex items-center gap-1">
              <Button size="icon" variant="ghost" title="Recargar" onClick={reload}>
                <RotateCw className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                title={fullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
                onClick={toggleFullscreen}
              >
                {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Input value={target?.directUrl || ""} readOnly className="h-9 min-w-0 font-mono text-xs" />
            <Button size="sm" variant="outline" onClick={copyUrl}>
              <Clipboard className="mr-1 h-4 w-4" /> Copiar
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={viewerUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1 h-4 w-4" /> Nueva pestaña
              </a>
            </Button>
          </div>
        </DialogHeader>
        <div className="relative min-h-0 flex-1 bg-muted">
          <iframe
            key={browserKey}
            src={viewerUrl}
            title="Navegador remoto"
            allow="clipboard-read; clipboard-write; fullscreen"
            className="absolute inset-0 h-full w-full border-0 bg-background"
            onLoad={() => setEmbedded(true)}
          />
          {!embedded && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/95 p-6 text-center">
              <Monitor className="h-8 w-8 text-muted-foreground" />
              <p className="max-w-md text-sm text-muted-foreground">
                El escritorio remoto usa un certificado propio del VPS. Si ves la pantalla en negro, ábrelo una vez
                en una pestaña nueva y acepta el aviso del certificado; después funcionará dentro del panel.
              </p>
              <div className="flex gap-2">
                <Button size="sm" asChild>
                  <a href={viewerUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-1 h-4 w-4" /> Abrir escritorio en pestaña nueva
                  </a>
                </Button>
                <Button size="sm" variant="outline" onClick={() => setBrowserKey((k) => k + 1)}>
                  <RotateCw className="mr-1 h-4 w-4" /> Reintentar aquí
                </Button>
              </div>
            </div>
          )}
        </div>

      </DialogContent>
    </Dialog>
  );
}
