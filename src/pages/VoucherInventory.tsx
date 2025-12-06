import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { useVoucherInventory } from '@/hooks/useVoucherInventory';
import { useVoucherPresets } from '@/hooks/useVoucherPresets';
import { VoucherInventoryCard } from '@/components/vouchers/VoucherInventoryCard';
import { VoucherTable } from '@/components/vouchers/VoucherTable';
import { PrintVoucherTicket } from '@/components/vouchers/PrintVoucherTicket';
import { VoucherPresetsManager } from '@/components/vouchers/VoucherPresetsManager';
import { VoucherReports } from '@/components/vouchers/VoucherReports';
import { VoucherQRDialog } from '@/components/vouchers/VoucherQRDialog';
import { ResellerManagement } from '@/components/vouchers/ResellerManagement';
import { useAuth } from '@/hooks/useAuth';
import { getSelectedDeviceId, getSelectedDevice } from '@/lib/mikrotik';
import { Plus, Upload, Printer, RefreshCw, Router } from 'lucide-react';
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { isAdmin, isSuperAdmin } = useAuth();

  // Fetch the connected device's hotspot_url from database
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
      profile: preset.name, // Use preset name as profile
      mikrotikId: selectedMikrotik,
      validity: preset.validity,
      price: preset.price,
    });
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setLogo(reader.result as string);
      };
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
      // Construir URL del portal captive con credenciales
      const loginUrl = hotspotUrl.includes('?') 
        ? `${hotspotUrl}&username=${voucher.code}&password=${voucher.password}`
        : `${hotspotUrl}?username=${voucher.code}&password=${voucher.password}`;
      
      await QRCode.toCanvas(qrCanvas, loginUrl, { width: 250, errorCorrectionLevel: 'H' });
      const qrDataUrl = qrCanvas.toDataURL();

      qrCardsHtml += `
        <div class="qr-card">
          <img src="${qrDataUrl}" alt="QR Code" class="qr-image" />
          <div class="profile-name">${voucher.profile}</div>
        </div>
      `;
    }

    const content = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Códigos QR - Impresión por Lote</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
              font-family: Arial, sans-serif; 
              padding: 15mm;
              background: white;
            }
            .container {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 10mm;
              max-width: 210mm;
            }
            .qr-card {
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              padding: 5mm;
              border: 1px solid #ddd;
              border-radius: 3mm;
              background: white;
              page-break-inside: avoid;
            }
            .qr-image {
              width: 55mm;
              height: 55mm;
              margin-bottom: 3mm;
            }
            .profile-name {
              font-size: 14px;
              font-weight: bold;
              text-align: center;
              color: #333;
            }
            @media print {
              @page { 
                margin: 10mm;
                size: A4 portrait;
              }
              body { 
                margin: 0;
                padding: 0;
              }
              .container {
                gap: 8mm;
              }
            }
          </style>
        </head>
        <body>
          <div class="container">
            ${qrCardsHtml}
          </div>
          <script>
            window.onload = () => { setTimeout(() => window.print(), 500); };
            window.onafterprint = () => window.close();
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(content);
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

    const content = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Voucher - ${voucher.code}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: 'Courier New', monospace;
              width: 80mm;
              padding: 10mm;
              background: white;
            }
            .ticket { text-align: center; }
            .logo { max-width: 60mm; margin: 5mm auto; }
            .business-name { font-size: 18px; font-weight: bold; margin: 5mm 0; }
            .title { font-size: 16px; font-weight: bold; margin: 3mm 0; border-top: 2px dashed #000; border-bottom: 2px dashed #000; padding: 3mm 0; }
            .qr-code { margin: 5mm auto; }
            .qr-code img { width: 50mm; height: 50mm; }
            .credentials { margin: 5mm 0; text-align: left; }
            .credential-item { margin: 3mm 0; padding: 2mm; background: #f5f5f5; border-radius: 2mm; }
            .label { font-weight: bold; font-size: 10px; }
            .value { font-size: 14px; word-break: break-all; }
            .instructions { margin-top: 5mm; padding-top: 3mm; border-top: 1px dashed #666; font-size: 10px; text-align: left; }
            .instructions ol { margin-left: 5mm; }
            .instructions li { margin: 2mm 0; }
            @media print {
              @page { margin: 0; size: 80mm auto; }
              body { margin: 0; padding: 10mm; }
            }
          </style>
        </head>
        <body>
          <div class="ticket">
            ${logo ? `<img src="${logo}" alt="Logo" class="logo">` : ''}
            <div class="business-name">${businessName}</div>
            <div class="title">VOUCHER DE ACCESO WiFi</div>
            
            <div class="qr-code">
              <img src="${qrDataUrl}" alt="QR Code" />
            </div>
            
            <div class="credentials">
              <div class="credential-item">
                <div class="label">USUARIO:</div>
                <div class="value">${voucher.code}</div>
              </div>
              <div class="credential-item">
                <div class="label">CONTRASEÑA:</div>
                <div class="value">${voucher.password}</div>
              </div>
              <div class="credential-item">
                <div class="label">PERFIL:</div>
                <div class="value">${voucher.profile}</div>
              </div>
              ${voucher.expires_at ? `
              <div class="credential-item">
                <div class="label">VÁLIDO HASTA:</div>
                <div class="value">${new Date(voucher.expires_at).toLocaleString()}</div>
              </div>
              ` : ''}
            </div>

            <div class="instructions">
              <strong>Instrucciones de conexión:</strong>
              <ol>
                <li>Conecta tu dispositivo a la red WiFi</li>
                <li>Escanea el código QR o abre tu navegador</li>
                <li>Ingresa usuario y contraseña</li>
                <li>¡Disfruta de tu conexión!</li>
              </ol>
            </div>
          </div>
          <script>
            window.onload = () => {
              setTimeout(() => {
                window.print();
              }, 500);
            };
            window.onafterprint = () => {
              window.close();
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(content);
    printWindow.document.close();
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 p-4 md:p-8 md:ml-64">
        <div className="max-w-7xl mx-auto space-y-6">
          <div>
            <h1 className="text-3xl font-bold">Inventario de Vouchers</h1>
            <p className="text-muted-foreground">
              Genera, vende y gestiona vouchers de acceso WiFi
            </p>
          </div>

          {/* Connected Device Info */}
          {!selectedMikrotik ? (
            <Card>
              <CardContent className="py-8 text-center">
                <Router className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground mb-4">
                  No hay dispositivo MikroTik conectado
                </p>
                <Button onClick={() => navigate('/settings')}>
                  Ir a Configuración
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Router className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{connectedDevice?.name}</CardTitle>
                      <CardDescription>{connectedDevice?.host}:{connectedDevice?.port}</CardDescription>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => navigate('/settings')}>
                    Cambiar
                  </Button>
                </div>
              </CardHeader>
            </Card>
          )}

          {selectedMikrotik && (
            <>
              {/* Stats */}
              <VoucherInventoryCard stats={stats} />

              {/* Sales Report */}
              <VoucherReports vouchers={vouchers || []} />

              {/* Presets */}
              <VoucherPresetsManager 
                mikrotikId={selectedMikrotik}
                onSelectPreset={(presetId, validity, price) => {
                  setSelectedPreset(presetId);
                  setValidity(validity);
                  setPrice(price);
                  toast.success('Preset aplicado');
                }} 
              />

              {/* Reseller Management - Only for Admins */}
              {(isAdmin || isSuperAdmin) && (
                <ResellerManagement mikrotikId={selectedMikrotik} />
              )}

              {/* Generation Form */}
              <Card>
                <CardHeader>
                  <CardTitle>Generar Vouchers</CardTitle>
                  <CardDescription>Crea nuevos vouchers con configuración personalizada</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="count">Cantidad</Label>
                      <Input
                        id="count"
                        type="number"
                        min="1"
                        max="100"
                        value={voucherCount}
                        onChange={(e) => setVoucherCount(parseInt(e.target.value) || 1)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="preset">Preset de Voucher</Label>
                      <Select value={selectedPreset} onValueChange={(value) => {
                        setSelectedPreset(value);
                        const preset = presets?.find(p => p.id === value);
                        if (preset) {
                          setValidity(preset.validity);
                          setPrice(preset.price);
                        }
                      }}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecciona preset" />
                        </SelectTrigger>
                        <SelectContent>
                          {presets?.map((preset) => (
                            <SelectItem key={preset.id} value={preset.id}>
                              {preset.name} - {preset.validity} - ${preset.price.toFixed(2)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="price">Precio</Label>
                      <Input
                        id="price"
                        type="number"
                        min="0"
                        step="0.01"
                        value={price}
                        onChange={(e) => setPrice(parseFloat(e.target.value) || 0)}
                        placeholder="0.00"
                        readOnly
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="businessName">Nombre del Negocio</Label>
                      <Input
                        id="businessName"
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

                  <Button 
                    onClick={handleGenerate} 
                    disabled={isGenerating || !selectedPreset}
                    className="w-full"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    {isGenerating ? 'Generando...' : `Generar ${voucherCount} Voucher(s)`}
                  </Button>
                </CardContent>
              </Card>

              {/* Vouchers Table */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Lista de Vouchers</CardTitle>
                      <CardDescription>
                        Gestiona el inventario de vouchers generados
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      {selectedVouchers.length > 0 && (
                        <Button onClick={handleBatchPrint} variant="outline">
                          <Printer className="h-4 w-4 mr-2" />
                          Imprimir Seleccionados ({selectedVouchers.length})
                        </Button>
                      )}
                      <Button onClick={handleSync} disabled={isSyncing} variant="outline">
                        <RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
                        Sincronizar
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <div className="text-center py-8">Cargando vouchers...</div>
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
              
              <VoucherQRDialog
                voucher={qrDialogVoucher}
                hotspotUrl={hotspotUrl}
                open={!!qrDialogVoucher}
                onOpenChange={(open) => !open && setQrDialogVoucher(null)}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
