import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Clipboard, ExternalLink, Globe, Maximize, Minimize, Monitor, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface RemoteBrowserTarget {
  title: string;
  directUrl: string;
  proxyUrl?: string;
}

type Mode = "firefox" | "proxy";

export function RemoteBrowserDialog({
  target,
  onOpenChange,
}: {
  target: RemoteBrowserTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [browserKey, setBrowserKey] = useState(0);
  const [mode, setMode] = useState<Mode>("firefox");
  const [browserDown, setBrowserDown] = useState(false);

  useEffect(() => {
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  // Verifica el Firefox remoto y, si está arriba, lo lleva solo a la IP del equipo.
  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setBrowserKey((k) => k + 1);

    (async () => {
      try {
        const state = await browserApi.status();
        if (cancelled) return;
        if (!state?.running) throw new Error(state?.error || "Firefox remoto apagado");
        setBrowserDown(false);
        setMode("firefox");
        try {
          await browserApi.open(target.directUrl);
          if (!cancelled) {
            setBrowserKey((k) => k + 1);
            toast.success(`Abriendo ${target.directUrl} en Firefox remoto`);
          }
        } catch {
          if (!cancelled) toast.warning("Firefox está arriba pero no aceptó la orden; pega la dirección manualmente");
        }
      } catch {
        if (cancelled) return;
        setBrowserDown(true);
        if (target.proxyUrl) {
          setMode("proxy");
          toast.warning("Firefox remoto no disponible; usando el proxy integrado");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
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

  const iframeSrc = mode === "firefox" ? "/browser/" : target?.proxyUrl || "about:blank";

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
            <Tabs value={mode} onValueChange={(v) => { setMode(v as Mode); setBrowserKey((k) => k + 1); }}>
              <TabsList className="h-8">
                <TabsTrigger value="firefox" className="h-6 gap-1 text-xs">
                  <Globe className="h-3.5 w-3.5" /> Firefox remoto
                </TabsTrigger>
                <TabsTrigger value="proxy" disabled={!target?.proxyUrl} className="h-6 gap-1 text-xs">
                  <Monitor className="h-3.5 w-3.5" /> Proxy integrado
                </TabsTrigger>
              </TabsList>
            </Tabs>
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
          {browserDown && mode === "firefox" && (
            <div className="mt-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                El contenedor Firefox no responde (502). En el VPS ejecuta:
                <code className="ml-1 font-mono">cd /opt/omnisync &amp;&amp; docker compose up -d remote-browser &amp;&amp; docker compose logs --tail=50 remote-browser</code>
                . Mientras tanto usa el <b>Proxy integrado</b>.
              </span>
            </div>
          )}
        </DialogHeader>
        <div className="relative min-h-0 flex-1 bg-muted">
          <iframe
            key={`${mode}-${browserKey}`}
            src={iframeSrc}
            title={mode === "firefox" ? "Firefox remoto" : "Proxy integrado"}
            allow="clipboard-read; clipboard-write; fullscreen"
            className="absolute inset-0 h-full w-full border-0 bg-background"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
