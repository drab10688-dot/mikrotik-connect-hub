import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { paymentPlatformsApi } from "@/lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { CreditCard, Settings, Eye, EyeOff, Loader2, Trash2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

interface PaymentPlatformsConfigProps {
  mikrotikId: string | null;
}

interface PlatformConfig {
  id?: string;
  platform: 'wompi' | 'mercadopago' | 'nequi';
  is_active: boolean;
  public_key: string;
  private_key: string;
  webhook_secret: string;
  environment: 'sandbox' | 'production';
}

export function PaymentPlatformsConfig({ mikrotikId }: PaymentPlatformsConfigProps) {
  const queryClient = useQueryClient();
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [wompiConfig, setWompiConfig] = useState<PlatformConfig>({
    platform: 'wompi',
    is_active: false,
    public_key: '',
    private_key: '',
    webhook_secret: '',
    environment: 'sandbox'
  });
  const [mercadopagoConfig, setMercadopagoConfig] = useState<PlatformConfig>({
    platform: 'mercadopago',
    is_active: false,
    public_key: '',
    private_key: '',
    webhook_secret: '',
    environment: 'sandbox'
  });
  const [nequiConfig, setNequiConfig] = useState<PlatformConfig>({
    platform: 'nequi',
    is_active: false,
    public_key: '',
    private_key: '',
    webhook_secret: '',
    environment: 'sandbox'
  });

  const { data: platforms, isLoading } = useQuery({
    queryKey: ['payment-platforms', mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      const data = await paymentPlatformsApi.list(mikrotikId);
      return data;
    },
    enabled: !!mikrotikId
  });

  // Update local state when data loads
  useEffect(() => {
    if (platforms) {
      const wompi = platforms.find((p: any) => p.platform === 'wompi');
      const mp = platforms.find((p: any) => p.platform === 'mercadopago');
      const nequi = platforms.find((p: any) => p.platform === 'nequi');
      if (wompi) {
        setWompiConfig({
          id: wompi.id,
          platform: 'wompi',
          is_active: wompi.is_active,
          public_key: wompi.public_key || '',
          private_key: wompi.private_key || '',
          webhook_secret: wompi.webhook_secret || '',
          environment: wompi.environment as 'sandbox' | 'production'
        });
      }
      if (mp) {
        setMercadopagoConfig({
          id: mp.id,
          platform: 'mercadopago',
          is_active: mp.is_active,
          public_key: mp.public_key || '',
          private_key: mp.private_key || '',
          webhook_secret: mp.webhook_secret || '',
          environment: mp.environment as 'sandbox' | 'production'
        });
      }
      if (nequi) {
        setNequiConfig({
          id: nequi.id,
          platform: 'nequi',
          is_active: nequi.is_active,
          public_key: nequi.public_key || '',
          private_key: nequi.private_key || '',
          webhook_secret: nequi.webhook_secret || '',
          environment: nequi.environment as 'sandbox' | 'production'
        });
      }
    }
  }, [platforms]);

  const saveMutation = useMutation({
    mutationFn: async (config: PlatformConfig) => {
      if (!mikrotikId) throw new Error('No MikroTik seleccionado');
      
      // auth logic is handled in api-client automatically
      const payload = {
        mikrotik_id: mikrotikId,
        platform: config.platform,
        is_active: config.is_active,
        public_key: config.public_key || null,
        private_key: config.private_key || null,
        webhook_secret: config.webhook_secret || null,
        environment: config.environment,
        id: config.id
      };

      await paymentPlatformsApi.update(payload);
    },
    onSuccess: (_, config) => {
      const platformNames: Record<string, string> = {
        wompi: 'Wompi',
        mercadopago: 'Mercado Pago',
        nequi: 'Nequi'
      };
      toast.success(`Configuración de ${platformNames[config.platform]} guardada`);
      queryClient.invalidateQueries({ queryKey: ['payment-platforms'] });
    },
    onError: (error: any) => {
      toast.error(`Error al guardar: ${error.message}`);
    }
  });

  // Delete platform mutation
  const deleteMutation = useMutation({
    mutationFn: async (platformId: string) => {
      await paymentPlatformsApi.delete(platformId);
    },
    onSuccess: () => {
      toast.success("Configuración eliminada");
      queryClient.invalidateQueries({ queryKey: ['payment-platforms'] });
    },
    onError: (error: any) => {
      toast.error(`Error al eliminar: ${error.message}`);
    }
  });

  const toggleSecret = (key: string) => {
    setShowSecrets(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleDelete = (config: PlatformConfig) => {
    if (!config.id) {
      toast.error("Esta plataforma no está guardada");
      return;
    }
    if (confirm(`¿Eliminar configuración de ${config.platform}?`)) {
      deleteMutation.mutate(config.id);
      // Reset local state
      if (config.platform === 'wompi') {
        setWompiConfig({ platform: 'wompi', is_active: false, public_key: '', private_key: '', webhook_secret: '', environment: 'sandbox' });
      } else if (config.platform === 'mercadopago') {
        setMercadopagoConfig({ platform: 'mercadopago', is_active: false, public_key: '', private_key: '', webhook_secret: '', environment: 'sandbox' });
      } else if (config.platform === 'nequi') {
        setNequiConfig({ platform: 'nequi', is_active: false, public_key: '', private_key: '', webhook_secret: '', environment: 'sandbox' });
      }
    }
  };

  const renderPlatformForm = (
    config: PlatformConfig,
    setConfig: React.Dispatch<React.SetStateAction<PlatformConfig>>,
    platformName: string,
    platformColor: string
  ) => (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${platformColor}`}>
              <CreditCard className="h-5 w-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-lg">{platformName}</CardTitle>
              <CardDescription>
                {config.platform === 'wompi' 
                  ? 'PSE, Tarjetas, Nequi, Bancolombia' 
                  : config.platform === 'nequi'
                  ? 'Pagos directos con Nequi Push'
                  : 'Tarjetas, PSE, Efecty, Baloto'}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={config.is_active ? "default" : "secondary"}>
              {config.is_active ? 'Activo' : 'Inactivo'}
            </Badge>
            <Switch
              checked={config.is_active}
              onCheckedChange={(checked) => setConfig(prev => ({ ...prev, is_active: checked }))}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Ambiente</Label>
            <Select
              value={config.environment}
              onValueChange={(value: 'sandbox' | 'production') => 
                setConfig(prev => ({ ...prev, environment: value }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sandbox">Sandbox (Pruebas)</SelectItem>
                <SelectItem value="production">Producción</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>{config.platform === 'nequi' ? 'Client ID / API Key' : 'Llave Pública'}</Label>
          <div className="flex gap-2">
            <Input
              type={showSecrets[`${config.platform}-public`] ? 'text' : 'password'}
              value={config.public_key}
              onChange={(e) => setConfig(prev => ({ ...prev, public_key: e.target.value }))}
              placeholder={config.platform === 'wompi' ? 'pub_test_...' : config.platform === 'nequi' ? 'Client ID de Nequi' : 'APP_USR-...'}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => toggleSecret(`${config.platform}-public`)}
            >
              {showSecrets[`${config.platform}-public`] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label>{config.platform === 'nequi' ? 'Client Secret / API Secret' : 'Llave Privada / Secret Key'}</Label>
          <div className="flex gap-2">
            <Input
              type={showSecrets[`${config.platform}-private`] ? 'text' : 'password'}
              value={config.private_key}
              onChange={(e) => setConfig(prev => ({ ...prev, private_key: e.target.value }))}
              placeholder={config.platform === 'wompi' ? 'prv_test_...' : config.platform === 'nequi' ? 'Client Secret de Nequi' : 'ACCESS_TOKEN'}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => toggleSecret(`${config.platform}-private`)}
            >
              {showSecrets[`${config.platform}-private`] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Webhook Secret (Opcional)</Label>
          <div className="flex gap-2">
            <Input
              type={showSecrets[`${config.platform}-webhook`] ? 'text' : 'password'}
              value={config.webhook_secret}
              onChange={(e) => setConfig(prev => ({ ...prev, webhook_secret: e.target.value }))}
              placeholder="Para verificar webhooks"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => toggleSecret(`${config.platform}-webhook`)}
            >
              {showSecrets[`${config.platform}-webhook`] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <div className="pt-4 border-t flex gap-2">
          <Button 
            onClick={() => saveMutation.mutate(config)}
            disabled={saveMutation.isPending}
            className="flex-1"
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Guardando...
              </>
            ) : (
              <>
                <Settings className="h-4 w-4 mr-2" />
                Guardar Configuración
              </>
            )}
          </Button>
          {config.id && (
            <Button 
              variant="outline"
              className="text-destructive border-destructive hover:bg-destructive/10"
              onClick={() => handleDelete(config)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );

  if (!mikrotikId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Selecciona un dispositivo MikroTik para configurar las plataformas de pago
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          Plataformas de Pago
        </h3>
        <p className="text-sm text-muted-foreground">
          Configura las plataformas de pago para recibir pagos de tus clientes
        </p>
      </div>

      <Tabs defaultValue="wompi" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="wompi">Wompi</TabsTrigger>
          <TabsTrigger value="mercadopago">Mercado Pago</TabsTrigger>
          <TabsTrigger value="nequi">Nequi</TabsTrigger>
        </TabsList>
        <TabsContent value="wompi" className="mt-4">
          {renderPlatformForm(wompiConfig, setWompiConfig, 'Wompi', 'bg-orange-500')}
        </TabsContent>
        <TabsContent value="mercadopago" className="mt-4">
          {renderPlatformForm(mercadopagoConfig, setMercadopagoConfig, 'Mercado Pago', 'bg-blue-500')}
        </TabsContent>
        <TabsContent value="nequi" className="mt-4">
          {renderPlatformForm(nequiConfig, setNequiConfig, 'Nequi', 'bg-pink-500')}
        </TabsContent>
      </Tabs>
    </div>
  );
}