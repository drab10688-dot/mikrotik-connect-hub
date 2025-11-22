import { useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Printer } from "lucide-react";
import QRCode from "qrcode";

interface VoucherQRDialogProps {
  voucher: any;
  hotspotUrl: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VoucherQRDialog({ voucher, hotspotUrl, open, onOpenChange }: VoucherQRDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (open && canvasRef.current && voucher && hotspotUrl) {
      try {
        const qrContent = hotspotUrl.includes('?') 
          ? `${hotspotUrl}&username=${voucher.code}&password=${voucher.password}`
          : `${hotspotUrl}?username=${voucher.code}&password=${voucher.password}`;
        
        QRCode.toCanvas(canvasRef.current, qrContent, {
          width: 300,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#ffffff',
          },
          errorCorrectionLevel: 'M',
        }).catch((error) => {
          console.error('Error generating QR code:', error);
        });
      } catch (error) {
        console.error('Error in QR generation:', error);
      }
    }
  }, [open, voucher, hotspotUrl]);

  const handleDownload = () => {
    if (canvasRef.current) {
      const url = canvasRef.current.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `voucher-qr-${voucher.code}.png`;
      a.click();
    }
  };

  const handlePrint = () => {
    if (canvasRef.current) {
      const printWindow = window.open('', '_blank');
      if (!printWindow) return;

      const imgData = canvasRef.current.toDataURL('image/png');
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>QR Code - ${voucher.code}</title>
            <style>
              body {
                margin: 0;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                font-family: Arial, sans-serif;
              }
              .container {
                text-align: center;
                padding: 20px;
              }
              h2 { margin: 10px 0; }
              img { margin: 20px 0; }
              .info { margin: 10px 0; font-size: 14px; }
              @media print {
                @page { margin: 0; }
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h2>Voucher WiFi</h2>
              <img src="${imgData}" alt="QR Code" style="width: 300px; height: 300px;" />
              <div class="info"><strong>Usuario:</strong> ${voucher.code}</div>
              <div class="info"><strong>Contraseña:</strong> ${voucher.password}</div>
              <div class="info"><strong>Perfil:</strong> ${voucher.profile}</div>
            </div>
            <script>
              window.onload = () => {
                setTimeout(() => window.print(), 500);
              };
              window.onafterprint = () => window.close();
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();
    }
  };

  if (!voucher) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Código QR del Voucher</DialogTitle>
          <DialogDescription>
            Escanea este código para conectarte al WiFi
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex flex-col items-center space-y-4 py-4">
          <canvas ref={canvasRef} className="border rounded-lg" />
          
          <div className="w-full space-y-2 text-center">
            <div className="text-sm">
              <span className="font-semibold">Usuario:</span> {voucher.code}
            </div>
            <div className="text-sm">
              <span className="font-semibold">Contraseña:</span> {voucher.password}
            </div>
            <div className="text-sm text-muted-foreground">
              Perfil: {voucher.profile}
            </div>
          </div>

          <div className="flex gap-2 w-full">
            <Button onClick={handleDownload} variant="outline" className="flex-1">
              <Download className="h-4 w-4 mr-2" />
              Descargar
            </Button>
            <Button onClick={handlePrint} variant="outline" className="flex-1">
              <Printer className="h-4 w-4 mr-2" />
              Imprimir
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}