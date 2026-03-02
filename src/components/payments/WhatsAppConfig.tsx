import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { messagingApi } from "@/lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { MessageCircle, Settings, History, Send, Eye, EyeOff, Loader2, CheckCircle, XCircle, Clock, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface WhatsAppConfigProps {
  mikrotikId: string | null;
}

interface WhatsAppConfigData {
  id?: string;
  access_token: string;
  phone_number_id: string;
  business_account_id: string;
  is_active: boolean;
}

export function WhatsAppConfig({ mikrotikId }: WhatsAppConfigProps) {
  const queryClient = useQueryClient();
  const [showToken, setShowToken] = useState(false);
  const [activeTab, setActiveTab] = useState("config");
  const [config, setConfig] = useState<WhatsAppConfigData>({
    access_token: "",
    phone_number_id: "",
    business_account_id: "",
    is_active: true,
  });

  // Message sending state
  const [selectedClient, setSelectedClient] = useState<string>("");
  const [messageContent, setMessageContent] = useState("");
  const [customPhone, setCustomPhone] = useState("");

  // Fetch existing config
  const { data: existingConfig, isLoading: loadingConfig } = useQuery({
    queryKey: ["whatsapp-config", mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return null;
      const data = await messagingApi.getWhatsappConfig(mikrotikId);
      return data;
    },
    enabled: !!mikrotikId,
  });

  // Fetch clients - using generic fetch since specific API not available yet
  const { data: clients } = useQuery({
    queryKey: ["isp-clients", mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      const response = await fetch(`/api/clients?mikrotik_id=${mikrotikId}`);
      if (!response.ok) return [];
      return await response.json();
    },
    enabled: !!mikrotikId,
  });

  // Fetch message history - placeholder
  const { data: messageHistory, isLoading: loadingHistory } = useQuery({
    queryKey: ["whatsapp-messages", mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      return [];
    },
    enabled: !!mikrotikId,
  });

  // Update local state when config loads
  useState(() => {
    if (existingConfig) {
      setConfig({
        id: existingConfig.id,
        access_token: existingConfig.access_token,
        phone_number_id: existingConfig.phone_number_id,
        business_account_id: existingConfig.business_account_id || "",
        is_active: existingConfig.is_active,
      });
    }
  });

  // Save config mutation
  const saveConfigMutation = useMutation({
    mutationFn: async (configData: WhatsAppConfigData) => {
      await messagingApi.updateWhatsappConfig(mikrotikId!, {
        ...configData,
        business_account_id: configData.business_account_id || null,
      });
    },
    onSuccess: () => {
      toast.success("Configuración de WhatsApp guardada correctamente");
      queryClient.invalidateQueries({ queryKey: ["whatsapp-config", mikrotikId] });
    },
    onError: (error: any) => {
      toast.error(`Error al guardar: ${error.message}`);
    },
  });

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async ({ phone, message }: { phone: string; message: string }) => {
      await messagingApi.sendWhatsapp({
        mikrotikId,
        phoneNumber: phone,
        message,
        clientId: selectedClient || null,
      });
    },
    onSuccess: () => {
      toast.success("Mensaje enviado correctamente");
      setMessageContent("");
      setCustomPhone("");
      setSelectedClient("");
      queryClient.invalidateQueries({ queryKey: ["whatsapp-messages", mikrotikId] });
    },
    onError: (error: any) => {
      toast.error(`Error al enviar: ${error.message}`);
    },
  });

  // Delete config mutation
  const deleteConfigMutation = useMutation({
    mutationFn: async () => {
      await messagingApi.updateWhatsappConfig(mikrotikId!, {
        access_token: "",
        phone_number_id: "",
        business_account_id: null,
        is_active: false
      });
    },
    onSuccess: () => {
      toast.success("Configuración de WhatsApp eliminada");
      setConfig({ access_token: "", phone_number_id: "", business_account_id: "", is_active: true });
      queryClient.invalidateQueries({ queryKey: ["whatsapp-config", mikrotikId] });
    },
    onError: (error: any) => {
      toast.error(`Error al eliminar: ${error.message}`);
    },
  });

  const handleSaveConfig = () => {
    if (!config.access_token || !config.phone_number_id) {
      toast.error("El Access Token y Phone Number ID son requeridos");
      return;
    }
    saveConfigMutation.mutate(config);
  };

  const handleSendMessage = () => {
    const phone = customPhone || clients?.find((c: any) => c.id === selectedClient)?.phone;
    if (!phone) {
      toast.error("Selecciona un cliente o ingresa un número de teléfono");
      return;
    }
    if (!messageContent.trim()) {
      toast.error("El mensaje no puede estar vacío");
      return;
    }
    sendMessageMutation.mutate({ phone, message: messageContent });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "sent":
        return <Badge className="bg-green-500"><CheckCircle className="h-3 w-3 mr-1" />Enviado</Badge>;
      case "failed":
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Fallido</Badge>;
      default:
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Pendiente</Badge>;
    }
  };

  if (!mikrotikId) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-center">
            Selecciona un dispositivo MikroTik para configurar WhatsApp
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loadingConfig) {
    return (
      <Card>
        <CardContent className="pt-6 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-green-500" />
          WhatsApp Business API
        </CardTitle>
        <CardDescription>
          Configura tu API de WhatsApp Business para enviar mensajes a clientes
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="config" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Configuración
            </TabsTrigger>
            <TabsTrigger value="send" className="flex items-center gap-2">
              <Send className="h-4 w-4" />
              Enviar Mensaje
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2">
              <History className="h-4 w-4" />
              Historial
            </TabsTrigger>
          </TabsList>

          <TabsContent value="config" className="space-y-4 mt-4">
            <div className="grid gap-4">
              <div className="space-y-2">
                <Label htmlFor="access_token">Access Token</Label>
                <div className="relative">
                  <Input
                    id="access_token"
                    type={showToken ? "text" : "password"}
                    value={config.access_token}
                    onChange={(e) => setConfig({ ...config, access_token: e.target.value })}
                    placeholder="EAAxxxxxxx..."
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowToken(!showToken)}
                  >
                    {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Obtén el token desde Meta Business Suite → WhatsApp → Configuración de API
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone_number_id">Phone Number ID</Label>
                <Input
                  id="phone_number_id"
                  value={config.phone_number_id}
                  onChange={(e) => setConfig({ ...config, phone_number_id: e.target.value })}
                  placeholder="1234567890..."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="business_account_id">Business Account ID (opcional)</Label>
                <Input
                  id="business_account_id"
                  value={config.business_account_id}
                  onChange={(e) => setConfig({ ...config, business_account_id: e.target.value })}
                  placeholder="1234567890..."
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>API Activa</Label>
                  <p className="text-xs text-muted-foreground">
                    Habilita o deshabilita el envío de mensajes
                  </p>
                </div>
                <Switch
                  checked={config.is_active}
                  onCheckedChange={(checked) => setConfig({ ...config, is_active: checked })}
                />
              </div>

              <div className="flex gap-2">
                <Button onClick={handleSaveConfig} disabled={saveConfigMutation.isPending} className="flex-1">
                  {saveConfigMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Guardar Configuración
                </Button>
                {existingConfig?.id && (
                  <Button
                    variant="outline"
                    className="text-destructive border-destructive hover:bg-destructive/10"
                    onClick={() => {
                      if (confirm("¿Eliminar configuración de WhatsApp?")) {
                        deleteConfigMutation.mutate();
                      }
                    }}
                    disabled={deleteConfigMutation.isPending}
                  >
                    {deleteConfigMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="send" className="space-y-4 mt-4">
            {!existingConfig?.is_active ? (
              <div className="text-center py-8 text-muted-foreground">
                <MessageCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Configura y activa WhatsApp API primero</p>
              </div>
            ) : (
              <div className="grid gap-4">
                <div className="space-y-2">
                  <Label>Cliente</Label>
                  <Select value={selectedClient} onValueChange={setSelectedClient}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar cliente..." />
                    </SelectTrigger>
                    <SelectContent>
                      {clients?.map((client: any) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.client_name} - {client.phone}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>O ingresa número manualmente</Label>
                  <Input
                    placeholder="+57 300 123 4567"
                    value={customPhone}
                    onChange={(e) => setCustomPhone(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Mensaje</Label>
                  <Textarea
                    placeholder="Escribe tu mensaje aquí..."
                    value={messageContent}
                    onChange={(e) => setMessageContent(e.target.value)}
                    rows={4}
                  />
                </div>

                <Button
                  onClick={handleSendMessage}
                  disabled={sendMessageMutation.isPending}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {sendMessageMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  Enviar Mensaje
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            {loadingHistory ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : messageHistory?.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No hay mensajes enviados aún</p>
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Teléfono</TableHead>
                      <TableHead>Mensaje</TableHead>
                      <TableHead>Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {messageHistory?.map((msg: any) => (
                      <TableRow key={msg.id}>
                        <TableCell className="text-sm">
                          {format(new Date(msg.created_at), "dd/MM/yy HH:mm", { locale: es })}
                        </TableCell>
                        <TableCell>{msg.isp_clients?.client_name || "-"}</TableCell>
                        <TableCell className="font-mono text-sm">{msg.phone_number}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{msg.message_content}</TableCell>
                        <TableCell>{getStatusBadge(msg.status)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}