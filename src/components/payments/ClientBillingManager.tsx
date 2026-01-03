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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Calendar, DollarSign, Loader2, Receipt, AlertTriangle, CheckCircle, Clock, XCircle, Send, MessageCircle, Download, Paperclip } from "lucide-react";
import { generateInvoicePDF, generateInvoicePDFBlob } from "./InvoicePDF";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  client_id: string | null;
  contract_id: string | null;
}

interface Contract {
  id: string;
  client_name: string;
  identification: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  plan: string;
  speed: string | null;
  price: string | null;
}

interface IspClient {
  id: string;
  client_name: string;
  phone: string | null;
  telegram_chat_id: string | null;
  email: string | null;
  address: string | null;
  identification_number: string | null;
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
  
  // Telegram send state
  const [telegramDialogOpen, setTelegramDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramMessage, setTelegramMessage] = useState("");
  const [attachPdfTelegram, setAttachPdfTelegram] = useState(true);
  const [isSendingWithPdf, setIsSendingWithPdf] = useState(false);
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
        .select('*, isp_contracts(id, contract_number, client_name, identification, address, phone, email, plan, speed, price)')
        .eq('mikrotik_id', mikrotikId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    enabled: !!mikrotikId
  });

  // Fetch ISP clients with phone for Telegram
  const { data: ispClients } = useQuery({
    queryKey: ['isp-clients-phones', mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      const { data, error } = await supabase
        .from('isp_clients')
        .select('id, client_name, phone, telegram_chat_id, email, address, identification_number')
        .eq('mikrotik_id', mikrotikId);
      if (error) throw error;
      return data as IspClient[];
    },
    enabled: !!mikrotikId
  });

  // Fetch Telegram config
  const { data: telegramConfig } = useQuery({
    queryKey: ['telegram-config', mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return null;
      const { data, error } = await supabase
        .from('telegram_config')
        .select('*')
        .eq('mikrotik_id', mikrotikId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!mikrotikId
  });

  // Fetch WhatsApp config
  const { data: whatsappConfig } = useQuery({
    queryKey: ['whatsapp-config', mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return null;
      const { data, error } = await supabase
        .from('whatsapp_config')
        .select('*')
        .eq('mikrotik_id', mikrotikId)
        .maybeSingle();
      if (error) throw error;
      return data;
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

  // Send Telegram message mutation
  const sendTelegramMutation = useMutation({
    mutationFn: async ({ chatId, message, invoiceId, documentUrl, documentName }: { 
      chatId: string; 
      message: string; 
      invoiceId: string;
      documentUrl?: string;
      documentName?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("telegram-send", {
        body: {
          mikrotikId,
          chatId,
          message,
          invoiceId,
          documentUrl,
          documentName,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.success("Factura enviada por Telegram correctamente");
      setTelegramDialogOpen(false);
      setTelegramChatId("");
      setTelegramMessage("");
      setSelectedInvoice(null);
      setAttachPdfTelegram(true);
    },
    onError: (error: any) => {
      toast.error(`Error al enviar: ${error.message}`);
    },
  });

  // Send WhatsApp message mutation
  const sendWhatsAppMutation = useMutation({
    mutationFn: async ({ phone, message, invoiceId, documentUrl, documentName }: { 
      phone: string; 
      message: string; 
      invoiceId: string;
      documentUrl?: string;
      documentName?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: {
          mikrotikId,
          phoneNumber: phone,
          message,
          invoiceId,
          documentUrl,
          documentName,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.success("Factura enviada por WhatsApp correctamente");
    },
    onError: (error: any) => {
      toast.error(`Error al enviar: ${error.message}`);
    },
  });

  const openTelegramDialog = (invoice: Invoice) => {
    const client = ispClients?.find(c => c.id === invoice.client_id);
    const { invoiceWithContract } = getInvoicePdfData(invoice);
    const paymentLink = getPaymentLink(invoiceWithContract.contract_number);
    
    let defaultMessage = `📄 *Factura ${invoice.invoice_number}*\n\nMonto: $${invoice.amount.toLocaleString()}\nVencimiento: ${format(parseISO(invoice.due_date), 'dd/MM/yyyy')}\nPeriodo: ${format(parseISO(invoice.billing_period_start), 'dd MMM')} - ${format(parseISO(invoice.billing_period_end), 'dd MMM yyyy', { locale: es })}\n\nPor favor realice su pago antes de la fecha de vencimiento.`;
    
    // Add payment link if contract exists and invoice is not paid
    if (paymentLink && invoice.status !== 'paid') {
      defaultMessage += `\n\n💳 *Pagar en línea:*\n${paymentLink}`;
    }
    
    setSelectedInvoice(invoice);
    setTelegramMessage(defaultMessage);
    // Pre-fill the Chat ID if the client has one linked
    setTelegramChatId(client?.telegram_chat_id || "");
    setTelegramDialogOpen(true);
  };

  // Helper function to get client and contract data for PDF
  const getInvoicePdfData = (invoice: Invoice) => {
    const contract = (invoice as any).isp_contracts;
    const clientInfo = ispClients?.find(c => c.id === invoice.client_id);
    const clientData = {
      client_name: contract?.client_name || clientInfo?.client_name || "Cliente",
      phone: contract?.phone || clientInfo?.phone || null,
      identification_number: contract?.identification || clientInfo?.identification_number || null,
      address: contract?.address || clientInfo?.address || null,
      email: contract?.email || clientInfo?.email || null
    };
    const serviceDescription = contract?.plan 
      ? `Servicio de Internet - ${contract.plan}${contract.speed ? ` (${contract.speed})` : ''}`
      : "Servicio de Internet - Plan Mensual";
    // Add contract number to invoice data for PDF
    const invoiceWithContract = {
      ...invoice,
      contract_number: contract?.contract_number || null
    };
    return { clientData, serviceDescription, invoiceWithContract };
  };

  // Upload PDF and get public URL
  const uploadInvoicePdf = async (invoice: Invoice): Promise<string> => {
    const { clientData, serviceDescription, invoiceWithContract } = getInvoicePdfData(invoice);
    const pdfBlob = await generateInvoicePDFBlob(invoiceWithContract, clientData, undefined, serviceDescription);
    
    const fileName = `invoices/${mikrotikId}/${invoice.invoice_number.replace(/\//g, '-')}.pdf`;
    
    const { data, error } = await supabase.storage
      .from('company-assets')
      .upload(fileName, pdfBlob, {
        contentType: 'application/pdf',
        upsert: true
      });
    
    if (error) throw new Error(`Error al subir PDF: ${error.message}`);
    
    const { data: urlData } = supabase.storage
      .from('company-assets')
      .getPublicUrl(data.path);
    
    return urlData.publicUrl;
  };

  // Generate payment portal link
  const getPaymentLink = (contractNumber: string | null) => {
    if (!contractNumber) return null;
    const baseUrl = window.location.origin;
    return `${baseUrl}/pay?contract=${encodeURIComponent(contractNumber)}`;
  };

  const handleSendTelegram = async () => {
    if (!telegramChatId || !selectedInvoice) {
      toast.error("Ingresa el Chat ID de Telegram");
      return;
    }
    
    try {
      setIsSendingWithPdf(true);
      let documentUrl: string | undefined;
      let documentName: string | undefined;
      
      if (attachPdfTelegram) {
        documentUrl = await uploadInvoicePdf(selectedInvoice);
        documentName = `Factura_${selectedInvoice.invoice_number.replace(/\//g, '-')}.pdf`;
      }
      
      // Add payment link to message if contract number exists
      const { invoiceWithContract } = getInvoicePdfData(selectedInvoice);
      const paymentLink = getPaymentLink(invoiceWithContract.contract_number);
      let messageWithLink = telegramMessage;
      if (paymentLink && selectedInvoice.status !== 'paid') {
        messageWithLink += `\n\n💳 <b>Pagar en línea:</b>\n${paymentLink}`;
      }
      
      sendTelegramMutation.mutate({
        chatId: telegramChatId,
        message: messageWithLink,
        invoiceId: selectedInvoice.id,
        documentUrl,
        documentName,
      });
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setIsSendingWithPdf(false);
    }
  };

  const handleSendWhatsApp = async (invoice: Invoice, withPdf: boolean = false) => {
    const clientInfo = ispClients?.find(c => c.id === invoice.client_id);
    if (!clientInfo?.phone) {
      toast.error("El cliente no tiene número de teléfono registrado");
      return;
    }
    
    // Get contract number for payment link
    const { invoiceWithContract } = getInvoicePdfData(invoice);
    const paymentLink = getPaymentLink(invoiceWithContract.contract_number);
    
    let message = `📄 *Factura ${invoice.invoice_number}*\n\nMonto: $${invoice.amount.toLocaleString()}\nVencimiento: ${format(parseISO(invoice.due_date), 'dd/MM/yyyy')}\nPeriodo: ${format(parseISO(invoice.billing_period_start), 'dd MMM')} - ${format(parseISO(invoice.billing_period_end), 'dd MMM yyyy', { locale: es })}\n\nPor favor realice su pago antes de la fecha de vencimiento.`;
    
    // Add payment link if contract number exists and invoice is not paid
    if (paymentLink && invoice.status !== 'paid') {
      message += `\n\n💳 *Pagar en línea:*\n${paymentLink}`;
    }
    
    try {
      let documentUrl: string | undefined;
      let documentName: string | undefined;
      
      if (withPdf) {
        setIsSendingWithPdf(true);
        documentUrl = await uploadInvoicePdf(invoice);
        documentName = `Factura_${invoice.invoice_number.replace(/\//g, '-')}.pdf`;
      }
      
      sendWhatsAppMutation.mutate({
        phone: clientInfo.phone,
        message,
        invoiceId: invoice.id,
        documentUrl,
        documentName,
      });
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setIsSendingWithPdf(false);
    }
  };

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
                <TableHead>Enviar / Descargar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices?.map((invoice) => {
                const client = ispClients?.find(c => c.id === invoice.client_id);
                return (
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
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openTelegramDialog(invoice)}
                          disabled={!telegramConfig?.is_active}
                          title={telegramConfig?.is_active ? "Enviar por Telegram (con opción de PDF)" : "Telegram no configurado"}
                        >
                          <Send className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleSendWhatsApp(invoice, false)}
                          disabled={!whatsappConfig?.is_active || !client?.phone || sendWhatsAppMutation.isPending || isSendingWithPdf}
                          title={whatsappConfig?.is_active ? "Enviar texto por WhatsApp" : "WhatsApp no configurado"}
                        >
                          <MessageCircle className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-green-600 border-green-600 hover:bg-green-50"
                          onClick={() => handleSendWhatsApp(invoice, true)}
                          disabled={!whatsappConfig?.is_active || !client?.phone || sendWhatsAppMutation.isPending || isSendingWithPdf}
                          title="Enviar con PDF adjunto por WhatsApp"
                        >
                          <MessageCircle className="h-4 w-4" />
                          <Paperclip className="h-3 w-3 -ml-1" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-primary border-primary hover:bg-primary/10"
                          onClick={async () => {
                            const { clientData, serviceDescription, invoiceWithContract } = getInvoicePdfData(invoice);
                            await generateInvoicePDF(invoiceWithContract, clientData, undefined, serviceDescription);
                          }}
                          title="Descargar PDF"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {(!invoices || invoices.length === 0) && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
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

      {/* Telegram Send Dialog */}
      <Dialog open={telegramDialogOpen} onOpenChange={setTelegramDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-blue-500" />
              Enviar Factura por Telegram
            </DialogTitle>
            <DialogDescription>
              Factura: {selectedInvoice?.invoice_number}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Chat ID de Telegram</Label>
              <Input
                value={telegramChatId}
                onChange={(e) => setTelegramChatId(e.target.value)}
                placeholder="123456789"
              />
              <p className="text-xs text-muted-foreground">
                El cliente debe iniciar chat con el bot primero. Usa @userinfobot para obtener el Chat ID.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Mensaje</Label>
              <Textarea
                value={telegramMessage}
                onChange={(e) => setTelegramMessage(e.target.value)}
                rows={6}
              />
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="attach-pdf"
                checked={attachPdfTelegram}
                onCheckedChange={(checked) => setAttachPdfTelegram(checked === true)}
              />
              <label
                htmlFor="attach-pdf"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-2"
              >
                <Paperclip className="h-4 w-4" />
                Adjuntar factura PDF
              </label>
            </div>

            <Button 
              className="w-full bg-blue-600 hover:bg-blue-700" 
              onClick={handleSendTelegram}
              disabled={sendTelegramMutation.isPending || isSendingWithPdf}
            >
              {(sendTelegramMutation.isPending || isSendingWithPdf) ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              {isSendingWithPdf ? "Subiendo PDF..." : "Enviar por Telegram"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
