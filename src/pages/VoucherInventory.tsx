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
import { useHotspotProfiles } from '@/hooks/useMikrotikData';
import { VoucherInventoryCard } from '@/components/vouchers/VoucherInventoryCard';
import { VoucherTable } from '@/components/vouchers/VoucherTable';
import { PrintVoucherTicket } from '@/components/vouchers/PrintVoucherTicket';
import { Plus, Upload } from 'lucide-react';
import { toast } from 'sonner';

export default function VoucherInventory() {
  const [selectedMikrotik, setSelectedMikrotik] = useState<string>("");
  const [voucherCount, setVoucherCount] = useState(1);
  const [selectedProfile, setSelectedProfile] = useState("");
  const [validity, setValidity] = useState("24h");
  const [price, setPrice] = useState(0);
  const [businessName, setBusinessName] = useState("WiFi Service");
  const [logo, setLogo] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: mikrotikDevices } = useQuery({
    queryKey: ['mikrotik-devices-vouchers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mikrotik_devices')
        .select('*')
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  const { data: profilesData } = useHotspotProfiles();
  const profiles = (profilesData as any[]) || [];

  const {
    vouchers,
    isLoading,
    stats,
    generateVouchers,
    isGenerating,
    sellVoucher,
    isSelling,
    deleteVoucher,
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

  const handlePrintVoucher = (voucher: any) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const content = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Imprimir Voucher</title>
          <style>
            @media print {
              @page { margin: 0; size: 80mm auto; }
              body { margin: 0; padding: 0; }
            }
          </style>
        </head>
        <body>
          <div id="print-content"></div>
          <script>
            window.onload = () => {
              window.print();
              window.onafterprint = () => window.close();
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(content);
    
    const printContent = printWindow.document.getElementById('print-content');
    if (printContent) {
      const ticketComponent = (
        <PrintVoucherTicket
          voucher={voucher}
          businessName={businessName}
          logo={logo}
          showInstructions={true}
        />
      );
      printContent.innerHTML = ticketComponent.toString();
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 p-8 ml-64">
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
                  <CardTitle>Lista de Vouchers</CardTitle>
                  <CardDescription>
                    Gestiona el inventario de vouchers generados
                  </CardDescription>
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
                      isSelling={isSelling}
                    />
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
