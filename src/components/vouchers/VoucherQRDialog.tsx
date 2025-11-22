import { useEffect, useState } from "react";
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
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");

  useEffect(() => {
    if (open && voucher && hotspotUrl) {
      // Construir URL del portal captive con credenciales
      const loginUrl = hotspotUrl.includes('?') 
        ? `${hotspotUrl}&username=${voucher.code}&password=${voucher.password}`
        : `${hotspotUrl}?username=${voucher.code}&password=${voucher.password}`;
      
      console.log('Generating QR with URL:', loginUrl);
      
      QRCode.toDataURL(loginUrl, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
        errorCorrectionLevel: 'H',
      }).then((url) => {
        console.log('QR Code generated successfully');
        setQrCodeUrl(url);
      }).catch((error) => {
        console.error('Error generating QR code:', error);
      });
    }
  }, [open, voucher, hotspotUrl]);

  const handleDownload = () => {
    if (qrCodeUrl) {
      const a = document.createElement('a');
      a.href = qrCodeUrl;
      a.download = `voucher-qr-${voucher.code}.png`;
      a.click();
    }
  };

  const handlePrint = () => {
    if (qrCodeUrl) {
      const printWindow = window.open('', '_blank');
      if (!printWindow) return;

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>QR Code - ${voucher.profile}</title>
            <style>
              body {
                margin: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                font-family: Arial, sans-serif;
              }
              .container {
                text-align: center;
                padding: 20px;
              }
              img { display: block; margin: 0 auto; }
              .info { margin-top: 20px; font-size: 18px; font-weight: bold; }
              @media print {
                @page { margin: 0; }
              }
            </style>
          </head>
          <body>
            <div class="container">
              <img src="${qrCodeUrl}" alt="QR Code" style="width: 300px; height: 300px;" />
              <div class="info">${voucher.profile}</div>
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
          <div className="bg-white p-4 rounded-lg border">
            {qrCodeUrl ? (
              <img src={qrCodeUrl} alt="QR Code" className="w-[300px] h-[300px]" />
            ) : (
              <div className="w-[300px] h-[300px] flex items-center justify-center">
                <span className="text-muted-foreground">Generando QR...</span>
              </div>
            )}
          </div>
          
          <div className="w-full space-y-2 text-center">
            <div className="text-lg font-semibold">
              {voucher.profile}
            </div>
          </div>

          <div className="flex gap-2 w-full">
            <Button onClick={handleDownload} variant="outline" className="flex-1" disabled={!qrCodeUrl}>
              <Download className="h-4 w-4 mr-2" />
              Descargar
            </Button>
            <Button onClick={handlePrint} variant="outline" className="flex-1" disabled={!qrCodeUrl}>
              <Printer className="h-4 w-4 mr-2" />
              Imprimir
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
