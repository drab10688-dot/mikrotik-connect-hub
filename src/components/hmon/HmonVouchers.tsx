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
import { getSelectedDeviceId } from "@/lib/mikrotik";
import { Plus, Upload, Printer, RefreshCw, Ticket, FileText } from "lucide-react";
import { toast } from "sonner";
import { printTicket80mm, printCardsA4, type PrintVoucher, type PrintConfig } from "./HmonPrint";

export function HmonVouchers() {
  const deviceId = getSelectedDeviceId() || "";
  const [voucherCount, setVoucherCount] = useState(1);
  const [selectedPreset, setSelectedPreset] = useState("");
  const [validity, setValidity] = useState("24h");
  const [price, setPrice] = useState(0);
  const [businessName, setBusinessName] = useState(() => localStorage.getItem("hmon_business_name") || "WiFi Service");
  const [logo, setLogo] = useState(() => localStorage.getItem("hmon_logo") || "");
  const [selectedVouchers, setSelectedVouchers] = useState<string[]>([]);
  const [qrDialogVoucher, setQrDialogVoucher] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { isAdmin, isSuperAdmin } = useAuth();

  const { data: deviceInfo } = useQuery({
    queryKey: ["device-info", deviceId],
    queryFn: async () => {
      if (!deviceId) return null;
      const devices = await devicesApi.list();
      return devices.find((d: any) => d.id === deviceId);
    },
    enabled: !!deviceId,
  });

  const hotspotUrl = deviceInfo?.hotspot_url || "http://192.168.88.1/login";
  const { presets } = useVoucherPresets(deviceId);
  const { vouchers, isLoading, stats, generateVouchers, isGenerating, deleteVoucher, syncVouchers, isSyncing } = useVoucherInventory(deviceId);

  const printConfig: PrintConfig = { businessName, logo: logo || undefined, hotspotUrl };

  const handleSync = () => {
    if (!deviceId) { toast.error("No hay dispositivo conectado"); return; }
    syncVouchers(deviceId);
  };

  const handleGenerate = () => {
    if (!deviceId || !selectedPreset) { toast.error("Selecciona un preset"); return; }
    const preset = presets?.find(p => p.id === selectedPreset);
    if (!preset) { toast.error("Preset no encontrado"); return; }
    generateVouchers({ count: voucherCount, profile: preset.name, mikrotikId: deviceId, validity: preset.validity, price: preset.price });
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 500000) { toast.error("Logo debe ser menor a 500KB"); return; }
      const reader = new FileReader();
      reader.onloadend = () => { const b64 = reader.result as string; setLogo(b64); localStorage.setItem("hmon_logo", b64); };
      reader.readAsDataURL(file);
    }
  };

  const handleBusinessNameChange = (name: string) => {
    setBusinessName(name);
    localStorage.setItem("hmon_business_name", name);
  };

  // Print single voucher (80mm ticket)
  const handlePrintTicket = (voucher: any) => {
    const pv: PrintVoucher = { code: voucher.code, password: voucher.password, profile: voucher.profile, validity: voucher.validity, price: voucher.price };
    printTicket80mm(pv, printConfig);
  };

  // Batch print selected (A4 cards)
  const handleBatchPrintA4 = () => {
    if (selectedVouchers.length === 0) { toast.error("Selecciona vouchers para imprimir"); return; }
    const vList = vouchers?.filter(v => selectedVouchers.includes(v.id)) || [];
    const pvs: PrintVoucher[] = vList.map(v => ({ code: v.code, password: v.password, profile: v.profile, validity: v.validity, price: v.price }));
    printCardsA4(pvs, printConfig);
    setSelectedVouchers([]);
  };

  // Batch print selected (80mm tickets)
  const handleBatchPrintTickets = async () => {
    if (selectedVouchers.length === 0) { toast.error("Selecciona vouchers para imprimir"); return; }
    const vList = vouchers?.filter(v => selectedVouchers.includes(v.id)) || [];
    for (const v of vList) {
      await printTicket80mm({ code: v.code, password: v.password, profile: v.profile, validity: v.validity, price: v.price }, printConfig);
    }
    setSelectedVouchers([]);
  };

  if (!deviceId) return <div className="text-center py-12 text-muted-foreground text-sm">No hay dispositivo conectado</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2"><Ticket className="h-5 w-5 text-primary" /><h2 className="text-lg font-bold">Vouchers</h2></div>
        <div className="flex flex-wrap gap-2">
          {selectedVouchers.length > 0 && (
            <>
              <Button size="sm" variant="outline" onClick={handleBatchPrintTickets}>
                <Printer className="h-3.5 w-3.5 mr-1" /> 80mm ({selectedVouchers.length})
              </Button>
              <Button size="sm" variant="outline" onClick={handleBatchPrintA4}>
                <FileText className="h-3.5 w-3.5 mr-1" /> A4 ({selectedVouchers.length})
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" onClick={handleSync} disabled={isSyncing}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isSyncing ? "animate-spin" : ""}`} /> Sync
          </Button>
        </div>
      </div>

      <VoucherInventoryCard stats={stats} />
      <VoucherReports vouchers={vouchers || []} />
      <VoucherSalesHistory mikrotikId={deviceId} />
      <VoucherPresetsManager mikrotikId={deviceId} onSelectPreset={(presetId, v, p) => { setSelectedPreset(presetId); setValidity(v); setPrice(p); toast.success("Preset aplicado"); }} />
      {(isAdmin || isSuperAdmin) && <ResellerManagement mikrotikId={deviceId} />}

      {/* Generate */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Generar Vouchers</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1"><Label className="text-xs">Cantidad</Label><Input type="number" min={1} max={100} value={voucherCount} onChange={(e) => setVoucherCount(parseInt(e.target.value) || 1)} className="h-8 text-xs" /></div>
            <div className="space-y-1">
              <Label className="text-xs">Preset</Label>
              <Select value={selectedPreset} onValueChange={(v) => { setSelectedPreset(v); const p = presets?.find(x => x.id === v); if (p) { setValidity(p.validity); setPrice(p.price); } }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                <SelectContent>{presets?.map(p => <SelectItem key={p.id} value={p.id} className="text-xs">{p.name} - {p.validity} - ${p.price.toFixed(2)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label className="text-xs">Precio</Label><Input type="number" value={price} readOnly className="h-8 text-xs" /></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Nombre Negocio</Label><Input value={businessName} onChange={(e) => handleBusinessNameChange(e.target.value)} className="h-8 text-xs" /></div>
            <div className="space-y-1"><Label className="text-xs">Logo</Label><input ref={fileInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" /><Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="w-full h-8 text-xs"><Upload className="h-3.5 w-3.5 mr-1" /> {logo ? "Cambiar Logo" : "Subir Logo"}</Button></div>
          </div>
          <Button size="sm" onClick={handleGenerate} disabled={isGenerating || !selectedPreset} className="w-full">
            <Plus className="h-3.5 w-3.5 mr-1" /> {isGenerating ? "Generando..." : `Generar ${voucherCount} Voucher(s)`}
          </Button>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="text-center py-6 text-xs text-muted-foreground">Cargando...</div>
          ) : (
            <VoucherTable
              vouchers={vouchers || []}
              onDelete={deleteVoucher}
              onPrint={handlePrintTicket}
              onViewQR={(v) => setQrDialogVoucher(v)}
              selectedVouchers={selectedVouchers}
              onSelectVoucher={(id) => setSelectedVouchers(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
              onSelectAll={(all) => setSelectedVouchers(all ? vouchers?.map(v => v.id) || [] : [])}
            />
          )}
        </CardContent>
      </Card>

      <VoucherQRDialog voucher={qrDialogVoucher} hotspotUrl={hotspotUrl} open={!!qrDialogVoucher} onOpenChange={(o) => !o && setQrDialogVoucher(null)} />
    </div>
  );
}
