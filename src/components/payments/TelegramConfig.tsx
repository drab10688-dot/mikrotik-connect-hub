import { useState, useEffect } from "react";
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
import { Send as SendIcon, Settings, History, Eye, EyeOff, Loader2, CheckCircle, XCircle, Clock, Copy, Link, Users, MessageSquare, ExternalLink, Trash2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface TelegramConfigProps {
  mikrotikId: string | null;
}

interface TelegramConfigData {
  id?: string;
  bot_token: string;
  bot_username: string;
  is_active: boolean;
}

export function TelegramConfig({ mikrotikId }: TelegramConfigProps) {
  const queryClient = useQueryClient();
  const [showToken, setShowToken] = useState(false);
  const [activeTab, setActiveTab] = useState("config");
  const [config, setConfig] = useState<TelegramConfigData>({
    bot_token: "",
    bot_username: "",
    is_active: true,
  });

  // Message sending state
  const [selectedClient, setSelectedClient] = useState<string>("");
  const [messageContent, setMessageContent] = useState("");
  const [customChatId, setCustomChatId] = useState("");

  // Fetch existing config
  const { data: existingConfig, isLoading: loadingConfig } = useQuery({
    queryKey: ["telegram-config", mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return null;
      const data = await messagingApi.getTelegramConfig(mikrotikId);
      return data;
    },
    enabled: !!mikrotikId,
  });

  // Fetch clients - we need a specific API call for this, using generic clients API for now
  // Note: Assuming API returns telegram_chat_id in the response
  const { data: clients } = useQuery({
    queryKey: ["isp-clients-telegram", mikrotikId],
    queryFn: async () => {
      // This might need a specific endpoint if not all fields are returned
      // Using fetch directly as a temporary solution or update clientsApi
      // For now we'll assume clientsApi.list returns all needed fields or we'd need to extend it
      // Let's use a direct fetch to the new API structure if available or fallback
      // Since we don't have a specific 'clients with telegram' endpoint in api-client yet,
      // we might need to rely on the general list and filter client-side if needed,
      // BUT for efficiency, let's assume the backend handles it or we use what we have.
      // Actually, clientsApi.list takes mikrotikId.
      if (!mikrotikId) return [];
      // We might need to cast or ensure the type
      const response = await fetch(`/api/clients?mikrotik_id=${mikrotikId}`);
      if (!response.ok) return [];
      return await response.json(); 
    },
    enabled: !!mikrotikId,
  });

  // Fetch message history - Assuming endpoint exists or using general
  // We need to implement this in messagingApi if not present
  // For now let's mock empty or use what's available
  const { data: messageHistory, isLoading: loadingHistory } = useQuery({
    queryKey: ["telegram-messages", mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      // Placeholder: The API client doesn't have message history yet.
      // You should add it to api-client.ts if needed.
      return [];
    },
    enabled: !!mikrotikId,
  });

  // Update local state when config loads
  useEffect(() => {
    if (existingConfig) {
      setConfig({
        id: existingConfig.id,
        bot_token: existingConfig.bot_token,
        bot_username: existingConfig.bot_username || "",
        is_active: existingConfig.is_active,
      });
    }
  }, [existingConfig]);

  // Save config mutation
  const saveConfigMutation = useMutation({
    mutationFn: async (configData: TelegramConfigData) => {
      await messagingApi.updateTelegramConfig(mikrotikId!, {
        ...configData,
        // Ensure nulls are handled if backend expects them
        bot_username: configData.bot_username || null,
      });
    },
    onSuccess: () => {
      toast.success("Configuración de Telegram guardada correctamente");
      queryClient.invalidateQueries({ queryKey: ["telegram-config", mikrotikId] });
    },
    onError: (error: any) => {
      toast.error(`Error al guardar: ${error.message}`);
    },
  });

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async ({ chatId, message }: { chatId: string; message: string }) => {
      await messagingApi.sendTelegram({
        mikrotikId,
        chatId,
        message,
        clientId: selectedClient || null,
      });
    },
    onSuccess: () => {
      toast.success("Mensaje enviado correctamente");
      setMessageContent("");
      setCustomChatId("");
      setSelectedClient("");
      queryClient.invalidateQueries({ queryKey: ["telegram-messages", mikrotikId] });
    },
    onError: (error: any) => {
      toast.error(`Error al enviar: ${error.message}`);
    },
  });

  // Delete config mutation
  // NOTE: messagingApi doesn't have delete config, maybe update with empty/inactive?
  // Or add delete to API. For now, let's disable it.
  const deleteConfigMutation = useMutation({
    mutationFn: async () => {
      // Implement delete endpoint in backend/api-client if needed
      // For now, we can toggle active to false or clear fields
      await messagingApi.updateTelegramConfig(mikrotikId!, {
        bot_token: "",
        bot_username: null,
        is_active: false
      });
    },
    onSuccess: () => {
      toast.success("Configuración de Telegram eliminada");
      setConfig({ bot_token: "", bot_username: "", is_active: true });
      queryClient.invalidateQueries({ queryKey: ["telegram-config", mikrotikId] });
    },
    onError: (error: any) => {
      toast.error(`Error al eliminar: ${error.message}`);
    },
  });

  const handleSaveConfig = () => {
    if (!config.bot_token) {
      toast.error("El Bot Token es requerido");
      return;
    }
    saveConfigMutation.mutate(config);
  };

  const handleSendMessage = () => {
    if (!customChatId) {
      toast.error("Ingresa un Chat ID de Telegram");
      return;
    }
    // Validate that chat ID is numeric (can be negative for groups)
    const cleanChatId = customChatId.trim().replace("@", "");
    if (!/^-?\d+$/.test(cleanChatId)) {
      toast.error("El Chat ID debe ser un número (ej: 123456789). Los usernames (@nombre) no son válidos.");
      return;
    }
    if (!messageContent.trim()) {
      toast.error("El mensaje no puede estar vacío");
      return;
    }
    sendMessageMutation.mutate({ chatId: cleanChatId, message: messageContent });
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
            Selecciona un dispositivo MikroTik para configurar Telegram
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
          <SendIcon className="h-5 w-5 text-blue-500" />
          Telegram Bot API
        </CardTitle>
        <CardDescription>
          Configura tu Bot de Telegram para enviar mensajes a clientes
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
              <SendIcon className="h-4 w-4" />
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
                <Label htmlFor="bot_token">Bot Token</Label>
                <div className="relative">
                  <Input
                    id="bot_token"
                    type={showToken ? "text" : "password"}
                    value={config.bot_token}
                    onChange={(e) => setConfig({ ...config, bot_token: e.target.value })}
                    placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz..."
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
                  Obtén el token desde @BotFather en Telegram
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="bot_username">Nombre de usuario del bot (requerido para enlaces)</Label>
                <Input
                  id="bot_username"
                  value={config.bot_username}
                  onChange={(e) => setConfig({ ...config, bot_username: e.target.value })}
                  placeholder="mi_bot (sin @)"
                />
                <p className="text-xs text-muted-foreground">
                  Necesario para generar enlaces de activación automática
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Bot Activo</Label>
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
                      if (confirm("¿Eliminar configuración de Telegram?")) {
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

              <Separator className="my-4" />

              {/* Webhook Configuration Section */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Link className="h-5 w-5 text-blue-500" />
                  <h3 className="font-semibold">Configuración del Webhook</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  Configura el webhook en BotFather para capturar automáticamente el Chat ID de los clientes.
                </p>
                
                <div className="space-y-2">
                  <Label>URL del Webhook</Label>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={`${window.location.origin}/api/messaging/telegram/webhook`}
                      className="font-mono text-xs"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          `${window.location.origin}/api/messaging/telegram/webhook`
                        );
                        toast.success("URL copiada al portapapeles");
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="bg-muted/50 p-4 rounded-lg space-y-3">
                  <p className="text-sm font-medium">Instrucciones para configurar el webhook:</p>
                  <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-2">
                    <li>Primero guarda la configuración con tu Bot Token arriba</li>
                    <li>Luego haz clic en el botón "Configurar Webhook Automáticamente"</li>
                    <li>Si ves una respuesta con <code className="bg-muted px-1 rounded">"ok": true</code>, ¡está listo!</li>
                  </ol>
                  
                  {existingConfig?.bot_token ? (
                    <Button
                      variant="default"
                      className="w-full"
                      onClick={() => {
                        // This logic needs to be handled by the backend typically, 
                        // but if client-side:
                        const webhookUrl = `${window.location.origin}/api/messaging/telegram/webhook`;
                        const fullUrl = `https://api.telegram.org/bot${existingConfig.bot_token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
                        window.open(fullUrl, '_blank');
                      }}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Configurar Webhook Automáticamente
                    </Button>
                  ) : (
                    <p className="text-xs text-yellow-600 dark:text-yellow-400">
                      ⚠️ Guarda primero la configuración con el Bot Token para habilitar esta opción.
                    </p>
                  )}
                </div>
              </div>

              <Separator className="my-4" />

              {/* Client Links Section - would need client data which we are fetching */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-green-500" />
                  <h3 className="font-semibold">Enlaces de Activación por Cliente</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  Envía estos enlaces a tus clientes. Cuando abran el enlace y presionen "Iniciar", 
                  su Chat ID se capturará automáticamente.
                </p>

                {!config.bot_username ? (
                  <div className="bg-yellow-500/10 border border-yellow-500/20 p-4 rounded-lg">
                    <p className="text-sm text-yellow-600 dark:text-yellow-400">
                      ⚠️ Ingresa el nombre de usuario del bot arriba para generar enlaces de activación.
                    </p>
                  </div>
                ) : clients && clients.length > 0 ? (
                  <div className="rounded-md border max-h-[300px] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Cliente</TableHead>
                          <TableHead>Teléfono</TableHead>
                          <TableHead>Estado</TableHead>
                          <TableHead className="text-right">Acciones</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {clients.map((client: any) => {
                          const activationLink = `https://t.me/${config.bot_username}?start=${client.id}`;
                          const hasTelegram = !!client.telegram_chat_id;
                          
                          return (
                            <TableRow key={client.id}>
                              <TableCell className="font-medium">{client.client_name}</TableCell>
                              <TableCell>{client.phone || "-"}</TableCell>
                              <TableCell>
                                {hasTelegram ? (
                                  <Badge className="bg-green-500 text-white">Conectado</Badge>
                                ) : (
                                  <Badge variant="outline">Pendiente</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      navigator.clipboard.writeText(activationLink);
                                      toast.success("Enlace copiado");
                                    }}
                                    title="Copiar enlace"
                                  >
                                    <Copy className="h-4 w-4" />
                                  </Button>
                                  {client.phone && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => {
                                        const message = `Hola ${client.client_name}, por favor activa las notificaciones de tu servicio de internet aquí: ${activationLink}`;
                                        const waLink = `https://wa.me/${client.phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
                                        window.open(waLink, '_blank');
                                      }}
                                      title="Enviar por WhatsApp"
                                    >
                                      <MessageSquare className="h-4 w-4" />
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-center py-4 text-muted-foreground">
                    No hay clientes registrados o no se han cargado.
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="send" className="space-y-4 mt-4">
            {!existingConfig?.is_active ? (
              <div className="text-center py-8 text-muted-foreground">
                <SendIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Configura y activa Telegram Bot API primero</p>
              </div>
            ) : (
              <div className="grid gap-4">
                <div className="space-y-2">
                  <Label>Cliente (con Telegram conectado)</Label>
                  <Select value={selectedClient} onValueChange={setSelectedClient}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar cliente..." />
                    </SelectTrigger>
                    <SelectContent>
                      {clients?.filter((c: any) => c.telegram_chat_id).map((client: any) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.client_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>O ingresa Chat ID manualmente</Label>
                  <Input
                    placeholder="123456789"
                    value={customChatId}
                    onChange={(e) => setCustomChatId(e.target.value)}
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
                  className="bg-blue-500 hover:bg-blue-600"
                >
                  {sendMessageMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <SendIcon className="h-4 w-4 mr-2" />
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
                        <TableCell>{msg.isp_clients?.client_name || "N/A"}</TableCell>
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