import { useState } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useValidatedDevice } from "@/hooks/useValidatedDevice";
import { ClientsManager } from "@/components/clients/ClientsManager";
import { ClientRegistrationForm, type RegisteredClientData } from "@/components/isp/ClientRegistrationForm";
import { ClientHistoryTable } from "@/components/isp/ClientHistoryTable";
import { MikrotikClientScanner } from "@/components/isp/MikrotikClientScanner";
import { ContractGenerator } from "@/components/isp/contracts";
import type { ClientContractData } from "@/components/isp/contracts/ContractPreview";
import { saveSelectedDevice, MikroTikDeviceConfig, getSelectedDeviceId } from "@/lib/mikrotik";
import { Users, UserPlus, FileText, History, Key, Save, AlertCircle, Download } from "lucide-react";
import { toast } from "sonner";

export default function Clients() {
  const { device, availableDevices, isValidating } = useValidatedDevice();
  const mikrotikId = getSelectedDeviceId();

  // State for registration
  const [useStandardPassword, setUseStandardPassword] = useState(true);
  const [standardPassword, setStandardPassword] = useState(
    localStorage.getItem("isp_standard_password") || ""
  );
  const [activeTab, setActiveTab] = useState("clients");
  const [registeredClientData, setRegisteredClientData] = useState<Partial<ClientContractData> | undefined>();

  const handleDeviceChange = (deviceId: string) => {
    const selected = availableDevices.find((d: any) => d.id === deviceId);
    if (selected) {
      const config: MikroTikDeviceConfig = {
        id: selected.id,
        name: selected.name,
        host: selected.host,
        port: selected.port,
        version: selected.version,
      };
      saveSelectedDevice(config);
      window.location.reload();
    }
  };

  // Handler para cuando se registra un cliente
  const handleClientRegistered = (data: RegisteredClientData) => {
    setRegisteredClientData({
      clientName: data.clientName,
      identification: data.identification,
      address: data.address,
      phone: data.phone,
      email: data.email,
      plan: data.plan,
      speed: data.speed,
      price: data.price,
      serviceOption: data.serviceOption,
      servicePrice: data.servicePrice,
      totalPrice: data.totalPrice,
    });
    
    toast.success(
      <div className="space-y-2">
        <p className="font-semibold">Cliente registrado. ¿Desea generar el contrato?</p>
        <Button 
          size="sm" 
          onClick={() => {
            setActiveTab("contracts");
            toast.dismiss();
          }}
          className="w-full"
        >
          <FileText className="w-4 h-4 mr-2" />
          Ir a Contratos
        </Button>
      </div>,
      { duration: 10000 }
    );
  };

  // Guardar contraseña estándar
  const handleSaveStandardPassword = () => {
    localStorage.setItem("isp_standard_password", standardPassword);
    toast.success("Contraseña estándar guardada");
  };

  if (!mikrotikId) {
    return (
      <div className="min-h-screen bg-background">
        <Sidebar />
        <div className="p-4 md:p-8 md:ml-64">
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <div className="text-center">
                <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">Sin conexión</h3>
                <p className="text-muted-foreground">
                  Conecta un dispositivo MikroTik desde Configuración
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="p-4 md:p-8 md:ml-64 w-full">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6 md:mb-8">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-foreground">Gestión de Clientes</h1>
            <p className="text-muted-foreground">
              Administra clientes, registro, contratos e historial
            </p>
          </div>
        </div>

        <div className="mb-6">
          <Select 
            value={device?.id || ""} 
            onValueChange={handleDeviceChange}
          >
            <SelectTrigger className="w-full md:w-[300px]">
              <SelectValue placeholder="Seleccionar dispositivo MikroTik" />
            </SelectTrigger>
            <SelectContent>
              {availableDevices.map((d: any) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name} ({d.host})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="clients" className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              <span className="hidden sm:inline">Clientes</span>
            </TabsTrigger>
            <TabsTrigger value="import" className="flex items-center gap-2">
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Importar</span>
            </TabsTrigger>
            <TabsTrigger value="register" className="flex items-center gap-2">
              <UserPlus className="w-4 h-4" />
              <span className="hidden sm:inline">Registrar</span>
            </TabsTrigger>
            <TabsTrigger value="contracts" className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              <span className="hidden sm:inline">Contratos</span>
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2">
              <History className="w-4 h-4" />
              <span className="hidden sm:inline">Historial</span>
            </TabsTrigger>
          </TabsList>

          {/* Tab: Clientes */}
          <TabsContent value="clients">
            <ClientsManager mikrotikId={device?.id || null} mikrotikVersion={device?.version} />
          </TabsContent>

          {/* Tab: Importar desde MikroTik */}
          <TabsContent value="import">
            <MikrotikClientScanner />
          </TabsContent>

          {/* Tab: Registrar Cliente */}
          <TabsContent value="register" className="space-y-6">
            {/* Configuración de contraseña estándar */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Key className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Contraseña Estándar PPPoE</CardTitle>
                    <CardDescription>Configura una contraseña predeterminada para nuevos usuarios</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex gap-4 items-end">
                  <div className="flex-1 space-y-2">
                    <Label htmlFor="standardPassword">Contraseña estándar</Label>
                    <Input
                      id="standardPassword"
                      type="text"
                      placeholder="Ingresa la contraseña estándar"
                      value={standardPassword}
                      onChange={(e) => setStandardPassword(e.target.value)}
                    />
                  </div>
                  <Button onClick={handleSaveStandardPassword} disabled={!standardPassword}>
                    <Save className="w-4 h-4 mr-2" />
                    Guardar
                  </Button>
                </div>
              </CardContent>
            </Card>

            <ClientRegistrationForm 
              useStandardPassword={useStandardPassword}
              standardPassword={standardPassword}
              onSuccess={() => {}}
              onClientRegistered={handleClientRegistered}
            />
          </TabsContent>

          {/* Tab: Contratos */}
          <TabsContent value="contracts">
            <ContractGenerator clientData={registeredClientData} />
          </TabsContent>

          {/* Tab: Historial */}
          <TabsContent value="history">
            <ClientHistoryTable />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
