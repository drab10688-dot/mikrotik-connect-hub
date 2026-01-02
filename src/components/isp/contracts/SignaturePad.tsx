import { useRef, useEffect, useState, useCallback } from "react";
import SignaturePadLib from "signature_pad";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Eraser, Check, PenTool } from "lucide-react";

interface SignaturePadProps {
  onSignatureComplete: (signatureDataUrl: string) => void;
  onClear?: () => void;
  title?: string;
  description?: string;
}

export function SignaturePad({
  onSignatureComplete,
  onClear,
  title = "Firma del Cliente",
  description = "Firme dentro del recuadro usando el mouse o su dedo en pantallas táctiles"
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const signaturePadRef = useRef<SignaturePadLib | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const container = canvas.parentElement;
    if (!container) return;

    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const width = container.offsetWidth;
    const height = 200;

    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(ratio, ratio);
    }

    if (signaturePadRef.current) {
      signaturePadRef.current.clear();
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    signaturePadRef.current = new SignaturePadLib(canvas, {
      backgroundColor: "rgb(255, 255, 255)",
      penColor: "rgb(0, 0, 0)",
      minWidth: 1,
      maxWidth: 3,
    });

    signaturePadRef.current.addEventListener("beginStroke", () => {
      setIsEmpty(false);
    });

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      signaturePadRef.current?.off();
    };
  }, [resizeCanvas]);

  const handleClear = () => {
    signaturePadRef.current?.clear();
    setIsEmpty(true);
    onClear?.();
  };

  const handleConfirm = () => {
    if (signaturePadRef.current && !signaturePadRef.current.isEmpty()) {
      const dataUrl = signaturePadRef.current.toDataURL("image/png");
      onSignatureComplete(dataUrl);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <PenTool className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="border-2 border-dashed border-muted-foreground/30 rounded-lg overflow-hidden bg-white">
          <canvas
            ref={canvasRef}
            className="touch-none cursor-crosshair w-full"
          />
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleClear}
            className="flex-1"
          >
            <Eraser className="w-4 h-4 mr-2" />
            Limpiar
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={isEmpty}
            className="flex-1"
          >
            <Check className="w-4 h-4 mr-2" />
            Confirmar Firma
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
