import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoicesApi, clientsApi, messagingApi } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2, Receipt, AlertTriangle, CheckCircle, Clock, XCircle, Send, MessageCircle, Download, Paperclip, Trash2, FilePlus } from "lucide-react";
import { generateInvoicePDF } from "./InvoicePDF";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import CreateInvoiceDialog from "./CreateInvoiceDialog";

interface ClientBillingManagerProps { mikrotikId: string | null; }
interface Invoice { id: string; invoice_number: string; amount: number; due_date: string; status: string; paid_at: string | null; paid_via: string | null; billing_period_start: string; billing_period_end: string; client_id: string | null; contract_id: string | null; }

export function ClientBillingManager({ mikrotikId }: ClientBillingManagerProps) {
  const queryClient = useQueryClient();
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
      return invoicesApi.list(mikrotikId, { with_contracts: true, limit: 50 });
    },
    enabled: !!mikrotikId
  });

  const { data: ispClients, isLoading: loadingClients } = useQuery({
    queryKey: ['isp-clients-phones', mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      return clientsApi.list(mikrotikId);
    },
    enabled: !!mikrotikId
  });

  const { data: telegramConfig } = useQuery({
    queryKey: ['telegram-config', mikrotikId],
    queryFn: async () => { if (!mikrotikId) return null; return messagingApi.getTelegramConfig(mikrotikId); },
    enabled: !!mikrotikId
  });

  const { data: whatsappConfig } = useQuery({
    queryKey: ['whatsapp-config', mikrotikId],
    queryFn: async () => { if (!mikrotikId) return null; return messagingApi.getWhatsappConfig(mikrotikId); },
    enabled: !!mikrotikId
  });

  const sendTelegramMutation = useMutation({
    mutationFn: async ({ chatId, message, invoiceId }: { chatId: string; message: string; invoiceId: string }) => {
      return messagingApi.sendTelegram({ mikrotikId, chatId, message, invoiceId });
    },
    onSuccess: () => { toast.success("Factura enviada por Telegram"); setTelegramDialogOpen(false); setTelegramChatId(""); setTelegramMessage(""); setSelectedInvoice(null); },
    onError: (error: any) => { toast.error(`Error al enviar: ${error.message}`); },
  });

  const sendWhatsAppMutation = useMutation({
    mutationFn: async ({ phone, message, invoiceId }: { phone: string; message: string; invoiceId: string }) => {
      return messagingApi.sendWhatsapp({ mikrotikId, phoneNumber: phone, message, invoiceId });
    },
    onSuccess: () => { toast.success("Factura enviada por WhatsApp"); },
    onError: (error: any) => { toast.error(`Error al enviar: ${error.message}`); },
  });

  const deleteInvoiceMutation = useMutation({
    mutationFn: async (invoiceId: string) => { await invoicesApi.delete(invoiceId); },
    onSuccess: () => { toast.success("Factura eliminada"); queryClient.invalidateQueries({ queryKey: ['client-invoices'] }); },
    onError: (error: any) => { toast.error(`Error: ${error.message}`); },
  });

  const getPaymentLink = (query: string | null) => {
    if (!query) return null;
    return `${window.location.origin}/pay?contract=${encodeURIComponent(query)}`;
  };

  const openTelegramDialog = (invoice: Invoice) => {
    const client = ispClients?.find((c: any) => c.id === invoice.client_id);
    let defaultMessage = `📄 *Factura ${invoice.invoice_number}*\n\nMonto: $${invoice.amount.toLocaleString()}\nVencimiento: ${format(parseISO(invoice.due_date), "dd/MM/yyyy")}\nPeriodo: ${format(parseISO(invoice.billing_period_start), "dd MMM")} - ${format(parseISO(invoice.billing_period_end), "dd MMM yyyy", { locale: es })}\n\nPor favor realice su pago antes de la fecha de vencimiento.`;
    setSelectedInvoice(invoice);
    setTelegramMessage(defaultMessage);
    setTelegramChatId(client?.telegram_chat_id || "");
    setTelegramDialogOpen(true);
  };

  const handleSendTelegram = () => {
    if (!telegramChatId || !selectedInvoice) { toast.error("Ingresa el Chat ID de Telegram"); return; }
    sendTelegramMutation.mutate({ chatId: telegramChatId, message: telegramMessage, invoiceId: selectedInvoice.id });
  };

  const handleSendWhatsApp = (invoice: Invoice) => {
    const clientInfo = ispClients?.find((c: any) => c.id === invoice.client_id);
    if (!clientInfo?.phone) { toast.error("El cliente no tiene número de teléfono"); return; }
    const message = `📄 *Factura ${invoice.invoice_number}*\n\nMonto: $${invoice.amount.toLocaleString()}\nVencimiento: ${format(parseISO(invoice.due_date), 'dd/MM/yyyy')}`;
    sendWhatsAppMutation.mutate({ phone: clientInfo.phone, message, invoiceId: invoice.id });
  };

  const handleDownloadPDF = async (invoice: Invoice) => {
    const client = ispClients?.find((c: any) => c.id === invoice.client_id);
    const clientData = { client_name: client?.client_name || "Cliente", phone: client?.phone, identification_number: client?.identification_number, address: client?.address, email: client?.email };
    await generateInvoicePDF(invoice, clientData);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid': return <Badge className="bg-green-500"><CheckCircle className="h-3 w-3 mr-1" />Pagado</Badge>;
      case 'pending': return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Pendiente</Badge>;
      case 'overdue': return <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />Vencido</Badge>;
      case 'cancelled': return <Badge variant="outline"><XCircle className="h-3 w-3 mr-1" />Cancelado</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (!mikrotikId) return (<Card><CardContent className="py-8 text-center text-muted-foreground">Selecciona un dispositivo MikroTik</CardContent></Card>);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2"><Receipt className="h-5 w-5" />Facturas</CardTitle>
            <Button onClick={() => setCreateInvoiceDialogOpen(true)}><FilePlus className="h-4 w-4 mr-2" />Crear Factura</Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Número</TableHead><TableHead>Periodo</TableHead><TableHead>Vencimiento</TableHead><TableHead>Monto</TableHead><TableHead>Estado</TableHead><TableHead>Pagado el</TableHead><TableHead>Acciones</TableHead></TableRow></TableHeader>
            <TableBody>
              {invoices?.map((invoice: any) => {
                const client = ispClients?.find((c: any) => c.id === invoice.client_id);
                return (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-mono">{invoice.invoice_number}</TableCell>
                    <TableCell>{format(parseISO(invoice.billing_period_start), 'dd MMM', { locale: es })} - {format(parseISO(invoice.billing_period_end), 'dd MMM yyyy', { locale: es })}</TableCell>
                    <TableCell>{format(parseISO(invoice.due_date), 'dd/MM/yyyy')}</TableCell>
                    <TableCell>${invoice.amount.toLocaleString()}</TableCell>
                    <TableCell>{getStatusBadge(invoice.status)}</TableCell>
                    <TableCell>{invoice.paid_at ? `${format(parseISO(invoice.paid_at), 'dd/MM/yyyy')} via ${invoice.paid_via || 'N/A'}` : '-'}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        <Button size="sm" variant="outline" onClick={() => openTelegramDialog(invoice)} disabled={!telegramConfig?.is_active} title="Telegram"><Send className="h-4 w-4" /></Button>
                        <Button size="sm" variant="outline" onClick={() => handleSendWhatsApp(invoice)} disabled={!whatsappConfig?.is_active || !client?.phone} title="WhatsApp"><MessageCircle className="h-4 w-4" /></Button>
                        <Button size="sm" variant="outline" onClick={() => handleDownloadPDF(invoice)} title="PDF"><Download className="h-4 w-4" /></Button>
                        <Button size="sm" variant="outline" className="text-destructive" onClick={() => { if (confirm(`¿Eliminar factura ${invoice.invoice_number}?`)) deleteInvoiceMutation.mutate(invoice.id); }} title="Eliminar"><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {(!invoices || invoices.length === 0) && (<TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No hay facturas generadas</TableCell></TableRow>)}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Telegram Dialog */}
      <Dialog open={telegramDialogOpen} onOpenChange={setTelegramDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Send className="h-5 w-5 text-blue-500" />Enviar por Telegram</DialogTitle><DialogDescription>Factura: {selectedInvoice?.invoice_number}</DialogDescription></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label>Chat ID</Label><Input value={telegramChatId} onChange={(e) => setTelegramChatId(e.target.value)} placeholder="123456789" /></div>
            <div className="space-y-2"><Label>Mensaje</Label><Textarea value={telegramMessage} onChange={(e) => setTelegramMessage(e.target.value)} rows={6} /></div>
            <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={handleSendTelegram} disabled={sendTelegramMutation.isPending}>
              {sendTelegramMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}Enviar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <CreateInvoiceDialog mikrotikId={mikrotikId || ""}
        clients={ispClients?.map((c: any) => ({ id: c.id, client_name: c.client_name, username: c.username || c.client_name, total_monthly_price: c.total_monthly_price || null, service_price: c.service_price || null })) || []} />
    </div>
  );
}

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
