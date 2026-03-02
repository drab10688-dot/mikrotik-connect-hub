import { useState } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, Key, Save, UserPlus, History, FileText, Scan } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { mikrotikCommandApi } from "@/lib/api-client";
import { getSelectedDeviceId } from "@/lib/mikrotik";
import { ClientRegistrationForm, type RegisteredClientData } from "@/components/isp/ClientRegistrationForm";
import { ClientHistoryTable } from "@/components/isp/ClientHistoryTable";
import { ContractGenerator } from "@/components/isp/contracts";
import { MikrotikClientScanner } from "@/components/isp/MikrotikClientScanner";
import type { ClientContractData } from "@/components/isp/contracts/ContractPreview";
import { CardContent as CC, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function IspRegistry() {
  const mikrotikId = getSelectedDeviceId();
  const [useStandardPassword, setUseStandardPassword] = useState(true);
  const [standardPassword, setStandardPassword] = useState(localStorage.getItem("isp_standard_password") || "");
  const [activeTab, setActiveTab] = useState("register");
  const [registeredClientData, setRegisteredClientData] = useState<Partial<ClientContractData> | undefined>();

  const handleClientRegistered = (data: RegisteredClientData) => {
    setRegisteredClientData({ clientName: data.clientName, identification: data.identification, address: data.address, phone: data.phone, email: data.email, plan: data.plan, speed: data.speed, price: data.price, serviceOption: data.serviceOption, servicePrice: data.servicePrice, totalPrice: data.totalPrice });
    toast.success(
      <div className="space-y-2"><p className="font-semibold">¿Desea generar el contrato ahora?</p><Button size="sm" onClick={() => { setActiveTab("contracts"); toast.dismiss(); }} className="w-full"><FileText className="w-4 h-4 mr-2" />Ir a Contratos</Button></div>,
      { duration: 10000 }
    );
  };

  const { refetch: refetchUsers } = useQuery({
    queryKey: ["isp-pppoe-users", mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) throw new Error("No hay dispositivo MikroTik seleccionado");
      const data = await mikrotikCommandApi.exec(mikrotikId, "ppp-secrets");
      if (!data.success) throw new Error(data.error);
      return data.data || [];
    },
    enabled: !!mikrotikId,
  });

  const handleSaveStandardPassword = () => { localStorage.setItem("isp_standard_password", standardPassword); toast.success("Contraseña estándar guardada"); };

  if (!mikrotikId) {
    return (<div className="min-h-screen bg-background"><Sidebar /><div className="p-4 md:p-8 md:ml-64"><Card><CardContent className="flex items-center justify-center py-12"><div className="text-center"><AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" /><h3 className="text-lg font-medium">Sin conexión</h3><p className="text-muted-foreground">Conecta un dispositivo MikroTik desde Configuración</p></div></CardContent></Card></div></div>);
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="p-4 md:p-8 md:ml-64">
        <div className="mb-6 md:mb-8"><h1 className="text-2xl md:text-3xl font-bold text-foreground">Registrar Cliente</h1><p className="text-muted-foreground">Gestiona clientes, contratos e historial</p></div>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="register" className="flex items-center gap-2"><UserPlus className="w-4 h-4" /><span className="hidden sm:inline">Registrar</span></TabsTrigger>
            <TabsTrigger value="scan" className="flex items-center gap-2"><Scan className="w-4 h-4" /><span className="hidden sm:inline">Escanear</span></TabsTrigger>
            <TabsTrigger value="contracts" className="flex items-center gap-2"><FileText className="w-4 h-4" /><span className="hidden sm:inline">Contratos</span></TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2"><History className="w-4 h-4" /><span className="hidden sm:inline">Historial</span></TabsTrigger>
          </TabsList>
          <TabsContent value="register" className="space-y-6">
            <Card><CardHeader className="pb-3"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-primary/10"><Key className="h-5 w-5 text-primary" /></div><div><CardTitle className="text-lg">Contraseña Estándar PPPoE</CardTitle><CardDescription>Configura una contraseña predeterminada para nuevos usuarios</CardDescription></div></div></CardHeader><CC><div className="flex gap-4 items-end"><div className="flex-1 space-y-2"><Label htmlFor="standardPassword">Contraseña estándar</Label><Input id="standardPassword" type="text" placeholder="Ingresa la contraseña estándar" value={standardPassword} onChange={(e) => setStandardPassword(e.target.value)} /></div><Button onClick={handleSaveStandardPassword} disabled={!standardPassword}><Save className="w-4 h-4 mr-2" />Guardar</Button></div></CC></Card>
            <ClientRegistrationForm useStandardPassword={useStandardPassword} standardPassword={standardPassword} onSuccess={() => refetchUsers()} onClientRegistered={handleClientRegistered} />
          </TabsContent>
          <TabsContent value="scan"><MikrotikClientScanner /></TabsContent>
          <TabsContent value="contracts"><ContractGenerator clientData={registeredClientData} /></TabsContent>
          <TabsContent value="history"><ClientHistoryTable /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
