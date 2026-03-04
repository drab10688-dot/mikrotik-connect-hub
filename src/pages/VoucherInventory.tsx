import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { useVoucherInventory } from '@/hooks/useVoucherInventory';
import { useVoucherPresets } from '@/hooks/useVoucherPresets';
import { VoucherTable } from '@/components/vouchers/VoucherTable';
import { VoucherReports } from '@/components/vouchers/VoucherReports';
import { VoucherSalesHistory } from '@/components/vouchers/VoucherSalesHistory';
import { VoucherQRDialog } from '@/components/vouchers/VoucherQRDialog';
import { VoucherPresetsManager } from '@/components/vouchers/VoucherPresetsManager';
import { ResellerManagement } from '@/components/vouchers/ResellerManagement';
import { useAuth } from '@/hooks/useAuth';
import { getSelectedDeviceId, getSelectedDevice } from '@/lib/mikrotik';
import { 
  Plus, Upload, Printer, RefreshCw, Router, Ticket, 
  Package, BarChart3, History, Users, Zap, CheckCircle, 
  ShoppingCart, XCircle, AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';
import QRCode from 'qrcode';

export default function VoucherInventory() {
  const navigate = useNavigate();
  const connectedDeviceId = getSelectedDeviceId();
  const connectedDevice = getSelectedDevice();
  const selectedMikrotik = connectedDeviceId || "";
  
  const [voucherCount, setVoucherCount] = useState(1);
  const [selectedPreset, setSelectedPreset] = useState("");
  const [validity, setValidity] = useState("24h");
  const [price, setPrice] = useState(0);
  const [businessName, setBusinessName] = useState("WiFi Service");
  const [logo, setLogo] = useState("");
  const [selectedVouchers, setSelectedVouchers] = useState<string[]>([]);
  const [qrDialogVoucher, setQrDialogVoucher] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("inventory");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { isAdmin, isSuperAdmin } = useAuth();

  const { data: deviceInfo } = useQuery({
    queryKey: ['device-info', selectedMikrotik],
    queryFn: async () => {
      if (!selectedMikrotik) return null;
      const { data, error } = await supabase
        .from('mikrotik_devices')
        .select('hotspot_url')
        .eq('id', selectedMikrotik)
        .single();
      if (error) return null;
      return data;
    },
    enabled: !!selectedMikrotik,
  });

  const hotspotUrl = deviceInfo?.hotspot_url || 'http://192.168.88.1/login';
  const { presets } = useVoucherPresets(selectedMikrotik);

  const {
    vouchers,
    isLoading,
    stats,
    generateVouchers,
    isGenerating,
    deleteVoucher,
    syncVouchers,
    isSyncing,
  } = useVoucherInventory(selectedMikrotik);

  const handleSync = () => {
    if (!selectedMikrotik) {
      toast.error('No hay dispositivo conectado');
      return;
    }
    syncVouchers(selectedMikrotik);
  };

  const handleGenerate = () => {
    if (!selectedMikrotik || !selectedPreset) {
      toast.error('Selecciona un preset para generar vouchers');
      return;
    }
    const preset = presets?.find(p => p.id === selectedPreset);
    if (!preset) {
      toast.error('Preset no encontrado');
      return;
    }
    generateVouchers({
      count: voucherCount,
      profile: preset.name,
      mikrotikId: selectedMikrotik,
      validity: preset.validity,
      price: preset.price,
    });
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setLogo(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleBatchPrint = async () => {
    if (selectedVouchers.length === 0) {
      toast.error('Selecciona al menos un voucher para imprimir');
      return;
    }
    const vouchersToP = vouchers?.filter(v => selectedVouchers.includes(v.id)) || [];
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    let qrCardsHtml = '';
    for (const voucher of vouchersToP) {
      const qrCanvas = document.createElement('canvas');
      const loginUrl = hotspotUrl.includes('?') 
        ? `${hotspotUrl}&username=${voucher.code}&password=${voucher.password}`
        : `${hotspotUrl}?username=${voucher.code}&password=${voucher.password}`;
      await QRCode.toCanvas(qrCanvas, loginUrl, { width: 250, errorCorrectionLevel: 'H' });
      const qrDataUrl = qrCanvas.toDataURL();
      qrCardsHtml += `
        <div class="qr-card">
          <img src="${qrDataUrl}" alt="QR Code" class="qr-image" />
          <div class="profile-name">${voucher.profile}</div>
        </div>`;
    }

    printWindow.document.write(`<!DOCTYPE html><html><head><title>QR Codes</title><style>
      *{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;padding:15mm;background:#fff}
      .container{display:grid;grid-template-columns:repeat(3,1fr);gap:10mm;max-width:210mm}
      .qr-card{display:flex;flex-direction:column;align-items:center;padding:5mm;border:1px solid #ddd;border-radius:3mm;page-break-inside:avoid}
      .qr-image{width:55mm;height:55mm;margin-bottom:3mm}.profile-name{font-size:14px;font-weight:bold;color:#333}
      @media print{@page{margin:10mm;size:A4 portrait}body{margin:0;padding:0}}
    </style></head><body><div class="container">${qrCardsHtml}</div>
    <script>window.onload=()=>{setTimeout(()=>window.print(),500)};window.onafterprint=()=>window.close();</script></body></html>`);
    printWindow.document.close();
    setSelectedVouchers([]);
  };

  const handlePrintVoucher = async (voucher: any) => {
    const qrCanvas = document.createElement('canvas');
    const qrContent = hotspotUrl.includes('?') 
      ? `${hotspotUrl}&username=${voucher.code}&password=${voucher.password}`
      : `${hotspotUrl}?username=${voucher.code}&password=${voucher.password}`;
    await QRCode.toCanvas(qrCanvas, qrContent, { width: 200 });
    const qrDataUrl = qrCanvas.toDataURL();

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`<!DOCTYPE html><html><head><title>Voucher - ${voucher.code}</title><style>
      *{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;width:80mm;padding:10mm;background:#fff}
      .ticket{text-align:center}.logo{max-width:60mm;margin:5mm auto}
      .business-name{font-size:18px;font-weight:bold;margin:5mm 0}
      .title{font-size:16px;font-weight:bold;margin:3mm 0;border-top:2px dashed #000;border-bottom:2px dashed #000;padding:3mm 0}
      .qr-code{margin:5mm auto}.qr-code img{width:50mm;height:50mm}
      .credentials{margin:5mm 0;text-align:left}
      .credential-item{margin:3mm 0;padding:2mm;background:#f5f5f5;border-radius:2mm}
      .label{font-weight:bold;font-size:10px}.value{font-size:14px;word-break:break-all}
      .instructions{margin-top:5mm;padding-top:3mm;border-top:1px dashed #666;font-size:10px;text-align:left}
      .instructions ol{margin-left:5mm}.instructions li{margin:2mm 0}
      @media print{@page{margin:0;size:80mm auto}body{margin:0;padding:10mm}}
    </style></head><body><div class="ticket">
      ${logo ? `<img src="${logo}" alt="Logo" class="logo">` : ''}
      <div class="business-name">${businessName}</div>
      <div class="title">VOUCHER WiFi</div>
      <div class="qr-code"><img src="${qrDataUrl}" alt="QR" /></div>
      <div class="credentials">
        <div class="credential-item"><div class="label">USUARIO:</div><div class="value">${voucher.code}</div></div>
        <div class="credential-item"><div class="label">CONTRASEÑA:</div><div class="value">${voucher.password}</div></div>
        <div class="credential-item"><div class="label">PERFIL:</div><div class="value">${voucher.profile}</div></div>
        ${voucher.expires_at ? `<div class="credential-item"><div class="label">VÁLIDO HASTA:</div><div class="value">${new Date(voucher.expires_at).toLocaleString()}</div></div>` : ''}
      </div>
      <div class="instructions"><strong>Instrucciones:</strong><ol>
        <li>Conecta a la red WiFi</li><li>Escanea el QR o abre el navegador</li>
        <li>Ingresa usuario y contraseña</li><li>¡Disfruta tu conexión!</li></ol></div>
    </div><script>window.onload=()=>{setTimeout(()=>window.print(),500)};window.onafterprint=()=>window.close();</script></body></html>`);
    printWindow.document.close();
  };

  // No device connected
  if (!selectedMikrotik) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <div className="flex-1 p-4 md:p-8 md:ml-64">
          <div className="max-w-7xl mx-auto">
            <Card className="border-dashed">
              <CardContent className="py-16 text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
                  <Router className="h-8 w-8 text-muted-foreground" />
                </div>
                <h2 className="text-xl font-semibold mb-2">Sin dispositivo conectado</h2>
                <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                  Conecta un dispositivo MikroTik para gestionar vouchers de acceso WiFi
                </p>
                <Button onClick={() => navigate('/settings')}>Ir a Configuración</Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 p-4 md:p-8 md:ml-64">
        <div className="max-w-7xl mx-auto space-y-6">
          
          {/* Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-primary/10">
                <Ticket className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">Vouchers</h1>
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                    {connectedDevice?.name}
                  </span>
                  <span className="text-border">•</span>
                  <span>{connectedDevice?.host}</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={handleSync} disabled={isSyncing} variant="outline" size="sm">
                <RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
                Sync
              </Button>
              <Button onClick={() => navigate('/settings')} variant="ghost" size="sm">
                <Router className="h-4 w-4 mr-2" />
                Cambiar
              </Button>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="border-l-4 border-l-primary">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total</p>
                    <p className="text-2xl font-bold mt-1">{stats.total}</p>
                  </div>
                  <Package className="h-8 w-8 text-primary/30" />
                </div>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-success">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Disponibles</p>
                    <p className="text-2xl font-bold mt-1 text-success">{stats.available}</p>
                  </div>
                  <CheckCircle className="h-8 w-8 text-success/30" />
                </div>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-[hsl(217,91%,60%)]">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">En Uso</p>
                    <p className="text-2xl font-bold mt-1">{stats.sold + stats.used}</p>
                  </div>
                  <ShoppingCart className="h-8 w-8 text-primary/30" />
                </div>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-destructive">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Expirados</p>
                    <p className="text-2xl font-bold mt-1 text-destructive">{stats.expired}</p>
                  </div>
                  <XCircle className="h-8 w-8 text-destructive/30" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <TabsList className="grid w-full grid-cols-5 lg:w-auto lg:inline-grid">
              <TabsTrigger value="inventory" className="gap-2">
                <Package className="h-4 w-4 hidden sm:block" />
                Inventario
              </TabsTrigger>
              <TabsTrigger value="generate" className="gap-2">
                <Zap className="h-4 w-4 hidden sm:block" />
                Generar
              </TabsTrigger>
              <TabsTrigger value="reports" className="gap-2">
                <BarChart3 className="h-4 w-4 hidden sm:block" />
                Reportes
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-2">
                <History className="h-4 w-4 hidden sm:block" />
                Historial
              </TabsTrigger>
              {(isAdmin || isSuperAdmin) && (
                <TabsTrigger value="config" className="gap-2">
                  <Users className="h-4 w-4 hidden sm:block" />
                  Config
                </TabsTrigger>
              )}
            </TabsList>

            {/* Tab: Inventory */}
            <TabsContent value="inventory" className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">Inventario de Vouchers</CardTitle>
                      <CardDescription>
                        {vouchers?.length || 0} vouchers en el sistema
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      {selectedVouchers.length > 0 && (
                        <Button onClick={handleBatchPrint} variant="outline" size="sm">
                          <Printer className="h-4 w-4 mr-2" />
                          Imprimir ({selectedVouchers.length})
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <VoucherTable
                      vouchers={vouchers || []}
                      onDelete={deleteVoucher}
                      onPrint={handlePrintVoucher}
                      onViewQR={(voucher) => setQrDialogVoucher(voucher)}
                      selectedVouchers={selectedVouchers}
                      onSelectVoucher={(voucherId) => {
                        setSelectedVouchers(prev => 
                          prev.includes(voucherId) 
                            ? prev.filter(id => id !== voucherId)
                            : [...prev, voucherId]
                        );
                      }}
                      onSelectAll={(all) => {
                        setSelectedVouchers(all ? vouchers?.map(v => v.id) || [] : []);
                      }}
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tab: Generate */}
            <TabsContent value="generate" className="space-y-6">
              {/* Presets */}
              <VoucherPresetsManager 
                mikrotikId={selectedMikrotik}
                onSelectPreset={(presetId, val, pr) => {
                  setSelectedPreset(presetId);
                  setValidity(val);
                  setPrice(pr);
                  toast.success('Preset seleccionado');
                }} 
              />

              {/* Generation Form */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Zap className="h-5 w-5 text-primary" />
                    Generar Vouchers
                  </CardTitle>
                  <CardDescription>
                    Selecciona un preset arriba y define la cantidad a generar
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {!selectedPreset && (
                    <div className="flex items-center gap-3 p-4 rounded-lg bg-warning/10 border border-warning/20">
                      <AlertCircle className="h-5 w-5 text-warning shrink-0" />
                      <p className="text-sm text-warning-foreground">
                        Selecciona un preset de la sección anterior para poder generar vouchers
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Preset Seleccionado</Label>
                      <Select value={selectedPreset} onValueChange={(value) => {
                        setSelectedPreset(value);
                        const preset = presets?.find(p => p.id === value);
                        if (preset) {
                          setValidity(preset.validity);
                          setPrice(preset.price);
                        }
                      }}>
                        <SelectTrigger>
                          <SelectValue placeholder="Elige un preset" />
                        </SelectTrigger>
                        <SelectContent>
                          {presets?.map((preset) => (
                            <SelectItem key={preset.id} value={preset.id}>
                              {preset.name} — {preset.validity} — ${Number(preset.price).toFixed(2)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Cantidad</Label>
                      <Input
                        type="number"
                        min="1"
                        max="100"
                        value={voucherCount}
                        onChange={(e) => setVoucherCount(parseInt(e.target.value) || 1)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Precio unitario</Label>
                      <Input
                        type="number"
                        value={price}
                        readOnly
                        className="bg-muted"
                      />
                    </div>
                  </div>

                  {/* Print Config */}
                  <div className="border-t pt-4">
                    <p className="text-sm font-medium mb-3 text-muted-foreground">Configuración de impresión</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Nombre del negocio</Label>
                        <Input
                          value={businessName}
                          onChange={(e) => setBusinessName(e.target.value)}
                          placeholder="WiFi Service"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Logo (opcional)</Label>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleLogoUpload}
                          className="hidden"
                        />
                        <Button
                          variant="outline"
                          onClick={() => fileInputRef.current?.click()}
                          className="w-full"
                        >
                          <Upload className="h-4 w-4 mr-2" />
                          {logo ? 'Cambiar Logo' : 'Subir Logo'}
                        </Button>
                      </div>
                    </div>
                  </div>

                  <Button 
                    onClick={handleGenerate} 
                    disabled={isGenerating || !selectedPreset}
                    className="w-full"
                    size="lg"
                  >
                    <Plus className="h-5 w-5 mr-2" />
                    {isGenerating ? 'Generando...' : `Generar ${voucherCount} Voucher${voucherCount > 1 ? 's' : ''}`}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tab: Reports */}
            <TabsContent value="reports">
              <VoucherReports vouchers={vouchers || []} />
            </TabsContent>

            {/* Tab: History */}
            <TabsContent value="history">
              <VoucherSalesHistory mikrotikId={selectedMikrotik} />
            </TabsContent>

            {/* Tab: Config (Admin only) */}
            {(isAdmin || isSuperAdmin) && (
              <TabsContent value="config" className="space-y-6">
                <ResellerManagement mikrotikId={selectedMikrotik} />
              </TabsContent>
            )}
          </Tabs>

          <VoucherQRDialog
            voucher={qrDialogVoucher}
            hotspotUrl={hotspotUrl}
            open={!!qrDialogVoucher}
            onOpenChange={(open) => !open && setQrDialogVoucher(null)}
          />
        </div>
      </div>
    </div>
  );
}
