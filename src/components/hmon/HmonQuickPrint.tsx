import { useState, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { devicesApi } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useVoucherInventory } from "@/hooks/useVoucherInventory";
import { getSelectedDeviceId } from "@/lib/mikrotik";
import { Printer, FileText, Upload } from "lucide-react";
import { toast } from "sonner";
import { printTicket80mm, printCardsA4, type PrintVoucher, type PrintConfig } from "./HmonPrint";

export function HmonQuickPrint() {
  const deviceId = getSelectedDeviceId() || "";
  const [businessName, setBusinessName] = useState(() => localStorage.getItem("hmon_business_name") || "WiFi Service");
  const [logo, setLogo] = useState(() => localStorage.getItem("hmon_logo") || "");
  const [selectedVouchers, setSelectedVouchers] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: deviceInfo } = useQuery({
    queryKey: ["device-info", deviceId],
    queryFn: async () => { if (!deviceId) return null; const devices = await devicesApi.list(); return devices.find((d: any) => d.id === deviceId); },
    enabled: !!deviceId,
  });

  const hotspotUrl = deviceInfo?.hotspot_url || "http://192.168.88.1/login";
  const { vouchers } = useVoucherInventory(deviceId);

  const availableVouchers = useMemo(() => (vouchers || []).filter((v: any) => v.status === "available"), [vouchers]);

  const printConfig: PrintConfig = { businessName, logo: logo || undefined, hotspotUrl };

  const handlePrintSingle = (voucher: any) => {
    const pv: PrintVoucher = { code: voucher.code, password: voucher.password, profile: voucher.profile, validity: voucher.validity, price: voucher.price };
    printTicket80mm(pv, printConfig);
  };

  const handleBatchPrint80mm = async () => {
    if (selectedVouchers.length === 0) { toast.error("Selecciona vouchers"); return; }
    const vList = vouchers?.filter(v => selectedVouchers.includes(v.id)) || [];
    for (const v of vList) {
      await printTicket80mm({ code: v.code, password: v.password, profile: v.profile, validity: v.validity, price: v.price }, printConfig);
    }
    setSelectedVouchers([]);
    toast.success("Impresión enviada");
  };

  const handleBatchPrintA4 = () => {
    if (selectedVouchers.length === 0) { toast.error("Selecciona vouchers"); return; }
    const vList = vouchers?.filter(v => selectedVouchers.includes(v.id)) || [];
    const pvs: PrintVoucher[] = vList.map(v => ({ code: v.code, password: v.password, profile: v.profile, validity: v.validity, price: v.price }));
    printCardsA4(pvs, printConfig);
    setSelectedVouchers([]);
    toast.success("Impresión enviada");
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500000) { toast.error("Logo debe ser menor a 500KB"); return; }
    const reader = new FileReader();
    reader.onloadend = () => {
      const b64 = reader.result as string;
      setLogo(b64);
      localStorage.setItem("hmon_logo", b64);
    };
    reader.readAsDataURL(file);
  };

  if (!deviceId) return <div className="text-center py-12 text-muted-foreground text-sm">No hay dispositivo conectado</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2"><Printer className="h-5 w-5 text-primary" /><h2 className="text-lg font-bold">Impresión Rápida</h2></div>
        <div className="flex gap-2">
          {selectedVouchers.length > 0 && (
            <>
              <Button size="sm" variant="outline" onClick={handleBatchPrint80mm}><Printer className="h-3.5 w-3.5 mr-1" />80mm ({selectedVouchers.length})</Button>
              <Button size="sm" variant="outline" onClick={handleBatchPrintA4}><FileText className="h-3.5 w-3.5 mr-1" />A4 ({selectedVouchers.length})</Button>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Config. Impresión</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Nombre Negocio</Label><Input value={businessName} onChange={(e) => { setBusinessName(e.target.value); localStorage.setItem("hmon_business_name", e.target.value); }} className="h-8 text-xs" /></div>
            <div className="space-y-1"><Label className="text-xs">Logo</Label>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="w-full h-8 text-xs"><Upload className="h-3.5 w-3.5 mr-1" />{logo ? "Cambiar" : "Subir"}</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Vouchers Disponibles ({availableVouchers.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-8"><Checkbox checked={selectedVouchers.length === availableVouchers.length && availableVouchers.length > 0} onCheckedChange={(c) => setSelectedVouchers(c ? availableVouchers.map((v: any) => v.id) : [])} /></TableHead>
                <TableHead className="text-[10px]">Código</TableHead>
                <TableHead className="text-[10px]">Contraseña</TableHead>
                <TableHead className="text-[10px]">Plan</TableHead>
                <TableHead className="text-[10px]">Precio</TableHead>
                <TableHead className="text-[10px] text-right">Imprimir</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {availableVouchers.length > 0 ? availableVouchers.map((v: any) => (
                  <TableRow key={v.id}>
                    <TableCell><Checkbox checked={selectedVouchers.includes(v.id)} onCheckedChange={() => setSelectedVouchers(prev => prev.includes(v.id) ? prev.filter(x => x !== v.id) : [...prev, v.id])} /></TableCell>
                    <TableCell className="text-xs font-mono font-bold">{v.code}</TableCell>
                    <TableCell className="text-xs font-mono">{v.password}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[9px]">{v.profile}</Badge></TableCell>
                    <TableCell className="text-xs">{v.price ? `$${Number(v.price).toFixed(2)}` : "-"}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => handlePrintSingle(v)}><Printer className="h-3.5 w-3.5" /></Button>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-xs">Sin vouchers disponibles para imprimir</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
