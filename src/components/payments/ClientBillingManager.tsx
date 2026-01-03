import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Calendar, DollarSign, Loader2, Receipt, AlertTriangle, CheckCircle, Clock, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { format, addMonths, setDate, parseISO } from "date-fns";
import { es } from "date-fns/locale";

interface ClientBillingManagerProps {
  mikrotikId: string | null;
}

interface Client {
  id: string;
  client_name: string;
  username: string;
  connection_type: string;
  plan_or_speed: string | null;
}

interface BillingSetting {
  id: string;
  client_id: string;
  billing_day: number;
  grace_period_days: number;
  monthly_amount: number;
  is_suspended: boolean;
  next_billing_date: string | null;
  last_payment_date: string | null;
}

interface Invoice {
  id: string;
  invoice_number: string;
  amount: number;
  due_date: string;
  status: string;
  paid_at: string | null;
  paid_via: string | null;
  billing_period_start: string;
  billing_period_end: string;
}

export function ClientBillingManager({ mikrotikId }: ClientBillingManagerProps) {
  const queryClient = useQueryClient();
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [billingForm, setBillingForm] = useState({
    billing_day: 1,
    grace_period_days: 5,
    monthly_amount: 0
  });
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { data: clients, isLoading: loadingClients } = useQuery({
    queryKey: ['isp-clients-billing', mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      const { data, error } = await supabase
        .from('isp_clients')
        .select('id, client_name, username, connection_type, plan_or_speed')
        .eq('mikrotik_id', mikrotikId)
        .eq('is_potential_client', false);
      if (error) throw error;
      return data as Client[];
    },
    enabled: !!mikrotikId
  });

  const { data: billingSettings } = useQuery({
    queryKey: ['billing-settings', mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      const { data, error } = await supabase
        .from('client_billing_settings')
        .select('*')
        .eq('mikrotik_id', mikrotikId);
      if (error) throw error;
      return data as BillingSetting[];
    },
    enabled: !!mikrotikId
  });

  const { data: invoices } = useQuery({
    queryKey: ['client-invoices', mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      const { data, error } = await supabase
        .from('client_invoices')
        .select('*')
        .eq('mikrotik_id', mikrotikId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as Invoice[];
    },
    enabled: !!mikrotikId
  });

  const saveBillingMutation = useMutation({
    mutationFn: async () => {
      if (!selectedClient || !mikrotikId) throw new Error('Datos incompletos');
      
      const existingSetting = billingSettings?.find(s => s.client_id === selectedClient.id);
      const nextBillingDate = setDate(addMonths(new Date(), 1), billingForm.billing_day);

      const payload = {
        client_id: selectedClient.id,
        mikrotik_id: mikrotikId,
        billing_day: billingForm.billing_day,
        grace_period_days: billingForm.grace_period_days,
        monthly_amount: billingForm.monthly_amount,
        next_billing_date: format(nextBillingDate, 'yyyy-MM-dd')
      };

      if (existingSetting) {
        const { error } = await supabase
          .from('client_billing_settings')
          .update(payload)
          .eq('id', existingSetting.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('client_billing_settings')
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success('Configuración de facturación guardada');
      queryClient.invalidateQueries({ queryKey: ['billing-settings'] });
      setIsDialogOpen(false);
    },
    onError: (error) => {
      toast.error(`Error: ${error.message}`);
    }
  });

  const generateInvoiceMutation = useMutation({
    mutationFn: async (clientId: string) => {
      const setting = billingSettings?.find(s => s.client_id === clientId);
      if (!setting || !mikrotikId) throw new Error('Configuración no encontrada');

      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const dueDate = setDate(now, setting.billing_day + setting.grace_period_days);

      const invoiceNumber = `FAC-${format(now, 'yyyyMM')}-${clientId.slice(0, 8).toUpperCase()}`;

      const { error } = await supabase
        .from('client_invoices')
        .insert({
          mikrotik_id: mikrotikId,
          client_id: clientId,
          invoice_number: invoiceNumber,
          amount: setting.monthly_amount,
          due_date: format(dueDate, 'yyyy-MM-dd'),
          billing_period_start: format(periodStart, 'yyyy-MM-dd'),
          billing_period_end: format(periodEnd, 'yyyy-MM-dd'),
          status: 'pending'
        });

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Factura generada exitosamente');
      queryClient.invalidateQueries({ queryKey: ['client-invoices'] });
    },
    onError: (error) => {
      toast.error(`Error: ${error.message}`);
    }
  });

  const openBillingDialog = (client: Client) => {
    setSelectedClient(client);
    const existing = billingSettings?.find(s => s.client_id === client.id);
    if (existing) {
      setBillingForm({
        billing_day: existing.billing_day,
        grace_period_days: existing.grace_period_days,
        monthly_amount: existing.monthly_amount
      });
    } else {
      setBillingForm({ billing_day: 1, grace_period_days: 5, monthly_amount: 0 });
    }
    setIsDialogOpen(true);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid':
        return <Badge className="bg-green-500"><CheckCircle className="h-3 w-3 mr-1" />Pagado</Badge>;
      case 'pending':
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Pendiente</Badge>;
      case 'overdue':
        return <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />Vencido</Badge>;
      case 'cancelled':
        return <Badge variant="outline"><XCircle className="h-3 w-3 mr-1" />Cancelado</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getClientBilling = (clientId: string) => {
    return billingSettings?.find(s => s.client_id === clientId);
  };

  if (!mikrotikId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Selecciona un dispositivo MikroTik para gestionar la facturación
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Configuración de Facturación por Cliente
          </CardTitle>
          <CardDescription>
            Define el día de corte, periodo de gracia y valor mensual para cada cliente
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingClients ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Usuario</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Día Corte</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients?.map((client) => {
                  const billing = getClientBilling(client.id);
                  return (
                    <TableRow key={client.id}>
                      <TableCell className="font-medium">{client.client_name}</TableCell>
                      <TableCell>{client.username}</TableCell>
                      <TableCell>{client.plan_or_speed || '-'}</TableCell>
                      <TableCell>
                        {billing ? `Día ${billing.billing_day}` : '-'}
                      </TableCell>
                      <TableCell>
                        {billing ? `$${billing.monthly_amount.toLocaleString()}` : '-'}
                      </TableCell>
                      <TableCell>
                        {billing?.is_suspended ? (
                          <Badge variant="destructive">Suspendido</Badge>
                        ) : billing ? (
                          <Badge className="bg-green-500">Activo</Badge>
                        ) : (
                          <Badge variant="secondary">Sin config.</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => openBillingDialog(client)}
                          >
                            <Calendar className="h-4 w-4 mr-1" />
                            Configurar
                          </Button>
                          {billing && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => generateInvoiceMutation.mutate(client.id)}
                              disabled={generateInvoiceMutation.isPending}
                            >
                              <Receipt className="h-4 w-4 mr-1" />
                              Generar Factura
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Últimas Facturas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Número</TableHead>
                <TableHead>Periodo</TableHead>
                <TableHead>Vencimiento</TableHead>
                <TableHead>Monto</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Pagado el</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices?.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell className="font-mono">{invoice.invoice_number}</TableCell>
                  <TableCell>
                    {format(parseISO(invoice.billing_period_start), 'dd MMM', { locale: es })} - {format(parseISO(invoice.billing_period_end), 'dd MMM yyyy', { locale: es })}
                  </TableCell>
                  <TableCell>{format(parseISO(invoice.due_date), 'dd/MM/yyyy')}</TableCell>
                  <TableCell>${invoice.amount.toLocaleString()}</TableCell>
                  <TableCell>{getStatusBadge(invoice.status)}</TableCell>
                  <TableCell>
                    {invoice.paid_at 
                      ? `${format(parseISO(invoice.paid_at), 'dd/MM/yyyy')} via ${invoice.paid_via || 'N/A'}`
                      : '-'}
                  </TableCell>
                </TableRow>
              ))}
              {(!invoices || invoices.length === 0) && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No hay facturas generadas
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configurar Facturación</DialogTitle>
            <DialogDescription>
              {selectedClient?.client_name} - {selectedClient?.username}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Día de Corte (1-28)</Label>
              <Select
                value={billingForm.billing_day.toString()}
                onValueChange={(v) => setBillingForm(prev => ({ ...prev, billing_day: parseInt(v) }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map(day => (
                    <SelectItem key={day} value={day.toString()}>
                      Día {day}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Días de Gracia</Label>
              <Select
                value={billingForm.grace_period_days.toString()}
                onValueChange={(v) => setBillingForm(prev => ({ ...prev, grace_period_days: parseInt(v) }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[0, 3, 5, 7, 10, 15].map(days => (
                    <SelectItem key={days} value={days.toString()}>
                      {days} días
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Valor Mensual (COP)</Label>
              <Input
                type="number"
                value={billingForm.monthly_amount}
                onChange={(e) => setBillingForm(prev => ({ ...prev, monthly_amount: parseFloat(e.target.value) || 0 }))}
                placeholder="50000"
              />
            </div>

            <Button 
              className="w-full" 
              onClick={() => saveBillingMutation.mutate()}
              disabled={saveBillingMutation.isPending}
            >
              {saveBillingMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Guardar Configuración
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
