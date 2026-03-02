import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { devicesApi } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useVoucherInventory } from "@/hooks/useVoucherInventory";
import { useVoucherPresets } from "@/hooks/useVoucherPresets";
import { VoucherInventoryCard } from "@/components/vouchers/VoucherInventoryCard";
import { VoucherTable } from "@/components/vouchers/VoucherTable";
import { VoucherPresetsManager } from "@/components/vouchers/VoucherPresetsManager";
import { VoucherReports } from "@/components/vouchers/VoucherReports";
import { VoucherSalesHistory } from "@/components/vouchers/VoucherSalesHistory";
import { VoucherQRDialog } from "@/components/vouchers/VoucherQRDialog";
import { ResellerManagement } from "@/components/vouchers/ResellerManagement";
import { useAuth } from "@/hooks/useAuth";
import { getSelectedDeviceId, getSelectedDevice } from "@/lib/mikrotik";
import { Plus, Upload, Printer, RefreshCw, Ticket } from "lucide-react";
import { toast } from "sonner";
import QRCode from "qrcode";

export function MonitorVouchers() {
  const connectedDeviceId = getSelectedDeviceId();
  const selectedMikrotik = connectedDeviceId || "";
  const [voucherCount, setVoucherCount] = useState(1);
  const [selectedPreset, setSelectedPreset] = useState("");
  const [validity, setValidity] = useState("24h");
  const [price, setPrice] = useState(0);
  const [businessName, setBusinessName] = useState("WiFi Service");
  const [logo, setLogo] = useState("");
  const [selectedVouchers, setSelectedVouchers] = useState<string[]>([]);
  const [qrDialogVoucher, setQrDialogVoucher] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { isAdmin, isSuperAdmin } = useAuth();

  const { data: deviceInfo } = useQuery({
    queryKey: ['device-info', selectedMikrotik],
    queryFn: async () => {
      if (!selectedMikrotik) return null;
      const devices = await devicesApi.list();
      return devices.find((d: any) => d.id === selectedMikrotik);
    },
    enabled: !!selectedMikrotik,
  });

  const hotspotUrl = deviceInfo?.hotspot_url || 'http://192.168.88.1/login';
  const { presets } = useVoucherPresets(selectedMikrotik);
  const { vouchers, isLoading, stats, generateVouchers, isGenerating, deleteVoucher, syncVouchers, isSyncing } = useVoucherInventory(selectedMikrotik);

  const handleSync = () => { if (!selectedMikrotik) { toast.error('No hay dispositivo conectado'); return; } syncVouchers(selectedMikrotik); };
  const handleGenerate = () => {
    if (!selectedMikrotik || !selectedPreset) { toast.error('Selecciona un preset'); return; }
    const preset = presets?.find(p => p.id === selectedPreset);
    if (!preset) { toast.error('Preset no encontrado'); return; }
    generateVouchers({ count: voucherCount, profile: preset.name, mikrotikId: selectedMikrotik, validity: preset.validity, price: preset.price });
  };
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file) { const reader = new FileReader(); reader.onloadend = () => setLogo(reader.result as string); reader.readAsDataURL(file); } };

  const handleBatchPrint = async () => {
    if (selectedVouchers.length === 0) { toast.error('Selecciona vouchers'); return; }
    const vouchersToP = vouchers?.filter(v => selectedVouchers.includes(v.id)) || [];
    const printWindow = window.open('', '_blank'); if (!printWindow) return;
    let qrCardsHtml = '';
    for (const voucher of vouchersToP) {
      const qrCanvas = document.createElement('canvas');
      const loginUrl = hotspotUrl.includes('?') ? `${hotspotUrl}&username=${voucher.code}&password=${voucher.password}` : `${hotspotUrl}?username=${voucher.code}&password=${voucher.password}`;
      await QRCode.toCanvas(qrCanvas, loginUrl, { width: 250, errorCorrectionLevel: 'H' });
      qrCardsHtml += `<div class="qr-card"><img src="${qrCanvas.toDataURL()}" class="qr-image"/><div class="profile-name">${voucher.profile}</div></div>`;
    }
    printWindow.document.write(`<!DOCTYPE html><html><head><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial;padding:15mm;background:#fff}.container{display:grid;grid-template-columns:repeat(3,1fr);gap:10mm;max-width:210mm}.qr-card{display:flex;flex-direction:column;align-items:center;padding:5mm;border:1px solid #ddd;border-radius:3mm;page-break-inside:avoid}.qr-image{width:55mm;height:55mm;margin-bottom:3mm}.profile-name{font-size:14px;font-weight:bold;text-align:center}@media print{@page{margin:10mm;size:A4}}</style></head><body><div class="container">${qrCardsHtml}</div><script>window.onload=()=>setTimeout(()=>window.print(),500);window.onafterprint=()=>window.close();</script></body></html>`);
    printWindow.document.close(); setSelectedVouchers([]);
  };

  const handlePrintVoucher = async (voucher: any) => {
    const qrCanvas = document.createElement('canvas');
    const qrContent = hotspotUrl.includes('?') ? `${hotspotUrl}&username=${voucher.code}&password=${voucher.password}` : `${hotspotUrl}?username=${voucher.code}&password=${voucher.password}`;
    await QRCode.toCanvas(qrCanvas, qrContent, { width: 200 });
    const printWindow = window.open('', '_blank'); if (!printWindow) return;
    printWindow.document.write(`<!DOCTYPE html><html><head><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;width:80mm;padding:10mm;background:#fff}.ticket{text-align:center}.business-name{font-size:18px;font-weight:bold;margin:5mm 0}.title{font-size:16px;font-weight:bold;margin:3mm 0;border-top:2px dashed #000;border-bottom:2px dashed #000;padding:3mm 0}.qr-code{margin:5mm auto}.qr-code img{width:50mm;height:50mm}.credentials{margin:5mm 0;text-align:left}.credential-item{margin:3mm 0;padding:2mm;background:#f5f5f5;border-radius:2mm}.label{font-weight:bold;font-size:10px}.value{font-size:14px;word-break:break-all}@media print{@page{margin:0;size:80mm auto}}</style></head><body><div class="ticket">${logo ? `<img src="${logo}" style="max-width:60mm;margin:5mm auto">` : ''}<div class="business-name">${businessName}</div><div class="title">VOUCHER WiFi</div><div class="qr-code"><img src="${qrCanvas.toDataURL()}"/></div><div class="credentials"><div class="credential-item"><div class="label">USUARIO:</div><div class="value">${voucher.code}</div></div><div class="credential-item"><div class="label">CONTRASEÑA:</div><div class="value">${voucher.password}</div></div><div class="credential-item"><div class="label">PERFIL:</div><div class="value">${voucher.profile}</div></div></div></div><script>window.onload=()=>setTimeout(()=>window.print(),500);window.onafterprint=()=>window.close();</script></body></html>`);
    printWindow.document.close();
  };

  if (!selectedMikrotik) return <div className="text-center py-12 text-muted-foreground text-sm">No hay dispositivo conectado</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><Ticket className="h-5 w-5 text-primary" /><h2 className="text-lg font-bold">Vouchers</h2></div>
        <div className="flex gap-2">
          {selectedVouchers.length > 0 && <Button size="sm" variant="outline" onClick={handleBatchPrint}><Printer className="h-3.5 w-3.5 mr-1" /> Imprimir ({selectedVouchers.length})</Button>}
          <Button size="sm" variant="outline" onClick={handleSync} disabled={isSyncing}><RefreshCw className={`h-3.5 w-3.5 mr-1 ${isSyncing ? 'animate-spin' : ''}`} /> Sync</Button>
        </div>
      </div>
      <VoucherInventoryCard stats={stats} />
      <VoucherReports vouchers={vouchers || []} />
      <VoucherSalesHistory mikrotikId={selectedMikrotik} />
      <VoucherPresetsManager mikrotikId={selectedMikrotik} onSelectPreset={(presetId, v, p) => { setSelectedPreset(presetId); setValidity(v); setPrice(p); toast.success('Preset aplicado'); }} />
      {(isAdmin || isSuperAdmin) && <ResellerManagement mikrotikId={selectedMikrotik} />}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Generar Vouchers</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1"><Label className="text-xs">Cantidad</Label><Input type="number" min="1" max="100" value={voucherCount} onChange={(e) => setVoucherCount(parseInt(e.target.value) || 1)} className="h-8 text-xs" /></div>
            <div className="space-y-1"><Label className="text-xs">Preset</Label><Select value={selectedPreset} onValueChange={(v) => { setSelectedPreset(v); const p = presets?.find(x => x.id === v); if (p) { setValidity(p.validity); setPrice(p.price); } }}><SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Seleccionar" /></SelectTrigger><SelectContent>{presets?.map(p => (<SelectItem key={p.id} value={p.id} className="text-xs">{p.name} - {p.validity} - ${p.price.toFixed(2)}</SelectItem>))}</SelectContent></Select></div>
            <div className="space-y-1"><Label className="text-xs">Precio</Label><Input type="number" value={price} readOnly className="h-8 text-xs" /></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Nombre Negocio</Label><Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="h-8 text-xs" /></div>
            <div className="space-y-1"><Label className="text-xs">Logo</Label><input ref={fileInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" /><Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="w-full h-8 text-xs"><Upload className="h-3.5 w-3.5 mr-1" /> {logo ? 'Cambiar' : 'Subir'}</Button></div>
          </div>
          <Button size="sm" onClick={handleGenerate} disabled={isGenerating || !selectedPreset} className="w-full"><Plus className="h-3.5 w-3.5 mr-1" /> {isGenerating ? 'Generando...' : `Generar ${voucherCount} Voucher(s)`}</Button>
        </CardContent>
      </Card>
      <Card><CardContent className="pt-4">{isLoading ? <div className="text-center py-6 text-xs text-muted-foreground">Cargando...</div> : <VoucherTable vouchers={vouchers || []} onDelete={deleteVoucher} onPrint={handlePrintVoucher} onViewQR={(v) => setQrDialogVoucher(v)} selectedVouchers={selectedVouchers} onSelectVoucher={(id) => setSelectedVouchers(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])} onSelectAll={(all) => setSelectedVouchers(all ? vouchers?.map(v => v.id) || [] : [])} />}</CardContent></Card>
      <VoucherQRDialog voucher={qrDialogVoucher} hotspotUrl={hotspotUrl} open={!!qrDialogVoucher} onOpenChange={(o) => !o && setQrDialogVoucher(null)} />
    </div>
  );
}
