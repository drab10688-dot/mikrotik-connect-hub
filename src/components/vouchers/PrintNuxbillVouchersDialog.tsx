import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Printer, Upload } from "lucide-react";
import { NuxbillVoucherCard } from "./NuxbillVoucherCard";
import { toast } from "sonner";

interface PrintNuxbillVouchersDialogProps {
  vouchers: Array<{
    code: string;
    password: string;
    profile: string;
    validity?: string;
    price?: number | string;
  }>;
  portalUrl: string;
  mikrotikId: string;
}

export const PrintNuxbillVouchersDialog = ({
  vouchers,
  portalUrl,
  mikrotikId,
}: PrintNuxbillVouchersDialogProps) => {
  const [open, setOpen] = useState(false);
  const [businessName, setBusinessName] = useState(
    () => localStorage.getItem("voucher_business_name") || "WiFi Service"
  );
  const [logo, setLogo] = useState(() => localStorage.getItem("voucher_logo") || "");
  const [layout, setLayout] = useState<"2x4" | "3x3" | "2x3">("2x4");
  const printAreaRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500 * 1024) {
      toast.error("El logo debe ser menor a 500KB");
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setLogo(reader.result as string);
      localStorage.setItem("voucher_logo", reader.result as string);
      toast.success("Logo cargado");
    };
    reader.readAsDataURL(file);
  };

  const getGridConfig = () => {
    switch (layout) {
      case "3x3": return { cols: 3, rows: 3, perPage: 9, cardWidth: "180px" };
      case "2x3": return { cols: 2, rows: 3, perPage: 6, cardWidth: "260px" };
      case "2x4": default: return { cols: 2, rows: 4, perPage: 8, cardWidth: "260px" };
    }
  };

  const handlePrint = () => {
    if (vouchers.length === 0) {
      toast.error("No hay vouchers para imprimir");
      return;
    }
    localStorage.setItem("voucher_business_name", businessName);

    const printWindow = window.open("", "_blank");
    if (!printWindow) { toast.error("No se pudo abrir la ventana de impresión"); return; }

    const content = printAreaRef.current?.innerHTML || "";
    const grid = getGridConfig();

    printWindow.document.write(`<!DOCTYPE html>
<html><head><title>Vouchers NuxBill</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @page { size: A4; margin: 10mm; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; }
  .voucher-grid {
    display: grid;
    grid-template-columns: repeat(${grid.cols}, 1fr);
    gap: 12px;
    justify-items: center;
    page-break-after: always;
  }
  .voucher-grid:last-child { page-break-after: auto; }
  .nuxbill-voucher-card { break-inside: avoid; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style></head>
<body>${content}</body></html>`);

    printWindow.document.close();
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
      printWindow.close();
    }, 800);
    toast.success(`Imprimiendo ${vouchers.length} voucher(s)`);
  };

  const grid = getGridConfig();
  const pages: typeof vouchers[] = [];
  for (let i = 0; i < vouchers.length; i += grid.perPage) {
    pages.push(vouchers.slice(i, i + grid.perPage));
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Printer className="w-4 h-4 mr-2" />
          Imprimir Tarjetas NuxBill
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Imprimir Tarjetas de Voucher</DialogTitle>
          <DialogDescription>
            Tarjetas con código QR para escanear desde el portal cautivo
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Config */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nombre del Negocio</Label>
              <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Logo</Label>
              <div className="flex gap-2">
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="flex-1">
                  <Upload className="w-4 h-4 mr-2" />
                  {logo ? "Cambiar" : "Subir Logo"}
                </Button>
                {logo && (
                  <Button variant="ghost" onClick={() => { setLogo(""); localStorage.removeItem("voucher_logo"); }}>
                    Quitar
                  </Button>
                )}
              </div>
              {logo && (
                <div className="p-2 border rounded">
                  <img src={logo} alt="Logo" className="max-h-16 mx-auto" />
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>Distribución</Label>
              <Select value={layout} onValueChange={(v) => setLayout(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="2x4">2×4 (8 por página)</SelectItem>
                  <SelectItem value="2x3">2×3 (6 por página)</SelectItem>
                  <SelectItem value="3x3">3×3 (9 por página, compacto)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handlePrint} className="w-full">
              <Printer className="w-4 h-4 mr-2" />
              Imprimir {vouchers.length} Tarjeta(s)
            </Button>
          </div>

          {/* Preview */}
          <div className="lg:col-span-2 border rounded-lg p-4 bg-muted/30 overflow-auto">
            <h3 className="font-semibold mb-4 text-center text-sm text-muted-foreground">Vista Previa</h3>
            <div className="flex flex-wrap gap-3 justify-center" style={{ transform: "scale(0.7)", transformOrigin: "top center" }}>
              {vouchers.slice(0, 4).map((v, i) => (
                <NuxbillVoucherCard
                  key={i}
                  voucher={v}
                  portalUrl={portalUrl}
                  mikrotikId={mikrotikId}
                  businessName={businessName}
                  logo={logo}
                />
              ))}
            </div>
            {vouchers.length > 4 && (
              <p className="text-center text-sm text-muted-foreground mt-4">
                + {vouchers.length - 4} tarjeta(s) más
              </p>
            )}
          </div>
        </div>

        {/* Hidden print area */}
        <div style={{ display: "none" }}>
          <div ref={printAreaRef}>
            {pages.map((page, pi) => (
              <div key={pi} className="voucher-grid">
                {page.map((v, vi) => (
                  <NuxbillVoucherCard
                    key={vi}
                    voucher={v}
                    portalUrl={portalUrl}
                    mikrotikId={mikrotikId}
                    businessName={businessName}
                    logo={logo}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
