import { useState } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useValidatedDevice } from "@/hooks/useValidatedDevice";
import { PaymentPlatformsConfig } from "@/components/payments/PaymentPlatformsConfig";
import { ClientBillingManager } from "@/components/payments/ClientBillingManager";
import { PaymentReportsDashboard } from "@/components/payments/PaymentReportsDashboard";
import { WhatsAppConfig } from "@/components/payments/WhatsAppConfig";
import { TelegramConfig } from "@/components/payments/TelegramConfig";
import { BillingConfigManager } from "@/components/payments/BillingConfigManager";
import { Receipt, BarChart3, ExternalLink, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { saveSelectedDevice, MikroTikDeviceConfig } from "@/lib/mikrotik";

export default function Payments() {
  const { device, availableDevices, isValidating } = useValidatedDevice();
  const [activeTab, setActiveTab] = useState("billing");

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

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="p-4 md:p-8 md:ml-64 w-full">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6 md:mb-8">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-foreground">Facturación</h1>
            <p className="text-muted-foreground">
              Gestiona facturas, reportes y configuración de facturación
            </p>
          </div>
          <Button asChild variant="outline" className="w-fit">
            <Link to="/pay" target="_blank">
              <ExternalLink className="h-4 w-4 mr-2" />
              Portal de Pago Cliente
            </Link>
          </Button>
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

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid w-full grid-cols-3 md:w-[450px]">
            <TabsTrigger value="billing" className="flex items-center gap-2">
              <Receipt className="h-4 w-4" />
              <span className="hidden sm:inline">Facturas</span>
            </TabsTrigger>
            <TabsTrigger value="reports" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              <span className="hidden sm:inline">Reportes</span>
            </TabsTrigger>
            <TabsTrigger value="config" className="flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              <span className="hidden sm:inline">Config</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="billing">
            <ClientBillingManager mikrotikId={device?.id || null} />
          </TabsContent>

          <TabsContent value="reports">
            <PaymentReportsDashboard mikrotikId={device?.id || null} />
          </TabsContent>

          <TabsContent value="config">
            <div className="space-y-6">
              <BillingConfigManager mikrotikId={device?.id || null} />
              
              <Tabs defaultValue="platforms" className="space-y-4">
                <TabsList className="grid w-full grid-cols-3 md:w-[450px]">
                  <TabsTrigger value="platforms">Plataformas de Pago</TabsTrigger>
                  <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
                  <TabsTrigger value="telegram">Telegram</TabsTrigger>
                </TabsList>
                <TabsContent value="platforms">
                  <PaymentPlatformsConfig mikrotikId={device?.id || null} />
                </TabsContent>
                <TabsContent value="whatsapp">
                  <WhatsAppConfig mikrotikId={device?.id || null} />
                </TabsContent>
                <TabsContent value="telegram">
                  <TelegramConfig mikrotikId={device?.id || null} />
                </TabsContent>
              </Tabs>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
