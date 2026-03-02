import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { clientsApi, billingApi, invoicesApi, addressListApi } from "@/lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Users, Wifi, Gauge, MapPin, Phone, Mail, Pencil, Trash2, Search, Loader2, AlertTriangle, FileText, DollarSign, Ban, CheckCircle } from "lucide-react";
import { format, addMonths } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { useServiceOptions } from "@/hooks/useServiceOptions";
import { generateInvoicePDF } from "@/components/payments/InvoicePDF";
import { usePPPoEProfiles } from "@/hooks/useMikrotikData";
import { getSuspensionAddressList } from "@/components/isp/contracts/ContractTermsEditor";

interface ClientsManagerProps {
  mikrotikId: string | null;
  mikrotikVersion?: string;
}

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
  service_option: string | null;
  service_price: number | null;
  total_monthly_price: number | null;
}

interface BillingSetting {
  client_id: string;
  is_suspended: boolean;
}

export function ClientsManager({ mikrotikId, mikrotikVersion }: ClientsManagerProps) {
  const queryClient = useQueryClient();
  const [editingClient, setEditingClient] = useState<IspClient | null>(null);
  const [deletingClient, setDeletingClient] = useState<IspClient | null>(null);
  const [editForm, setEditForm] = useState<Partial<IspClient>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [deleteFromMikrotik, setDeleteFromMikrotik] = useState(true);
  const [generatingInvoice, setGeneratingInvoice] = useState<string | null>(null);
  const [invoiceClient, setInvoiceClient] = useState<IspClient | null>(null);
  const [suspendingClient, setSuspendingClient] = useState<string | null>(null);
  
  const { services: serviceOptions, loading: loadingServices } = useServiceOptions(mikrotikId);
  const { data: pppoeProfilesData, isLoading: loadingProfiles } = usePPPoEProfiles();
  const pppoeProfiles = (pppoeProfilesData as any[]) || [];

  const getPlanPrices = (): Record<string, string> => {
    const saved = localStorage.getItem("isp_plan_prices");
    return saved ? JSON.parse(saved) : {};
  };

  const { data: clients, isLoading } = useQuery({
    queryKey: ["isp-clients-manager", mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      return clientsApi.list(mikrotikId, { is_potential_client: false });
    },
    enabled: !!mikrotikId,
  });

  const { data: billingSettings } = useQuery({
    queryKey: ["billing-settings-suspension", mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      return billingApi.listSuspension(mikrotikId);
    },
    enabled: !!mikrotikId,
  });

  const getClientSuspensionStatus = (clientId: string): boolean => {
    const setting = billingSettings?.find((s: BillingSetting) => s.client_id === clientId);
    return setting?.is_suspended || false;
  };

  const updateMutation = useMutation({
    mutationFn: async (client: Partial<IspClient> & { id: string }) => {
      await clientsApi.update(client.id, {
        client_name: client.client_name,
        identification_number: client.identification_number,
        phone: client.phone,
        email: client.email,
        address: client.address,
        city: client.city,
        plan_or_speed: client.plan_or_speed,
        comment: client.comment,
        service_option: client.service_option,
        service_price: client.service_price,
        total_monthly_price: client.total_monthly_price,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["isp-clients-manager"] });
      queryClient.invalidateQueries({ queryKey: ["billing-settings"] });
      toast.success("Cliente actualizado correctamente");
      setEditingClient(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "Error al actualizar cliente");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ client, deleteFromMikrotik }: { client: IspClient; deleteFromMikrotik: boolean }) => {
      await clientsApi.delete(client.id, deleteFromMikrotik);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["isp-clients-manager"] });
      queryClient.invalidateQueries({ queryKey: ["billing-settings"] });
      queryClient.invalidateQueries({ queryKey: ["client-invoices"] });
      toast.success("Cliente eliminado correctamente del sistema" + (deleteFromMikrotik ? " y MikroTik" : ""));
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

  const handleConfirmDelete = () => {
    if (!deletingClient) return;
    deleteMutation.mutate({ client: deletingClient, deleteFromMikrotik });
  };

  const parsePrice = (price: string): number => {
    const num = parseFloat(price.replace(/[^0-9.,]/g, "").replace(",", "."));
    return isNaN(num) ? 0 : num;
  };

  const handlePlanChange = (value: string) => {
    const planPrices = getPlanPrices();
    const savedPrice = planPrices[value];
    
    if (savedPrice) {
      const basePrice = parsePrice(savedPrice);
      const servicePrice = editForm.service_price || 0;
      const total = basePrice + servicePrice;
      
      setEditForm({
        ...editForm,
        plan_or_speed: value,
        total_monthly_price: total,
      });
    } else {
      setEditForm({
        ...editForm,
        plan_or_speed: value,
      });
    }
  };

  const handleServiceOptionChange = (value: string) => {
    const planPrices = getPlanPrices();
    const savedPlanPrice = planPrices[editForm.plan_or_speed || ""];
    const basePrice = savedPlanPrice ? parsePrice(savedPlanPrice) : 
      (editForm.total_monthly_price || 0) - (editForm.service_price || 0);

    if (value === "none") {
      setEditForm({
        ...editForm,
        service_option: null,
        service_price: null,
        total_monthly_price: basePrice > 0 ? basePrice : editForm.total_monthly_price,
      });
    } else {
      const selectedOption = serviceOptions?.find((opt) => opt.name === value);
      if (selectedOption) {
        setEditForm({
          ...editForm,
          service_option: selectedOption.name,
          service_price: selectedOption.price,
          total_monthly_price: basePrice + selectedOption.price,
        });
      }
    }
  };

  const handleGenerateInvoice = async (client: IspClient) => {
    setGeneratingInvoice(client.id);
    try {
      const result = await invoicesApi.generateForClient({
        mikrotik_id: mikrotikId,
        client_id: client.id,
      });

      const invoiceData = {
        invoice_number: result.invoice_number,
        amount: result.amount,
        due_date: result.due_date,
        billing_period_start: result.billing_period_start,
        billing_period_end: result.billing_period_end,
        status: "pending",
        paid_at: null,
        paid_via: null,
        contract_number: result.contract_number || null,
        service_breakdown: result.service_breakdown || {
          plan_name: `Plan ${client.plan_or_speed || "Internet"}`,
          plan_price: (client.total_monthly_price || 0) - (client.service_price || 0),
          service_option: client.service_option,
          service_price: client.service_price,
        },
      };

      const clientData = {
        client_name: client.client_name,
        phone: client.phone,
        address: client.address,
        email: client.email,
        identification_number: client.identification_number,
      };

      await generateInvoicePDF(invoiceData, clientData);
      toast.success("Factura creada y descargada correctamente");
    } catch (error: any) {
      console.error("Error generating invoice:", error);
      toast.error("Error al generar la factura");
    } finally {
      setGeneratingInvoice(null);
    }
  };

  const handleToggleSuspension = async (client: IspClient) => {
    if (!mikrotikId || !client.assigned_ip) {
      toast.error("El cliente necesita tener una IP asignada para suspender/reactivar");
      return;
    }

    const isSuspended = getClientSuspensionStatus(client.id);
    const action = isSuspended ? "remove" : "add";
    
    setSuspendingClient(client.id);
    
    try {
      const suspensionList = getSuspensionAddressList();
      
      await addressListApi.toggleSuspension(mikrotikId, {
        action,
        address: client.assigned_ip,
        clientId: client.id,
        listName: suspensionList,
        comment: `${client.client_name} - ${isSuspended ? "Reactivado" : "Suspendido"} manualmente`,
      });

      queryClient.invalidateQueries({ queryKey: ["billing-settings-suspension"] });
      queryClient.invalidateQueries({ queryKey: ["billing-settings"] });

      toast.success(
        isSuspended 
          ? `Cliente ${client.client_name} reactivado correctamente` 
          : `Cliente ${client.client_name} suspendido correctamente`
      );
    } catch (error: any) {
      console.error("Error toggling suspension:", error);
      toast.error(`Error al ${isSuspended ? "reactivar" : "suspender"} cliente: ${error.message}`);
    } finally {
      setSuspendingClient(null);
    }
  };

  const filteredClients = clients?.filter((client: IspClient) => 
    client.client_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    client.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
    client.identification_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    client.phone?.includes(searchTerm) ||
    client.email?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  if (!mikrotikId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Selecciona un dispositivo MikroTik para ver los clientes
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">Gestión de Clientes</CardTitle>
                <CardDescription>
                  {clients?.length || 0} clientes registrados
                </CardDescription>
              </div>
            </div>
            <div className="relative w-full md:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar cliente..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
              <p className="text-muted-foreground mt-2">Cargando clientes...</p>
            </div>
          ) : filteredClients.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {searchTerm ? "No se encontraron clientes con ese criterio" : "No hay clientes registrados"}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Usuario</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Precio</TableHead>
                    <TableHead>Contacto</TableHead>
                    <TableHead>Registro</TableHead>
                    <TableHead className="text-center">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredClients.map((client: IspClient) => (
                    <TableRow key={client.id} className={getClientSuspensionStatus(client.id) ? "bg-red-50/50" : ""}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="font-medium">{client.client_name}</div>
                          {getClientSuspensionStatus(client.id) && (
                            <Badge variant="destructive" className="text-xs">
                              Suspendido
                            </Badge>
                          )}
                        </div>
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
                      </TableCell>
                      <TableCell className="font-mono text-sm">{client.username}</TableCell>
                      <TableCell className="font-mono text-sm">{client.assigned_ip || "-"}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge variant="outline">{client.plan_or_speed || "-"}</Badge>
                          {client.service_option && (
                            <span className="text-xs text-muted-foreground">+ {client.service_option}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm font-medium text-green-600">
                          <DollarSign className="h-3 w-3" />
                          {client.total_monthly_price?.toLocaleString("es-CO") || "0"}
                        </div>
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
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(client.created_at), "dd MMM yyyy", { locale: es })}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-1">
                          {client.assigned_ip && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleToggleSuspension(client)}
                              title={getClientSuspensionStatus(client.id) ? "Reactivar cliente" : "Suspender cliente"}
                              disabled={suspendingClient === client.id}
                            >
                              {suspendingClient === client.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : getClientSuspensionStatus(client.id) ? (
                                <CheckCircle className="h-4 w-4 text-green-600" />
                              ) : (
                                <Ban className="h-4 w-4 text-orange-600" />
                              )}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleGenerateInvoice(client)}
                            title="Generar factura"
                            disabled={generatingInvoice === client.id}
                          >
                            {generatingInvoice === client.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <FileText className="h-4 w-4 text-blue-600" />
                            )}
                          </Button>
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
                            onClick={() => {
                              setDeleteFromMikrotik(true);
                              setDeletingClient(client);
                            }}
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
        <DialogContent className="max-w-md max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Editar Cliente</DialogTitle>
            <DialogDescription>
              Modifica los datos del cliente. Los campos de conexión no se pueden editar.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4 overflow-y-auto flex-1 pr-2">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">Nombre del Cliente</Label>
              <Input id="edit-name" value={editForm.client_name || ""} onChange={(e) => setEditForm({ ...editForm, client_name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-id">Número de Identificación</Label>
              <Input id="edit-id" value={editForm.identification_number || ""} onChange={(e) => setEditForm({ ...editForm, identification_number: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-phone">Teléfono</Label>
                <Input id="edit-phone" value={editForm.phone || ""} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-email">Email</Label>
                <Input id="edit-email" type="email" value={editForm.email || ""} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-address">Dirección</Label>
              <Input id="edit-address" value={editForm.address || ""} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-city">Ciudad</Label>
                <Input id="edit-city" value={editForm.city || ""} onChange={(e) => setEditForm({ ...editForm, city: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-plan">Plan/Velocidad</Label>
                {loadingProfiles ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Cargando planes...
                  </div>
                ) : (
                  <Select value={editForm.plan_or_speed || ""} onValueChange={handlePlanChange}>
                    <SelectTrigger><SelectValue placeholder="Seleccionar plan" /></SelectTrigger>
                    <SelectContent>
                      {pppoeProfiles.map((profile: any) => {
                        const planPrices = getPlanPrices();
                        const price = planPrices[profile.name];
                        return (
                          <SelectItem key={profile['.id'] || profile.name} value={profile.name}>
                            {profile.name} {price ? `- $${parsePrice(price).toLocaleString("es-CO")}` : ""}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
            
            <div className="grid gap-2">
              <Label>Servicio Adicional</Label>
              {loadingServices ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Cargando servicios...
                </div>
              ) : (
                <Select value={editForm.service_option || "none"} onValueChange={handleServiceOptionChange}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar servicio" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin servicio adicional</SelectItem>
                    {serviceOptions?.map((option) => (
                      <SelectItem key={option.id} value={option.name}>
                        {option.name} - ${option.price.toLocaleString("es-CO")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {editForm.service_option && (
                <div className="text-xs text-muted-foreground">
                  Precio del servicio: ${editForm.service_price?.toLocaleString("es-CO") || 0}
                </div>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-total">Precio Mensual Total</Label>
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <Input id="edit-total" type="number" value={editForm.total_monthly_price || 0} onChange={(e) => setEditForm({ ...editForm, total_monthly_price: parseFloat(e.target.value) || 0 })} className="font-medium" />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-comment">Comentario</Label>
              <Input id="edit-comment" value={editForm.comment || ""} onChange={(e) => setEditForm({ ...editForm, comment: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingClient(null)}>Cancelar</Button>
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
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              ¿Eliminar cliente completamente?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Esta acción eliminará a <strong>{deletingClient?.client_name}</strong> del sistema junto con:
                </p>
                <ul className="list-disc pl-5 space-y-1 text-sm">
                  <li>Configuración de facturación</li>
                  <li>Facturas generadas</li>
                  <li>Contratos asociados</li>
                  {deleteFromMikrotik && (
                    <li className="font-medium text-destructive">
                      Usuario {deletingClient?.connection_type === 'pppoe' ? 'PPPoE' : 'Simple Queue'} del MikroTik
                    </li>
                  )}
                </ul>
                <div className="flex items-center gap-2 pt-2">
                  <input type="checkbox" id="delete-mikrotik" checked={deleteFromMikrotik} onChange={(e) => setDeleteFromMikrotik(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
                  <label htmlFor="delete-mikrotik" className="text-sm font-medium">
                    También eliminar del MikroTik ({deletingClient?.connection_type === 'pppoe' ? 'PPPoE' : 'Queue'})
                  </label>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteMutation.isPending ? "Eliminando..." : "Eliminar Todo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}