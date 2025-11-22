import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { useVoucherInventory } from '@/hooks/useVoucherInventory';
import { VoucherInventoryCard } from '@/components/vouchers/VoucherInventoryCard';
import { VoucherTable } from '@/components/vouchers/VoucherTable';
import { PrintVoucherTicket } from '@/components/vouchers/PrintVoucherTicket';
import { useUserDeviceAccess } from '@/hooks/useUserDeviceAccess';
import { VoucherPresetsManager } from '@/components/vouchers/VoucherPresetsManager';
import { VoucherReports } from '@/components/vouchers/VoucherReports';
import { VoucherQRDialog } from '@/components/vouchers/VoucherQRDialog';
import { ResellerManagement } from '@/components/vouchers/ResellerManagement';
import { useAuth } from '@/hooks/useAuth';
import { Plus, Upload, RefreshCw, Printer } from 'lucide-react';
import { toast } from 'sonner';
import QRCode from 'qrcode';

export default function VoucherInventory() {
  const [selectedMikrotik, setSelectedMikrotik] = useState<string>("");
  const [voucherCount, setVoucherCount] = useState(1);
  const [selectedProfile, setSelectedProfile] = useState("");
  const [validity, setValidity] = useState("24h");
  const [price, setPrice] = useState(0);
  const [businessName, setBusinessName] = useState("WiFi Service");
  const [logo, setLogo] = useState("");
  const [selectedVouchers, setSelectedVouchers] = useState<string[]>([]);
  const [qrDialogVoucher, setQrDialogVoucher] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { isAdmin, isSuperAdmin } = useAuth();

  const { devices: mikrotikDevices } = useUserDeviceAccess();

  // Obtener perfiles directamente del dispositivo seleccionado
  const { data: profiles = [] } = useQuery({
    queryKey: ['hotspot-profiles', selectedMikrotik],
    queryFn: async () => {
      if (!selectedMikrotik) return [];
      
      const { data: device } = await supabase
        .from('mikrotik_devices')
        .select('*')
        .eq('id', selectedMikrotik)
        .single();
      
      if (!device) return [];
      
      const functionName = device.version === 'v7' ? 'mikrotik-hotspot-users' : 'mikrotik-v6-api';
      const { data, error } = await supabase.functions.invoke(functionName, {
        body: {
          host: device.host,
          username: device.username,
          password: device.password,
          port: device.port,
          command: device.version === 'v7' ? undefined : 'hotspot-profiles',
          action: device.version === 'v7' ? 'list-profiles' : undefined,
        },
      });
      
      if (error) {
        console.error('Error obteniendo perfiles:', error);
        return [];
      }
      
      return data?.data || [];
    },
    enabled: !!selectedMikrotik,
  });

  const {
    vouchers,
    isLoading,
    stats,
    generateVouchers,
    isGenerating,
    sellVoucher,
    isSelling,
    deleteVoucher,
    syncVouchers,
    isSyncing,
  } = useVoucherInventory(selectedMikrotik);

  const handleGenerate = () => {
    if (!selectedMikrotik || !selectedProfile) {
      toast.error('Selecciona un dispositivo y perfil');
      return;
    }

    generateVouchers({
      count: voucherCount,
      profile: selectedProfile,
      mikrotikId: selectedMikrotik,
      validity,
      price,
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

  const handleSync = () => {
    if (!selectedMikrotik) {
      toast.error('Selecciona un dispositivo');
      return;
    }
    syncVouchers(selectedMikrotik);
  };

  const handleBatchPrint = async () => {
    if (selectedVouchers.length === 0) {
      toast.error('Selecciona al menos un voucher para imprimir');
      return;
    }

    const selectedDevice = mikrotikDevices?.find(d => d.id === selectedMikrotik);
    const hotspotUrl = selectedDevice?.hotspot_url || 'http://192.168.88.1/login';
    const vouchersToP = vouchers?.filter(v => selectedVouchers.includes(v.id)) || [];

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    let ticketsHtml = '';
    for (const voucher of vouchersToP) {
      const qrCanvas = document.createElement('canvas');
      const qrContent = hotspotUrl.includes('?') 
        ? `${hotspotUrl}&username=${voucher.code}&password=${voucher.password}`
        : `${hotspotUrl}?username=${voucher.code}&password=${voucher.password}`;
      
      await QRCode.toCanvas(qrCanvas, qrContent, { width: 200 });
      const qrDataUrl = qrCanvas.toDataURL();

      ticketsHtml += `
        <div class="ticket" style="page-break-after: always;">
          ${logo ? `<img src="${logo}" alt="Logo" class="logo">` : ''}
          <div class="business-name">${businessName}</div>
          <div class="title">VOUCHER DE ACCESO WiFi</div>
          <div class="qr-code"><img src="${qrDataUrl}" alt="QR Code" /></div>
          <div class="credentials">
            <div class="credential-item"><div class="label">USUARIO:</div><div class="value">${voucher.code}</div></div>
            <div class="credential-item"><div class="label">CONTRASEÑA:</div><div class="value">${voucher.password}</div></div>
            <div class="credential-item"><div class="label">PERFIL:</div><div class="value">${voucher.profile}</div></div>
            ${voucher.expires_at ? `<div class="credential-item"><div class="label">VÁLIDO HASTA:</div><div class="value">${new Date(voucher.expires_at).toLocaleString()}</div></div>` : ''}
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
      `;
    }

    const content = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Vouchers - Impresión por Lote</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Courier New', monospace; width: 80mm; padding: 10mm; background: white; }
            .ticket { text-align: center; margin-bottom: 20mm; }
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
          ${ticketsHtml}
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
    const selectedDevice = mikrotikDevices?.find(d => d.id === selectedMikrotik);
    const hotspotUrl = selectedDevice?.hotspot_url || 'http://192.168.88.1/login';

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

          {/* Device Selection */}
          <Card>
            <CardHeader>
              <CardTitle>Seleccionar Dispositivo</CardTitle>
              <CardDescription>Elige el MikroTik para gestionar vouchers</CardDescription>
            </CardHeader>
            <CardContent>
              <Select value={selectedMikrotik} onValueChange={setSelectedMikrotik}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona un dispositivo" />
                </SelectTrigger>
                <SelectContent>
                  {mikrotikDevices?.map((device: any) => (
                    <SelectItem key={device.id} value={device.id}>
                      {device.name} ({device.host})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {selectedMikrotik && (
            <>
              {/* Stats */}
              <VoucherInventoryCard stats={stats} />

              {/* Sales Report */}
              <VoucherReports vouchers={vouchers || []} />

              {/* Presets */}
              <VoucherPresetsManager 
                mikrotikId={selectedMikrotik}
                onSelectPreset={(validity, price) => {
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
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
                      <Label htmlFor="profile">Perfil</Label>
                      <Select value={selectedProfile} onValueChange={setSelectedProfile}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecciona perfil" />
                        </SelectTrigger>
                        <SelectContent>
                          {profiles.map((profile: any) => (
                            <SelectItem key={profile['.id']} value={profile.name}>
                              {profile.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="validity">Validez</Label>
                      <Select value={validity} onValueChange={setValidity}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1h">1 hora</SelectItem>
                          <SelectItem value="3h">3 horas</SelectItem>
                          <SelectItem value="6h">6 horas</SelectItem>
                          <SelectItem value="12h">12 horas</SelectItem>
                          <SelectItem value="24h">24 horas</SelectItem>
                          <SelectItem value="3d">3 días</SelectItem>
                          <SelectItem value="7d">7 días</SelectItem>
                          <SelectItem value="30d">30 días</SelectItem>
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
                    disabled={isGenerating || !selectedProfile}
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
                      onSell={(voucherId, price) => sellVoucher({ voucherId, price })}
                      onDelete={deleteVoucher}
                      onPrint={handlePrintVoucher}
                      onViewQR={(voucher) => setQrDialogVoucher(voucher)}
                      isSelling={isSelling}
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
                hotspotUrl={mikrotikDevices?.find(d => d.id === selectedMikrotik)?.hotspot_url || 'http://192.168.88.1/login'}
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
