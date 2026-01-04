import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
      const { data, error } = await supabase
        .from("telegram_config")
        .select("*")
        .eq("mikrotik_id", mikrotikId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!mikrotikId,
  });

  // Fetch clients with telegram_chat_id
  const { data: clients } = useQuery({
    queryKey: ["isp-clients-telegram", mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      const { data, error } = await supabase
        .from("isp_clients")
        .select("id, client_name, phone, telegram_chat_id")
        .eq("mikrotik_id", mikrotikId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!mikrotikId,
  });

  // Fetch message history
  const { data: messageHistory, isLoading: loadingHistory } = useQuery({
    queryKey: ["telegram-messages", mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      const { data, error } = await supabase
        .from("telegram_messages")
        .select(`
          *,
          isp_clients(client_name)
        `)
        .eq("mikrotik_id", mikrotikId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
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
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("No autenticado");

      if (existingConfig?.id) {
        const { error } = await supabase
          .from("telegram_config")
          .update({
            bot_token: configData.bot_token,
            bot_username: configData.bot_username || null,
            is_active: configData.is_active,
          })
          .eq("id", existingConfig.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("telegram_config").insert({
          mikrotik_id: mikrotikId,
          bot_token: configData.bot_token,
          bot_username: configData.bot_username || null,
          is_active: configData.is_active,
          created_by: userData.user.id,
        });
        if (error) throw error;
      }
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
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("No autenticado");

      const { data, error } = await supabase.functions.invoke("telegram-send", {
        body: {
          mikrotikId,
          chatId,
          message,
          clientId: selectedClient || null,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
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
  const deleteConfigMutation = useMutation({
    mutationFn: async () => {
      if (!existingConfig?.id) throw new Error("No hay configuración para eliminar");
      const { error } = await supabase
        .from('telegram_config')
        .delete()
        .eq('id', existingConfig.id);
      if (error) throw error;
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
                      value={`https://qybuufofocxsctwnpwon.supabase.co/functions/v1/telegram-webhook`}
                      className="font-mono text-xs"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          `https://qybuufofocxsctwnpwon.supabase.co/functions/v1/telegram-webhook`
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
                        const webhookUrl = `https://qybuufofocxsctwnpwon.supabase.co/functions/v1/telegram-webhook`;
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

              {/* Client Links Section */}
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
                        {clients.map((client) => {
                          const botUsername = config.bot_username.replace("@", "");
                          const phoneClean = client.phone?.replace(/[^\d]/g, "") || "";
                          const telegramLink = `https://t.me/${botUsername}?start=${phoneClean}`;
                          const isLinked = !!client.telegram_chat_id;
                          
                          return (
                            <TableRow key={client.id}>
                              <TableCell className="font-medium">{client.client_name}</TableCell>
                              <TableCell>{client.phone || "-"}</TableCell>
                              <TableCell>
                                {isLinked ? (
                                  <Badge className="bg-green-500">
                                    <CheckCircle className="h-3 w-3 mr-1" />
                                    Vinculado
                                  </Badge>
                                ) : (
                                  <Badge variant="secondary">
                                    <Clock className="h-3 w-3 mr-1" />
                                    Pendiente
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-right space-x-2">
                                {client.phone && (
                                  <>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        navigator.clipboard.writeText(telegramLink);
                                        toast.success("Enlace copiado");
                                      }}
                                    >
                                      <Copy className="h-3 w-3 mr-1" />
                                      Copiar
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="text-green-600 border-green-600 hover:bg-green-50"
                                      onClick={() => {
                                        const message = encodeURIComponent(
                                          `¡Hola ${client.client_name}!\n\nPara recibir notificaciones de pago por Telegram, haz clic en el siguiente enlace:\n\n${telegramLink}\n\nSolo debes presionar "Iniciar" y listo! 👍`
                                        );
                                        window.open(
                                          `https://wa.me/${phoneClean}?text=${message}`,
                                          "_blank"
                                        );
                                      }}
                                    >
                                      <MessageSquare className="h-3 w-3 mr-1" />
                                      WhatsApp
                                    </Button>
                                  </>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No hay clientes registrados
                  </p>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="send" className="space-y-4 mt-4">
            {!existingConfig?.is_active ? (
              <div className="text-center py-8 text-muted-foreground">
                <SendIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Configura y activa Telegram Bot primero</p>
              </div>
            ) : (
              <div className="grid gap-4">
                <div className="space-y-2">
                  <Label>Cliente (opcional)</Label>
                  <Select value={selectedClient} onValueChange={setSelectedClient}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar cliente..." />
                    </SelectTrigger>
                    <SelectContent>
                      {clients?.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.client_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Chat ID de Telegram (numérico)</Label>
                  <Input
                    placeholder="123456789"
                    value={customChatId}
                    onChange={(e) => setCustomChatId(e.target.value)}
                    type="text"
                    inputMode="numeric"
                  />
                  <p className="text-xs text-muted-foreground">
                    ⚠️ <strong>Importante:</strong> El Chat ID es un número, NO un username (@nombre).
                    El cliente debe enviar /start al bot, luego usar <strong>@userinfobot</strong> o <strong>@getidsbot</strong> para obtener su ID numérico.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Mensaje</Label>
                  <Textarea
                    placeholder="Escribe tu mensaje aquí..."
                    value={messageContent}
                    onChange={(e) => setMessageContent(e.target.value)}
                    rows={4}
                  />
                  <p className="text-xs text-muted-foreground">
                    Soporta formato HTML: &lt;b&gt;negrita&lt;/b&gt;, &lt;i&gt;itálica&lt;/i&gt;, &lt;a href=""&gt;enlace&lt;/a&gt;
                  </p>
                </div>

                <Button
                  onClick={handleSendMessage}
                  disabled={sendMessageMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700"
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
                      <TableHead>Chat ID</TableHead>
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
                        <TableCell className="font-mono text-sm">{msg.chat_id}</TableCell>
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
