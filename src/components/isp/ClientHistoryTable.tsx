import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getSelectedDeviceId } from "@/lib/mikrotik";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { History, Wifi, Gauge, MapPin, Phone, Mail, Pencil, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";

interface IspClient {
  id: string;
  client_name: string;
  identification_number: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  connection_type: string;
  username: string;
  assigned_ip: string | null;
  plan_or_speed: string | null;
  is_potential_client: boolean | null;
  comment: string | null;
  created_at: string;
}

export function ClientHistoryTable() {
  const mikrotikId = getSelectedDeviceId();
  const queryClient = useQueryClient();
  const [editingClient, setEditingClient] = useState<IspClient | null>(null);
  const [deletingClient, setDeletingClient] = useState<IspClient | null>(null);
  const [editForm, setEditForm] = useState<Partial<IspClient>>({});

  const { data: clients, isLoading } = useQuery({
    queryKey: ["isp-clients", mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      
      const { data, error } = await supabase
        .from("isp_clients")
        .select("*")
        .eq("mikrotik_id", mikrotikId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      return data || [];
    },
    enabled: !!mikrotikId,
  });

  const updateMutation = useMutation({
    mutationFn: async (client: Partial<IspClient> & { id: string }) => {
      const { error } = await supabase
        .from("isp_clients")
        .update({
          client_name: client.client_name,
          identification_number: client.identification_number,
          phone: client.phone,
          email: client.email,
          address: client.address,
          city: client.city,
          plan_or_speed: client.plan_or_speed,
          comment: client.comment,
        })
        .eq("id", client.id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["isp-clients"] });
      toast.success("Cliente actualizado correctamente");
      setEditingClient(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "Error al actualizar cliente");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("isp_clients")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["isp-clients"] });
      toast.success("Cliente eliminado correctamente");
      setDeletingClient(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "Error al eliminar cliente");
    },
  });

  const handleEdit = (client: IspClient) => {
    setEditingClient(client);
    setEditForm(client);
  };

  const handleSaveEdit = () => {
    if (!editingClient) return;
    updateMutation.mutate({ ...editForm, id: editingClient.id } as IspClient);
  };

  if (!mikrotikId) return null;

  return (
    <>
      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <History className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Historial de Clientes Registrados</CardTitle>
              <CardDescription>Últimos 50 clientes registrados en este dispositivo</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
              <p className="text-muted-foreground mt-2">Cargando historial...</p>
            </div>
          ) : !clients || clients.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No hay clientes registrados aún
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Usuario</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Plan/Velocidad</TableHead>
                    <TableHead>Contacto</TableHead>
                    <TableHead className="text-center">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients.map((client: IspClient) => (
                    <TableRow key={client.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {format(new Date(client.created_at), "dd MMM yyyy HH:mm", { locale: es })}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{client.client_name}</div>
                        {client.identification_number && (
                          <div className="text-xs text-muted-foreground">ID: {client.identification_number}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        {client.connection_type === 'pppoe' ? (
                          <Badge variant="default" className="gap-1">
                            <Wifi className="h-3 w-3" />
                            PPPoE
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-800 hover:bg-amber-200">
                            <Gauge className="h-3 w-3" />
                            Queue
                          </Badge>
                        )}
                        {client.is_potential_client && (
                          <Badge variant="outline" className="ml-1 text-xs">Potencial</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{client.username}</TableCell>
                      <TableCell className="font-mono text-sm">{client.assigned_ip || "-"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{client.plan_or_speed || "-"}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1 text-xs">
                          {client.phone && (
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <Phone className="h-3 w-3" />
                              {client.phone}
                            </div>
                          )}
                          {client.email && (
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <Mail className="h-3 w-3" />
                              {client.email}
                            </div>
                          )}
                          {client.city && (
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <MapPin className="h-3 w-3" />
                              {client.city}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(client)}
                            title="Editar cliente"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeletingClient(client)}
                            title="Eliminar cliente"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog para editar cliente */}
      <Dialog open={!!editingClient} onOpenChange={(open) => !open && setEditingClient(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Cliente</DialogTitle>
            <DialogDescription>
              Modifica los datos del cliente. Los campos de conexión no se pueden editar.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">Nombre del Cliente</Label>
              <Input
                id="edit-name"
                value={editForm.client_name || ""}
                onChange={(e) => setEditForm({ ...editForm, client_name: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-id">Número de Identificación</Label>
              <Input
                id="edit-id"
                value={editForm.identification_number || ""}
                onChange={(e) => setEditForm({ ...editForm, identification_number: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-phone">Teléfono</Label>
                <Input
                  id="edit-phone"
                  value={editForm.phone || ""}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-email">Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={editForm.email || ""}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-address">Dirección</Label>
              <Input
                id="edit-address"
                value={editForm.address || ""}
                onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-city">Ciudad</Label>
                <Input
                  id="edit-city"
                  value={editForm.city || ""}
                  onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-plan">Plan/Velocidad</Label>
                <Input
                  id="edit-plan"
                  value={editForm.plan_or_speed || ""}
                  onChange={(e) => setEditForm({ ...editForm, plan_or_speed: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-comment">Comentario</Label>
              <Input
                id="edit-comment"
                value={editForm.comment || ""}
                onChange={(e) => setEditForm({ ...editForm, comment: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingClient(null)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveEdit} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Guardando..." : "Guardar Cambios"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AlertDialog para confirmar eliminación */}
      <AlertDialog open={!!deletingClient} onOpenChange={(open) => !open && setDeletingClient(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará el registro de <strong>{deletingClient?.client_name}</strong> del historial. 
              Esta acción no se puede deshacer y no afecta la configuración en el MikroTik.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingClient && deleteMutation.mutate(deletingClient.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
