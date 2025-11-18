import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Printer, Upload } from "lucide-react";
import { VoucherTicket } from "./VoucherTicket";
import { toast } from "sonner";
import "./voucher-print.css";

interface PrintVouchersDialogProps {
  vouchers: any[];
}

export const PrintVouchersDialog = ({ vouchers }: PrintVouchersDialogProps) => {
  const [open, setOpen] = useState(false);
  const [businessName, setBusinessName] = useState("MikroTik Hotspot");
  const [logo, setLogo] = useState("");
  const [showInstructions, setShowInstructions] = useState(true);
  const printAreaRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setLogo(reader.result as string);
        toast.success("Logo cargado correctamente");
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePrint = () => {
    if (vouchers.length === 0) {
      toast.error("No hay vouchers para imprimir");
      return;
    }

    // Guardar configuración en localStorage
    localStorage.setItem("voucher_business_name", businessName);
    localStorage.setItem("voucher_show_instructions", String(showInstructions));
    if (logo) {
      localStorage.setItem("voucher_logo", logo);
    }

    // Imprimir
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast.error("No se pudo abrir la ventana de impresión");
      return;
    }

    const printContent = printAreaRef.current?.innerHTML || "";
    
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Imprimir Vouchers</title>
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }

            @page {
              size: 80mm auto;
              margin: 0;
            }

            body {
              font-family: 'Courier New', monospace;
              width: 80mm;
              margin: 0 auto;
            }

            .voucher-ticket {
              width: 80mm;
              padding: 10px;
              page-break-after: always;
              background: white;
            }

            .voucher-ticket:last-child {
              page-break-after: auto;
            }

            .ticket-logo {
              text-align: center;
              margin-bottom: 10px;
            }

            .ticket-logo img {
              max-width: 150px;
              max-height: 60px;
              object-fit: contain;
            }

            .ticket-business-name {
              text-align: center;
              font-size: 16px;
              font-weight: bold;
              margin-bottom: 10px;
              text-transform: uppercase;
            }

            .ticket-title {
              text-align: center;
              font-size: 14px;
              font-weight: bold;
              margin: 10px 0;
            }

            .ticket-divider {
              text-align: center;
              margin: 10px 0;
              font-size: 10px;
              overflow: hidden;
            }

            .ticket-qr {
              text-align: center;
              margin: 15px 0;
            }

            .ticket-qr canvas {
              max-width: 200px;
              height: auto;
            }

            .ticket-credentials {
              margin: 15px 0;
              font-size: 12px;
            }

            .credential-row {
              margin: 8px 0;
              display: flex;
              justify-content: space-between;
            }

            .credential-label {
              font-weight: bold;
            }

            .credential-value {
              font-family: 'Courier New', monospace;
              font-weight: bold;
              font-size: 13px;
            }

            .ticket-instructions {
              margin: 15px 0;
              font-size: 11px;
            }

            .instruction-title {
              font-weight: bold;
              margin-bottom: 8px;
            }

            .ticket-instructions ol {
              margin-left: 20px;
            }

            .ticket-instructions li {
              margin: 4px 0;
            }

            .ticket-footer {
              text-align: center;
              font-size: 11px;
              margin-top: 15px;
            }

            .ticket-footer p {
              margin: 4px 0;
            }

            .ticket-date {
              font-size: 10px;
              color: #666;
            }

            .ticket-cut-line {
              text-align: center;
              margin-top: 10px;
              font-size: 10px;
              letter-spacing: 2px;
            }

            @media print {
              body {
                width: 80mm;
              }
              
              .voucher-ticket {
                page-break-after: always;
              }

              .voucher-ticket:last-child {
                page-break-after: auto;
              }
            }
          </style>
        </head>
        <body>
          ${printContent}
        </body>
      </html>
    `);

    printWindow.document.close();
    
    // Esperar a que se carguen las imágenes antes de imprimir
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
      printWindow.close();
    }, 500);

    toast.success(`Imprimiendo ${vouchers.length} ticket(s)`);
  };

  // Cargar configuración guardada
  useState(() => {
    const savedBusinessName = localStorage.getItem("voucher_business_name");
    const savedShowInstructions = localStorage.getItem("voucher_show_instructions");
    const savedLogo = localStorage.getItem("voucher_logo");

    if (savedBusinessName) setBusinessName(savedBusinessName);
    if (savedShowInstructions) setShowInstructions(savedShowInstructions === "true");
    if (savedLogo) setLogo(savedLogo);
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Printer className="w-4 h-4 mr-2" />
          Imprimir Tickets
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configurar e Imprimir Tickets</DialogTitle>
          <DialogDescription>
            Personaliza tus tickets de voucher para impresión térmica de 80mm
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Configuración */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="businessName">Nombre del Negocio</Label>
              <Input
                id="businessName"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="MikroTik Hotspot"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="logo">Logo del Negocio</Label>
              <div className="flex gap-2">
                <Input
                  ref={fileInputRef}
                  id="logo"
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {logo ? "Cambiar Logo" : "Subir Logo"}
                </Button>
                {logo && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setLogo("");
                      localStorage.removeItem("voucher_logo");
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                  >
                    Quitar
                  </Button>
                )}
              </div>
              {logo && (
                <div className="mt-2 p-2 border rounded">
                  <img src={logo} alt="Logo preview" className="max-h-20 mx-auto" />
                </div>
              )}
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="showInstructions">Mostrar Instrucciones</Label>
              <Switch
                id="showInstructions"
                checked={showInstructions}
                onCheckedChange={setShowInstructions}
              />
            </div>

            <div className="pt-4">
              <Button onClick={handlePrint} className="w-full">
                <Printer className="w-4 h-4 mr-2" />
                Imprimir {vouchers.length} Ticket(s)
              </Button>
            </div>
          </div>

          {/* Vista previa */}
          <div className="border rounded-lg p-4 bg-muted/30">
            <h3 className="font-semibold mb-4 text-center">Vista Previa</h3>
            <div className="bg-white rounded shadow-sm max-w-[302px] mx-auto">
              {vouchers.length > 0 && (
                <VoucherTicket
                  voucher={vouchers[0]}
                  logo={logo}
                  businessName={businessName}
                  showInstructions={showInstructions}
                />
              )}
            </div>
            {vouchers.length > 1 && (
              <p className="text-center text-sm text-muted-foreground mt-4">
                + {vouchers.length - 1} ticket(s) más
              </p>
            )}
          </div>
        </div>

        {/* Área de impresión oculta */}
        <div style={{ display: "none" }}>
          <div ref={printAreaRef}>
            {vouchers.map((voucher, index) => (
              <VoucherTicket
                key={index}
                voucher={voucher}
                logo={logo}
                businessName={businessName}
                showInstructions={showInstructions}
              />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
