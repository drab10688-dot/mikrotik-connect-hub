import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { techBotApi } from "@/lib/api-client";
import { copyToClipboard } from "@/lib/clipboard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { HardHat, Plus, Trash2, Loader2, Link as LinkIcon, Copy, History, CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface TelegramTechBotProps {
  mikrotikId: string | null;
}

export function TelegramTechBot({ mikrotikId }: TelegramTechBotProps) {
  const queryClient = useQueryClient();
  const [chatId, setChatId] = useState("");
  const [fullName, setFullName] = useState("");
  const [publicUrl, setPublicUrl] = useState(window.location.origin);

  const { data: technicians, isLoading } = useQuery({
    queryKey: ["telegram-technicians", mikrotikId],
    queryFn: async () => {
      const res = await techBotApi.listTechnicians(mikrotikId!);
      return res?.data ?? [];
    },
    enabled: !!mikrotikId,
  });

  const { data: provisions } = useQuery({
    queryKey: ["telegram-provisions", mikrotikId],
    queryFn: async () => {
      const res = await techBotApi.listProvisions(mikrotikId!);
      return res?.data ?? [];
    },
    enabled: !!mikrotikId,
  });

  const addMutation = useMutation({
    mutationFn: () =>
      techBotApi.addTechnician({ mikrotik_id: mikrotikId!, chat_id: chatId.trim(), full_name: fullName.trim() }),
    onSuccess: () => {
      toast.success("Técnico autorizado");
      setChatId("");
      setFullName("");
      queryClient.invalidateQueries({ queryKey: ["telegram-technicians", mikrotikId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      techBotApi.updateTechnician(id, { is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["telegram-technicians", mikrotikId] }),
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => techBotApi.deleteTechnician(id),
    onSuccess: () => {
      toast.success("Técnico eliminado");
      queryClient.invalidateQueries({ queryKey: ["telegram-technicians", mikrotikId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const webhookMutation = useMutation({
    mutationFn: () => techBotApi.setupWebhook(mikrotikId!, publicUrl),
    onSuccess: (res: any) => toast.success(`Webhook activo: ${res.webhookUrl}`),
    onError: (e: any) => toast.error(e.message),
  });

  const statusBadge = (status: string) => {
    if (status === "ok") return <Badge className="bg-green-500 text-white"><CheckCircle className="h-3 w-3 mr-1" />Completo</Badge>;
    if (status === "partial") return <Badge className="bg-yellow-500 text-white"><AlertTriangle className="h-3 w-3 mr-1" />Parcial</Badge>;
    return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Error</Badge>;
  };

  if (!mikrotikId) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-center">
            Selecciona un dispositivo MikroTik para configurar el bot de técnicos
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardHat className="h-5 w-5 text-amber-500" />
          Bot de Instalación para Técnicos
        </CardTitle>
        <CardDescription>
          Solo los técnicos autorizados aquí pueden usar el bot para crear usuarios PPPoE y configurar el WiFi de la ONU
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Webhook */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <LinkIcon className="h-5 w-5 text-blue-500" />
            <h3 className="font-semibold">1. Activar el bot</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Guarda primero el Bot Token en la pestaña Configuración, luego registra el webhook con la URL pública de tu VPS.
          </p>
          <div className="flex gap-2">
            <Input value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} placeholder="https://tu-dominio-o-ip" />
            <Button onClick={() => webhookMutation.mutate()} disabled={webhookMutation.isPending}>
              {webhookMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Registrar webhook"}
            </Button>
          </div>
        </div>

        <Separator />

        {/* Técnicos */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <HardHat className="h-5 w-5 text-amber-500" />
            <h3 className="font-semibold">2. Autorizar técnicos</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            El técnico debe escribirle <code className="bg-muted px-1 rounded">/start</code> al bot; este le responderá con su Chat ID.
            Regístralo aquí para darle acceso.
          </p>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Input placeholder="Nombre del técnico" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            <Input placeholder="Chat ID (ej: 123456789)" value={chatId} onChange={(e) => setChatId(e.target.value)} />
            <Button
              onClick={() => {
                if (!fullName.trim() || !chatId.trim()) {
                  toast.error("Nombre y Chat ID son requeridos");
                  return;
                }
                addMutation.mutate();
              }}
              disabled={addMutation.isPending}
            >
              {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
              Autorizar
            </Button>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : technicians?.length ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Técnico</TableHead>
                    <TableHead>Chat ID</TableHead>
                    <TableHead>Activo</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {technicians.map((t: any) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.full_name}</TableCell>
                      <TableCell className="font-mono text-xs">{t.chat_id}</TableCell>
                      <TableCell>
                        <Switch
                          checked={t.is_active}
                          onCheckedChange={(v) => toggleMutation.mutate({ id: t.id, is_active: v })}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => {
                            if (confirm(`¿Quitar acceso a ${t.full_name}?`)) deleteMutation.mutate(t.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              Aún no hay técnicos autorizados. Nadie más puede usar el bot.
            </p>
          )}
        </div>

        <Separator />

        {/* Instrucciones */}
        <div className="bg-muted/50 p-4 rounded-lg space-y-2">
          <p className="text-sm font-medium">Cómo lo usa el técnico en campo</p>
          <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1">
            <li>Envía <code className="bg-muted px-1 rounded">/nuevo</code> al bot</li>
            <li>Responde: nombre del cliente, usuario PPPoE, clave (o <b>auto</b>), plan, nombre WiFi, clave WiFi y serial de la ONU</li>
            <li>Confirma con <b>SI</b>: se crea el usuario PPPoE en la MikroTik y se envía la configuración WiFi y PPPoE a la ONU por TR-069</li>
          </ol>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              copyToClipboard("/nuevo").then((ok) => (ok ? toast.success("Comando copiado") : toast.error("No se pudo copiar")))
            }
          >
            <Copy className="h-4 w-4 mr-2" />
            Copiar comando /nuevo
          </Button>
        </div>

        {/* Historial */}
        {provisions?.length > 0 && (
          <>
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <History className="h-5 w-5 text-muted-foreground" />
                <h3 className="font-semibold">Instalaciones realizadas por el bot</h3>
              </div>
              <div className="rounded-md border max-h-[320px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Técnico</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>PPPoE</TableHead>
                      <TableHead>WiFi</TableHead>
                      <TableHead>Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {provisions.map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-xs">
                          {format(new Date(p.created_at), "dd/MM/yy HH:mm", { locale: es })}
                        </TableCell>
                        <TableCell className="text-sm">{p.technician_name}</TableCell>
                        <TableCell className="text-sm">{p.client_name}</TableCell>
                        <TableCell className="font-mono text-xs">{p.pppoe_username}</TableCell>
                        <TableCell className="text-sm">{p.wifi_ssid}</TableCell>
                        <TableCell>{statusBadge(p.status)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
