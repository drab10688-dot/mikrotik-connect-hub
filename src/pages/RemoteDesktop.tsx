import { useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { remoteDesktopUrl } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCw,
  Keyboard,
  ExternalLink,
  Move,
} from "lucide-react";

/**
 * Visor del escritorio remoto (KasmVNC) con controles táctiles para celular:
 * zoom, desplazamiento, pantalla completa, recarga y teclado en pantalla.
 */
export default function RemoteDesktop() {
  const [params] = useSearchParams();
  const port = Number(params.get("port")) || 8081;
  const title = params.get("title") || "Escritorio remoto";

  const [zoom, setZoom] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const shellRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const url = useMemo(() => remoteDesktopUrl(port), [port]);

  const changeZoom = (delta: number) => {
    setZoom((z) => {
      const next = Math.min(4, Math.max(1, Number((z + delta).toFixed(2))));
      // Mantiene el centro visible al ampliar/reducir.
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
        el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
      });
      return next;
    });
  };

  const goFullscreen = () => {
    const el = shellRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  };

  return (
    <div ref={shellRef} className="h-screen w-screen flex flex-col bg-background">
      <header className="flex items-center gap-1.5 border-b px-2 py-1.5 overflow-x-auto shrink-0">
        <span className="text-xs font-medium truncate mr-auto max-w-[35%]">{title}</span>

        <Button size="sm" variant="outline" onClick={() => changeZoom(-0.25)} title="Alejar">
          <ZoomOut className="w-4 h-4" />
        </Button>
        <span className="text-xs tabular-nums w-10 text-center">{Math.round(zoom * 100)}%</span>
        <Button size="sm" variant="outline" onClick={() => changeZoom(0.25)} title="Acercar">
          <ZoomIn className="w-4 h-4" />
        </Button>
        <Button size="sm" variant="outline" onClick={() => setZoom(1)} title="Ajustar a la pantalla">
          <Move className="w-4 h-4" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            // KasmVNC abre su teclado virtual desde la barra lateral del visor.
            const bar = document.getElementById("vnc-frame") as HTMLIFrameElement | null;
            bar?.focus();
            setZoom(1);
          }}
          title="Teclado: toca el icono de teclado en la pestaña lateral del visor"
        >
          <Keyboard className="w-4 h-4" />
        </Button>
        <Button size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)} title="Reconectar">
          <RotateCw className="w-4 h-4" />
        </Button>
        <Button size="sm" variant="outline" onClick={goFullscreen} title="Pantalla completa">
          <Maximize2 className="w-4 h-4" />
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
          title="Abrir en pestaña nueva"
        >
          <ExternalLink className="w-4 h-4" />
        </Button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-auto bg-black" style={{ WebkitOverflowScrolling: "touch" }}>
        <iframe
          id="vnc-frame"
          key={reloadKey}
          src={url}
          title={title}
          allow="clipboard-read; clipboard-write; fullscreen"
          className="border-0 block"
          style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%`, minWidth: "100%", minHeight: "100%" }}
        />
      </div>

      <p className="text-[11px] text-muted-foreground px-2 py-1 border-t shrink-0">
        Celular: usa +/− para el zoom y arrastra con un dedo para desplazarte. El teclado se abre desde la pestaña
        lateral del visor (icono de teclado).
      </p>
    </div>
  );
}
