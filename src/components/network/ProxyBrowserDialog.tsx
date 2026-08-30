import { useCallback, useEffect, useRef, useState } from "react";
import { Clipboard, ExternalLink, Globe, Maximize, Minimize, Monitor, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { browserApi } from "@/lib/api-client";

export interface ProxyBrowserTarget {
  title: string;
  directUrl: string;
  proxyUrl?: string;
}

type ViewerMode = "browser" | "proxy";

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
  const [mode, setMode] = useState<ViewerMode>("browser");
  const [status, setStatus] = useState<string>("Verificando navegador remoto…");

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
    setMode("browser");
    void (async () => {
      const ok = await launchRemote(target.directUrl, true);
      if (!ok && target.proxyUrl) {
        setMode("proxy");
        toast.message("Navegador remoto no disponible; se usará el proxy integrado");
      }
    })();
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
    if (mode === "browser" && target) await launchRemote(target.directUrl);
    else setBrowserKey((k) => k + 1);
  };

  const viewerUrl = mode === "browser" ? "/browser/" : target?.proxyUrl || "about:blank";

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
            <div className="flex items-center gap-1 rounded-md border p-0.5">
              <Button
                size="sm"
                variant={mode === "browser" ? "default" : "ghost"}
                className="h-7 px-2 text-xs"
                onClick={async () => {
                  setMode("browser");
                  if (target) await launchRemote(target.directUrl);
                }}
              >
                <Globe className="mr-1 h-3.5 w-3.5" /> Navegador
              </Button>
              <Button
                size="sm"
                variant={mode === "proxy" ? "default" : "ghost"}
                className="h-7 px-2 text-xs"
                disabled={!target?.proxyUrl}
                onClick={() => {
                  setMode("proxy");
                  setBrowserKey((k) => k + 1);
                }}
              >
                Proxy
              </Button>
            </div>
            <span className="text-xs text-muted-foreground">{mode === "browser" ? status : "Proxy integrado"}</span>
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
            key={`${mode}-${browserKey}`}
            src={viewerUrl}
            title={mode === "browser" ? "Navegador remoto" : "Proxy integrado"}
            allow="clipboard-read; clipboard-write; fullscreen"
            className="absolute inset-0 h-full w-full border-0 bg-background"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
