import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2, Receipt, AlertTriangle, CheckCircle, Clock, XCircle, Send, MessageCircle, Download, Paperclip, Trash2, FilePlus } from "lucide-react";
import { generateInvoicePDF, generateInvoicePDFBlob } from "./InvoicePDF";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { CreateInvoiceDialog } from "./CreateInvoiceDialog";

interface ClientBillingManagerProps {
  mikrotikId: string | null;
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
  
  // Telegram send state
  const [telegramDialogOpen, setTelegramDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramMessage, setTelegramMessage] = useState("");
  const [attachPdfTelegram, setAttachPdfTelegram] = useState(true);
  const [isSendingWithPdf, setIsSendingWithPdf] = useState(false);
  const [createInvoiceDialogOpen, setCreateInvoiceDialogOpen] = useState(false);

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
  const { data: ispClients, isLoading: loadingClients } = useQuery({
    queryKey: ['isp-clients-phones', mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      const { data, error } = await supabase
        .from('isp_clients')
        .select('id, client_name, username, phone, telegram_chat_id, email, address, identification_number, total_monthly_price, plan_or_speed')
        .eq('mikrotik_id', mikrotikId)
        .order('client_name');
      if (error) throw error;
      return data;
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

  // Delete invoice mutation
  const deleteInvoiceMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const { error } = await supabase
        .from('client_invoices')
        .delete()
        .eq('id', invoiceId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Factura eliminada correctamente");
      queryClient.invalidateQueries({ queryKey: ['client-invoices'] });
    },
    onError: (error: any) => {
      toast.error(`Error al eliminar: ${error.message}`);
    },
  });

  const fetchLatestContractForClient = async (clientId: string) => {
    if (!mikrotikId) return null;

    const { data, error } = await supabase
      .from("isp_contracts")
      .select(
        "id, contract_number, client_name, identification, address, phone, email, plan, speed, price"
      )
      .eq("mikrotik_id", mikrotikId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn("No se pudo obtener el contrato del cliente:", error);
      return null;
    }

    return data;
  };

  // Resolve client + contract info for PDF + payment links.
  const resolveInvoicePdfData = async (invoice: Invoice) => {
    const joinedContract = (invoice as any).isp_contracts ?? null;
    const contract =
      joinedContract ||
      (invoice.client_id ? await fetchLatestContractForClient(invoice.client_id) : null);

    const clientInfo = ispClients?.find((c) => c.id === invoice.client_id);

    const clientData = {
      client_name: contract?.client_name || clientInfo?.client_name || "Cliente",
      phone: contract?.phone || clientInfo?.phone || null,
      identification_number: contract?.identification || clientInfo?.identification_number || null,
      address: contract?.address || clientInfo?.address || null,
      email: contract?.email || clientInfo?.email || null,
    };

    const serviceDescription = contract?.plan
      ? `Servicio de Internet - ${contract.plan}${contract.speed ? ` (${contract.speed})` : ""}`
      : "Servicio de Internet - Plan Mensual";

    const invoiceWithContract = {
      ...invoice,
      contract_id: invoice.contract_id || contract?.id || null,
      contract_number: contract?.contract_number || null,
    };

    return { clientData, serviceDescription, invoiceWithContract };
  };

  const openTelegramDialog = async (invoice: Invoice) => {
    const client = ispClients?.find((c) => c.id === invoice.client_id);
    const { clientData, invoiceWithContract } = await resolveInvoicePdfData(invoice);

    const paymentLink = getPaymentLink(invoiceWithContract.contract_number || clientData.identification_number);

    let defaultMessage = `📄 *Factura ${invoice.invoice_number}*\n\nMonto: $${invoice.amount.toLocaleString()}\nVencimiento: ${format(parseISO(invoice.due_date), "dd/MM/yyyy")}\nPeriodo: ${format(parseISO(invoice.billing_period_start), "dd MMM")} - ${format(parseISO(invoice.billing_period_end), "dd MMM yyyy", { locale: es })}\n\nPor favor realice su pago antes de la fecha de vencimiento.`;

    if (paymentLink && invoice.status !== "paid") {
      defaultMessage += `\n\n💳 Pagar en línea:\n${paymentLink}`;
    }

    setSelectedInvoice(invoice);
    setTelegramMessage(defaultMessage);
    setTelegramChatId(client?.telegram_chat_id || "");
    setTelegramDialogOpen(true);
  };

  // Upload PDF and get public URL
  const uploadInvoicePdf = async (invoice: Invoice): Promise<string> => {
    const { clientData, serviceDescription, invoiceWithContract } = await resolveInvoicePdfData(invoice);
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
  const getPaymentLink = (query: string | null) => {
    if (!query) return null;
    const baseUrl = window.location.origin;
    return `${baseUrl}/pay?contract=${encodeURIComponent(query)}`;
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
      
      const { clientData, invoiceWithContract } = await resolveInvoicePdfData(selectedInvoice);
      const paymentLink = getPaymentLink(invoiceWithContract.contract_number || clientData.identification_number);
      let messageWithLink = telegramMessage;
      if (paymentLink && selectedInvoice.status !== 'paid' && !messageWithLink.includes(paymentLink)) {
        messageWithLink += `\n\n💳 Pagar en línea:\n${paymentLink}`;
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
    
    const { clientData, invoiceWithContract } = await resolveInvoicePdfData(invoice);
    const paymentLink = getPaymentLink(invoiceWithContract.contract_number || clientData.identification_number);
    
    let message = `📄 *Factura ${invoice.invoice_number}*\n\nMonto: $${invoice.amount.toLocaleString()}\nVencimiento: ${format(parseISO(invoice.due_date), 'dd/MM/yyyy')}\nPeriodo: ${format(parseISO(invoice.billing_period_start), 'dd MMM')} - ${format(parseISO(invoice.billing_period_end), 'dd MMM yyyy', { locale: es })}\n\nPor favor realice su pago antes de la fecha de vencimiento.`;
    
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
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              Facturas
            </CardTitle>
            <Button onClick={() => setCreateInvoiceDialogOpen(true)}>
              <FilePlus className="h-4 w-4 mr-2" />
              Crear Factura
            </Button>
          </div>
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
                <TableHead>Acciones</TableHead>
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
                          title={telegramConfig?.is_active ? "Enviar por Telegram" : "Telegram no configurado"}
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
                            const { clientData, serviceDescription, invoiceWithContract } = await resolveInvoicePdfData(invoice);
                            await generateInvoicePDF(invoiceWithContract, clientData, undefined, serviceDescription);
                          }}
                          title="Descargar PDF"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive border-destructive hover:bg-destructive/10"
                          onClick={() => {
                            if (confirm(`¿Eliminar factura ${invoice.invoice_number}?`)) {
                              deleteInvoiceMutation.mutate(invoice.id);
                            }
                          }}
                          disabled={deleteInvoiceMutation.isPending}
                          title="Eliminar factura"
                        >
                          <Trash2 className="h-4 w-4" />
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

      {/* Create Invoice Dialog */}
      <CreateInvoiceDialog
        open={createInvoiceDialogOpen}
        onOpenChange={setCreateInvoiceDialogOpen}
        mikrotikId={mikrotikId || ""}
        clients={ispClients?.map(c => ({
          id: c.id,
          client_name: c.client_name,
          username: (c as any).username || c.client_name,
          phone: c.phone,
          email: c.email,
          identification_number: c.identification_number,
          total_monthly_price: (c as any).total_monthly_price || null,
          plan_or_speed: (c as any).plan_or_speed || null,
        })) || []}
        loadingClients={loadingClients}
      />
    </div>
  );
}
