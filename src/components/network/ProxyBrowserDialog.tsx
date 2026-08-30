import { useEffect, useRef, useState } from "react";
import { Clipboard, ExternalLink, Maximize, Minimize, Monitor, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

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

  useEffect(() => {
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  useEffect(() => {
    if (!target) return;
    setBrowserKey((k) => k + 1);
  }, [target]);

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

  const iframeSrc = target?.proxyUrl || "about:blank";

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
            <span className="text-xs text-muted-foreground">Proxy integrado</span>
            <div className="ml-auto flex items-center gap-1">
              <Button size="icon" variant="ghost" title="Recargar" onClick={() => setBrowserKey((key) => key + 1)}>
                <RotateCw className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" title={fullscreen ? "Salir de pantalla completa" : "Pantalla completa"} onClick={toggleFullscreen}>
                {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Input value={target?.directUrl || ""} readOnly className="h-9 min-w-0 font-mono text-xs" />
            <Button size="sm" variant="outline" onClick={copyUrl}>
              <Clipboard className="mr-1 h-4 w-4" /> Copiar
            </Button>
            {target?.proxyUrl && (
              <Button size="sm" variant="outline" asChild>
                <a href={target.proxyUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-1 h-4 w-4" /> Nueva pestaña
                </a>
              </Button>
            )}
          </div>
        </DialogHeader>
        <div className="relative min-h-0 flex-1 bg-muted">
          <iframe
            key={browserKey}
            src={iframeSrc}
            title="Proxy integrado"
            allow="clipboard-read; clipboard-write; fullscreen"
            className="absolute inset-0 h-full w-full border-0 bg-background"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
