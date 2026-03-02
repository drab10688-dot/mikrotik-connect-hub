import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { clientsApi, invoicesApi, billingApi, messagingApi, addressListApi } from "@/lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CreditCard, DollarSign, Search, Plus, CheckCircle, Clock, AlertTriangle, Banknote, Building2, Smartphone, Receipt, User, CalendarIcon, Filter, Download, History, Loader2, FileText, Ban, ArrowUpDown, Eye, RefreshCw, Send, Printer, MessageCircle } from "lucide-react";
import { format, parseISO, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { es } from "date-fns/locale";
import { getSuspensionAddressList } from "@/components/isp/contracts/ContractTermsEditor";
import { downloadPaymentReceipt } from "./PaymentReceiptPDF";

interface PaymentRecorderProps { mikrotikId: string | null; }
interface Client { id: string; client_name: string; username: string; phone: string | null; email: string | null; identification_number: string | null; assigned_ip: string | null; plan_or_speed: string | null; total_monthly_price: number | null; }
interface Invoice { id: string; invoice_number: string; amount: number; due_date: string; status: string; paid_at: string | null; paid_via: string | null; payment_reference: string | null; billing_period_start: string; billing_period_end: string; client_id: string | null; }
interface BillingSettings { id: string; client_id: string | null; is_suspended: boolean; monthly_amount: number; last_payment_date: string | null; next_billing_date: string | null; }

const PAYMENT_METHODS = [
  { value: "efectivo", label: "Efectivo", icon: Banknote },
  { value: "transferencia", label: "Transferencia Bancaria", icon: Building2 },
  { value: "nequi", label: "Nequi", icon: Smartphone },
  { value: "daviplata", label: "Daviplata", icon: Smartphone },
  { value: "pse", label: "PSE", icon: CreditCard },
  { value: "tarjeta", label: "Tarjeta Crédito/Débito", icon: CreditCard },
  { value: "otro", label: "Otro", icon: DollarSign },
];

export function PaymentRecorder({ mikrotikId }: PaymentRecorderProps) {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("efectivo");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState<Date>(new Date());
  const [paymentNotes, setPaymentNotes] = useState("");
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [reactivatingSuspended, setReactivatingSuspended] = useState(false);
  const [historyStartDate, setHistoryStartDate] = useState<Date>(startOfMonth(subMonths(new Date(), 2)));
  const [historyEndDate, setHistoryEndDate] = useState<Date>(endOfMonth(new Date()));
  const [historyMethodFilter, setHistoryMethodFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("register");

  const { data: clients, isLoading: loadingClients } = useQuery({
    queryKey: ["isp-clients-payments", mikrotikId],
    queryFn: async () => { if (!mikrotikId) return []; return clientsApi.list(mikrotikId); },
    enabled: !!mikrotikId,
  });

  const { data: billingSettings } = useQuery({
    queryKey: ["billing-settings-all", mikrotikId],
    queryFn: async () => { if (!mikrotikId) return []; return billingApi.listSettings(mikrotikId); },
    enabled: !!mikrotikId,
  });

  const { data: pendingInvoices } = useQuery({
    queryKey: ["pending-invoices", mikrotikId],
    queryFn: async () => { if (!mikrotikId) return []; return invoicesApi.list(mikrotikId, { status: ['pending', 'overdue'] }); },
    enabled: !!mikrotikId,
  });

  const { data: paymentHistory, isLoading: loadingHistory } = useQuery({
    queryKey: ["payment-history", mikrotikId, historyStartDate, historyEndDate],
    queryFn: async () => {
      if (!mikrotikId) return [];
      return invoicesApi.paidHistory(mikrotikId, format(historyStartDate, "yyyy-MM-dd"), format(historyEndDate, "yyyy-MM-dd"));
    },
    enabled: !!mikrotikId,
  });

  const { data: whatsappConfig } = useQuery({
    queryKey: ["whatsapp-config", mikrotikId],
    queryFn: async () => { if (!mikrotikId) return null; return messagingApi.getWhatsappConfig(mikrotikId); },
    enabled: !!mikrotikId,
  });

  const { data: telegramConfig } = useQuery({
    queryKey: ["telegram-config", mikrotikId],
    queryFn: async () => { if (!mikrotikId) return null; return messagingApi.getTelegramConfig(mikrotikId); },
    enabled: !!mikrotikId,
  });

  const registerPaymentMutation = useMutation({
    mutationFn: async ({ invoiceId, clientId, amount, method, reference, paidAt }: { invoiceId: string; clientId: string; amount: number; method: string; reference: string; paidAt: Date }) => {
      await invoicesApi.markPaid(invoiceId, {
        paid_at: paidAt.toISOString(),
        paid_via: method,
        payment_reference: reference || null,
        amount,
      });
      return { invoiceId, clientId, amount, method, reference, paidAt };
    },
    onSuccess: async (data) => {
      toast.success("Pago registrado correctamente");

      // Check if client was suspended and reactivate
      const clientBilling = billingSettings?.find((b: BillingSettings) => b.client_id === data.clientId);
      if (clientBilling?.is_suspended && selectedClient?.assigned_ip && mikrotikId) {
        setReactivatingSuspended(true);
        try {
          const listName = getSuspensionAddressList();
          await addressListApi.toggleSuspension(mikrotikId, {
            action: "remove",
            address: selectedClient.assigned_ip,
            clientId: data.clientId,
            listName,
          });
          toast.success("Cliente reactivado automáticamente tras el pago");
        } catch (error) {
          console.error("Error reactivating client:", error);
          toast.error("Pago registrado pero error al reactivar");
        } finally {
          setReactivatingSuspended(false);
        }
      }

      // Generate receipt
      if (selectedClient && selectedInvoice) {
        const receiptNumber = `REC-${format(new Date(), "yyyyMMdd")}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        await downloadPaymentReceipt({
          receiptNumber, clientName: selectedClient.client_name, clientId: selectedClient.identification_number || "",
          username: selectedClient.username, phone: selectedClient.phone, email: selectedClient.email,
          invoiceNumber: selectedInvoice.invoice_number, invoiceAmount: selectedInvoice.amount, paidAmount: data.amount,
          paymentMethod: data.method, paymentReference: data.reference || null, paymentDate: data.paidAt,
          billingPeriodStart: selectedInvoice.billing_period_start, billingPeriodEnd: selectedInvoice.billing_period_end,
          planOrSpeed: selectedClient.plan_or_speed,
        });
      }

      queryClient.invalidateQueries({ queryKey: ["pending-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["payment-history"] });
      queryClient.invalidateQueries({ queryKey: ["billing-settings-all"] });
      queryClient.invalidateQueries({ queryKey: ["client-invoices"] });
      resetPaymentForm();
    },
    onError: (error: any) => { toast.error(`Error: ${error.message}`); },
  });

  const filteredClients = useMemo(() => {
    if (!clients) return [];
    if (!searchTerm) return clients;
    const term = searchTerm.toLowerCase();
    return clients.filter((c: Client) => c.client_name.toLowerCase().includes(term) || c.username.toLowerCase().includes(term) || c.identification_number?.toLowerCase().includes(term) || c.phone?.includes(term));
  }, [clients, searchTerm]);

  const clientInvoices = useMemo(() => {
    if (!selectedClient || !pendingInvoices) return [];
    return pendingInvoices.filter((i: Invoice) => i.client_id === selectedClient.id);
  }, [selectedClient, pendingInvoices]);

  const clientBilling = useMemo(() => {
    if (!selectedClient || !billingSettings) return null;
    return billingSettings.find((b: BillingSettings) => b.client_id === selectedClient.id);
  }, [selectedClient, billingSettings]);

  const filteredHistory = useMemo(() => {
    if (!paymentHistory) return [];
    if (historyMethodFilter === "all") return paymentHistory;
    return paymentHistory.filter((p: any) => p.paid_via === historyMethodFilter);
  }, [paymentHistory, historyMethodFilter]);

  const historyTotals = useMemo(() => {
    const total = filteredHistory.reduce((acc: number, p: any) => acc + Number(p.amount), 0);
    const byMethod: Record<string, number> = {};
    filteredHistory.forEach((p: any) => { const method = p.paid_via || "Otro"; byMethod[method] = (byMethod[method] || 0) + Number(p.amount); });
    return { total, byMethod };
  }, [filteredHistory]);

  const resetPaymentForm = () => { setPaymentDialogOpen(false); setSelectedInvoice(null); setPaymentMethod("efectivo"); setPaymentReference(""); setPaymentAmount(""); setPaymentDate(new Date()); setPaymentNotes(""); };
  const openPaymentDialog = (invoice: Invoice) => { setSelectedInvoice(invoice); setPaymentAmount(String(invoice.amount)); setPaymentDialogOpen(true); };

  const handleRegisterPayment = () => {
    if (!selectedInvoice || !selectedClient) return;
    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) { toast.error("Ingresa un monto válido"); return; }
    registerPaymentMutation.mutate({ invoiceId: selectedInvoice.id, clientId: selectedClient.id, amount, method: paymentMethod, reference: paymentReference, paidAt: paymentDate });
  };

  const getStatusBadge = (status: string) => {
    switch (status) { case "paid": return <Badge className="bg-green-500 hover:bg-green-600"><CheckCircle className="h-3 w-3 mr-1" />Pagado</Badge>; case "pending": return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Pendiente</Badge>; case "overdue": return <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />Vencido</Badge>; default: return <Badge variant="outline">{status}</Badge>; }
  };

  const getPaymentMethodLabel = (method: string | null) => {
    if (!method) return "N/A";
    return PAYMENT_METHODS.find(m => m.value === method)?.label || method;
  };

  const exportHistoryToCSV = () => {
    if (!filteredHistory.length) { toast.error("No hay datos"); return; }
    const headers = ["Fecha", "Cliente", "Factura", "Monto", "Método", "Referencia"];
    const rows = filteredHistory.map((p: any) => [format(parseISO(p.paid_at), "dd/MM/yyyy HH:mm"), p.isp_clients?.client_name || p.client_name || "N/A", p.invoice_number, p.amount, getPaymentMethodLabel(p.paid_via), p.payment_reference || "-"]);
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `pagos_${format(historyStartDate, "yyyy-MM-dd")}_${format(historyEndDate, "yyyy-MM-dd")}.csv`; link.click();
    toast.success("Exportado");
  };

  if (!mikrotikId) return (<Card><CardContent className="py-8 text-center text-muted-foreground">Selecciona un dispositivo MikroTik</CardContent></Card>);

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="register"><Receipt className="h-4 w-4 mr-2" />Registrar Pago</TabsTrigger><TabsTrigger value="history"><History className="h-4 w-4 mr-2" />Historial</TabsTrigger></TabsList>

        <TabsContent value="register" className="space-y-6">
          {/* Client search */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><User className="h-5 w-5" />Seleccionar Cliente</CardTitle></CardHeader>
            <CardContent>
              <div className="relative mb-4"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Buscar cliente..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" /></div>
              {loadingClients ? <div className="text-center py-4"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div> : (
                <ScrollArea className="h-[200px]">
                  <div className="divide-y">
                    {filteredClients.slice(0, 20).map((client: Client) => {
                      const billing = billingSettings?.find((b: BillingSettings) => b.client_id === client.id);
                      return (
                        <div key={client.id} className={cn("p-3 cursor-pointer hover:bg-muted/50 transition-colors", selectedClient?.id === client.id && "bg-primary/10 border-l-2 border-primary")} onClick={() => setSelectedClient(client)}>
                          <div className="flex items-center justify-between">
                            <div><p className="font-medium">{client.client_name}</p><p className="text-sm text-muted-foreground">{client.username}</p></div>
                            <div className="text-right">
                              {billing?.is_suspended && <Badge variant="destructive" className="text-xs"><Ban className="h-3 w-3 mr-1" />Suspendido</Badge>}
                              {client.total_monthly_price && <p className="text-sm font-medium">${client.total_monthly_price.toLocaleString()}/mes</p>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          {/* Pending invoices */}
          {selectedClient && (
            <Card>
              <CardHeader><CardTitle>Facturas Pendientes - {selectedClient.client_name}</CardTitle></CardHeader>
              <CardContent>
                {clientInvoices.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground"><CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" /><p>Sin facturas pendientes</p></div>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Factura</TableHead><TableHead>Periodo</TableHead><TableHead>Vencimiento</TableHead><TableHead>Monto</TableHead><TableHead>Estado</TableHead><TableHead>Acción</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {clientInvoices.map((invoice: Invoice) => (
                        <TableRow key={invoice.id}>
                          <TableCell className="font-mono">{invoice.invoice_number}</TableCell>
                          <TableCell>{format(parseISO(invoice.billing_period_start), 'dd MMM', { locale: es })} - {format(parseISO(invoice.billing_period_end), 'dd MMM', { locale: es })}</TableCell>
                          <TableCell>{format(parseISO(invoice.due_date), 'dd/MM/yyyy')}</TableCell>
                          <TableCell className="font-medium">${invoice.amount.toLocaleString()}</TableCell>
                          <TableCell>{getStatusBadge(invoice.status)}</TableCell>
                          <TableCell><Button size="sm" onClick={() => openPaymentDialog(invoice)}><DollarSign className="h-4 w-4 mr-1" />Pagar</Button></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <CardTitle className="flex items-center gap-2"><History className="h-5 w-5" />Historial de Pagos</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={exportHistoryToCSV}><Download className="h-4 w-4 mr-2" />CSV</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2 mb-4">
                <Popover><PopoverTrigger asChild><Button variant="outline" size="sm"><CalendarIcon className="h-4 w-4 mr-2" />{format(historyStartDate, "dd/MM/yyyy")}</Button></PopoverTrigger>
                  <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={historyStartDate} onSelect={(d) => d && setHistoryStartDate(d)} locale={es} /></PopoverContent>
                </Popover>
                <span className="self-center text-muted-foreground">a</span>
                <Popover><PopoverTrigger asChild><Button variant="outline" size="sm"><CalendarIcon className="h-4 w-4 mr-2" />{format(historyEndDate, "dd/MM/yyyy")}</Button></PopoverTrigger>
                  <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={historyEndDate} onSelect={(d) => d && setHistoryEndDate(d)} locale={es} /></PopoverContent>
                </Popover>
                <Select value={historyMethodFilter} onValueChange={setHistoryMethodFilter}><SelectTrigger className="w-[180px]"><SelectValue placeholder="Método" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">Todos</SelectItem>{PAYMENT_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>

              <div className="p-3 bg-muted/50 rounded-lg mb-4 flex flex-wrap gap-4">
                <div><span className="text-sm text-muted-foreground">Total:</span><span className="ml-2 font-bold text-lg">${historyTotals.total.toLocaleString()}</span></div>
                {Object.entries(historyTotals.byMethod).map(([method, amount]) => (
                  <div key={method}><span className="text-sm text-muted-foreground">{getPaymentMethodLabel(method)}:</span><span className="ml-1 font-medium">${(amount as number).toLocaleString()}</span></div>
                ))}
              </div>

              {loadingHistory ? <div className="text-center py-8"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Cliente</TableHead><TableHead>Factura</TableHead><TableHead>Monto</TableHead><TableHead>Método</TableHead><TableHead>Referencia</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {filteredHistory.map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell>{format(parseISO(p.paid_at), "dd/MM/yyyy HH:mm")}</TableCell>
                        <TableCell>{p.isp_clients?.client_name || p.client_name || "N/A"}</TableCell>
                        <TableCell className="font-mono">{p.invoice_number}</TableCell>
                        <TableCell className="font-medium">${Number(p.amount).toLocaleString()}</TableCell>
                        <TableCell>{getPaymentMethodLabel(p.paid_via)}</TableCell>
                        <TableCell>{p.payment_reference || "-"}</TableCell>
                      </TableRow>
                    ))}
                    {filteredHistory.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No hay pagos en este periodo</TableCell></TableRow>}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Payment Dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={(open) => !open && resetPaymentForm()}>
        <DialogContent>
          <DialogHeader><DialogTitle>Registrar Pago</DialogTitle><DialogDescription>Factura: {selectedInvoice?.invoice_number} - ${selectedInvoice?.amount.toLocaleString()}</DialogDescription></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label>Método de Pago</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PAYMENT_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Monto</Label><Input type="number" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} /></div>
            <div className="space-y-2"><Label>Referencia (opcional)</Label><Input value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} placeholder="Número de transacción" /></div>
            <div className="space-y-2"><Label>Fecha de Pago</Label>
              <Popover><PopoverTrigger asChild><Button variant="outline" className="w-full justify-start"><CalendarIcon className="mr-2 h-4 w-4" />{format(paymentDate, "dd/MM/yyyy", { locale: es })}</Button></PopoverTrigger>
                <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={paymentDate} onSelect={(d) => d && setPaymentDate(d)} locale={es} /></PopoverContent>
              </Popover>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetPaymentForm}>Cancelar</Button>
            <Button onClick={handleRegisterPayment} disabled={registerPaymentMutation.isPending || reactivatingSuspended}>
              {(registerPaymentMutation.isPending || reactivatingSuspended) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
              Registrar Pago
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
