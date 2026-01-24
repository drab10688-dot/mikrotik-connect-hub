import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
import {
  CreditCard,
  DollarSign,
  Search,
  Plus,
  CheckCircle,
  Clock,
  AlertTriangle,
  Banknote,
  Building2,
  Smartphone,
  Receipt,
  User,
  CalendarIcon,
  Filter,
  Download,
  History,
  Loader2,
  FileText,
  Ban,
  ArrowUpDown,
  Eye,
  RefreshCw,
  FilePlus,
} from "lucide-react";
import { format, parseISO, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { es } from "date-fns/locale";
import { getSuspensionAddressList } from "@/components/isp/contracts/ContractTermsEditor";
import { CreateInvoiceDialog } from "./CreateInvoiceDialog";

interface PaymentRecorderProps {
  mikrotikId: string | null;
}

interface Client {
  id: string;
  client_name: string;
  username: string;
  phone: string | null;
  email: string | null;
  identification_number: string | null;
  assigned_ip: string | null;
  plan_or_speed: string | null;
  total_monthly_price: number | null;
}

interface Invoice {
  id: string;
  invoice_number: string;
  amount: number;
  due_date: string;
  status: string;
  paid_at: string | null;
  paid_via: string | null;
  payment_reference: string | null;
  billing_period_start: string;
  billing_period_end: string;
  client_id: string | null;
}

interface BillingSettings {
  id: string;
  client_id: string | null;
  is_suspended: boolean;
  monthly_amount: number;
  last_payment_date: string | null;
  next_billing_date: string | null;
}

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
  const [createInvoiceDialogOpen, setCreateInvoiceDialogOpen] = useState(false);
  
  // Date filters for history
  const [historyStartDate, setHistoryStartDate] = useState<Date>(startOfMonth(subMonths(new Date(), 2)));
  const [historyEndDate, setHistoryEndDate] = useState<Date>(endOfMonth(new Date()));
  const [historyMethodFilter, setHistoryMethodFilter] = useState<string>("all");
  
  // Tab state
  const [activeTab, setActiveTab] = useState("register");

  // Fetch all clients
  const { data: clients, isLoading: loadingClients } = useQuery({
    queryKey: ["isp-clients-payments", mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      const { data, error } = await supabase
        .from("isp_clients")
        .select("id, client_name, username, phone, email, identification_number, assigned_ip, plan_or_speed, total_monthly_price")
        .eq("mikrotik_id", mikrotikId)
        .order("client_name");
      if (error) throw error;
      return data as Client[];
    },
    enabled: !!mikrotikId,
  });

  // Fetch billing settings
  const { data: billingSettings } = useQuery({
    queryKey: ["billing-settings-all", mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      const { data, error } = await supabase
        .from("client_billing_settings")
        .select("*")
        .eq("mikrotik_id", mikrotikId);
      if (error) throw error;
      return data as BillingSettings[];
    },
    enabled: !!mikrotikId,
  });

  // Fetch pending invoices
  const { data: pendingInvoices } = useQuery({
    queryKey: ["pending-invoices", mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      const { data, error } = await supabase
        .from("client_invoices")
        .select("*")
        .eq("mikrotik_id", mikrotikId)
        .in("status", ["pending", "overdue"])
        .order("due_date", { ascending: true });
      if (error) throw error;
      return data as Invoice[];
    },
    enabled: !!mikrotikId,
  });

  // Fetch payment history
  const { data: paymentHistory, isLoading: loadingHistory } = useQuery({
    queryKey: ["payment-history", mikrotikId, historyStartDate, historyEndDate],
    queryFn: async () => {
      if (!mikrotikId) return [];
      const { data, error } = await supabase
        .from("client_invoices")
        .select("*, isp_clients!client_invoices_client_id_fkey(client_name, username)")
        .eq("mikrotik_id", mikrotikId)
        .eq("status", "paid")
        .gte("paid_at", format(historyStartDate, "yyyy-MM-dd"))
        .lte("paid_at", format(historyEndDate, "yyyy-MM-dd") + "T23:59:59")
        .order("paid_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!mikrotikId,
  });

  // Register payment mutation
  const registerPaymentMutation = useMutation({
    mutationFn: async ({
      invoiceId,
      clientId,
      amount,
      method,
      reference,
      paidAt,
    }: {
      invoiceId: string;
      clientId: string;
      amount: number;
      method: string;
      reference: string;
      paidAt: Date;
    }) => {
      // Update invoice
      const { error: invoiceError } = await supabase
        .from("client_invoices")
        .update({
          status: "paid",
          paid_at: paidAt.toISOString(),
          paid_via: method,
          payment_reference: reference || null,
        })
        .eq("id", invoiceId);

      if (invoiceError) throw invoiceError;

      // Update billing settings - update last_payment_date
      const { error: billingError } = await supabase
        .from("client_billing_settings")
        .update({
          last_payment_date: format(paidAt, "yyyy-MM-dd"),
        })
        .eq("client_id", clientId);

      // Don't throw if billing update fails (settings might not exist)
      if (billingError) console.warn("No billing settings to update:", billingError);

      return { invoiceId, clientId };
    },
    onSuccess: async (data) => {
      toast.success("Pago registrado correctamente");
      
      // Check if client was suspended and should be reactivated
      const clientBilling = billingSettings?.find((b) => b.client_id === data.clientId);
      if (clientBilling?.is_suspended && selectedClient?.assigned_ip) {
        setReactivatingSuspended(true);
        try {
          const listName = getSuspensionAddressList();
          await supabase.functions.invoke("mikrotik-address-list", {
            body: {
              mikrotikId,
              action: "remove",
              address: selectedClient.assigned_ip,
              listName,
              clientId: data.clientId,
            },
          });
          
          // Update billing settings to remove suspension
          await supabase
            .from("client_billing_settings")
            .update({ is_suspended: false, suspended_at: null })
            .eq("client_id", data.clientId);
            
          toast.success("Cliente reactivado automáticamente tras el pago");
        } catch (error) {
          console.error("Error reactivating client:", error);
          toast.error("El pago se registró pero hubo un error al reactivar el cliente");
        } finally {
          setReactivatingSuspended(false);
        }
      }
      
      queryClient.invalidateQueries({ queryKey: ["pending-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["payment-history"] });
      queryClient.invalidateQueries({ queryKey: ["billing-settings-all"] });
      queryClient.invalidateQueries({ queryKey: ["client-invoices"] });
      
      resetPaymentForm();
    },
    onError: (error: any) => {
      toast.error(`Error al registrar pago: ${error.message}`);
    },
  });

  // Filter clients by search
  const filteredClients = useMemo(() => {
    if (!clients) return [];
    if (!searchTerm) return clients;
    const term = searchTerm.toLowerCase();
    return clients.filter(
      (c) =>
        c.client_name.toLowerCase().includes(term) ||
        c.username.toLowerCase().includes(term) ||
        c.identification_number?.toLowerCase().includes(term) ||
        c.phone?.includes(term)
    );
  }, [clients, searchTerm]);

  // Get invoices for selected client
  const clientInvoices = useMemo(() => {
    if (!selectedClient || !pendingInvoices) return [];
    return pendingInvoices.filter((i) => i.client_id === selectedClient.id);
  }, [selectedClient, pendingInvoices]);

  // Get billing info for selected client
  const clientBilling = useMemo(() => {
    if (!selectedClient || !billingSettings) return null;
    return billingSettings.find((b) => b.client_id === selectedClient.id);
  }, [selectedClient, billingSettings]);

  // Filtered history
  const filteredHistory = useMemo(() => {
    if (!paymentHistory) return [];
    if (historyMethodFilter === "all") return paymentHistory;
    return paymentHistory.filter((p: any) => p.paid_via === historyMethodFilter);
  }, [paymentHistory, historyMethodFilter]);

  // Calculate totals for history
  const historyTotals = useMemo(() => {
    const total = filteredHistory.reduce((acc: number, p: any) => acc + Number(p.amount), 0);
    const byMethod: Record<string, number> = {};
    filteredHistory.forEach((p: any) => {
      const method = p.paid_via || "Otro";
      byMethod[method] = (byMethod[method] || 0) + Number(p.amount);
    });
    return { total, byMethod };
  }, [filteredHistory]);

  const resetPaymentForm = () => {
    setPaymentDialogOpen(false);
    setSelectedInvoice(null);
    setPaymentMethod("efectivo");
    setPaymentReference("");
    setPaymentAmount("");
    setPaymentDate(new Date());
    setPaymentNotes("");
  };

  const openPaymentDialog = (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setPaymentAmount(String(invoice.amount));
    setPaymentDialogOpen(true);
  };

  const handleRegisterPayment = () => {
    if (!selectedInvoice || !selectedClient) return;
    
    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error("Ingresa un monto válido");
      return;
    }

    registerPaymentMutation.mutate({
      invoiceId: selectedInvoice.id,
      clientId: selectedClient.id,
      amount,
      method: paymentMethod,
      reference: paymentReference,
      paidAt: paymentDate,
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "paid":
        return <Badge className="bg-green-500 hover:bg-green-600"><CheckCircle className="h-3 w-3 mr-1" />Pagado</Badge>;
      case "pending":
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Pendiente</Badge>;
      case "overdue":
        return <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />Vencido</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getPaymentMethodLabel = (method: string | null) => {
    if (!method) return "N/A";
    const found = PAYMENT_METHODS.find((m) => m.value === method);
    return found ? found.label : method;
  };

  // Export history to CSV
  const exportHistoryToCSV = () => {
    if (!filteredHistory.length) {
      toast.error("No hay datos para exportar");
      return;
    }

    const headers = ["Fecha", "Cliente", "Usuario", "Factura", "Monto", "Método", "Referencia"];
    const rows = filteredHistory.map((p: any) => [
      format(parseISO(p.paid_at), "dd/MM/yyyy HH:mm"),
      p.isp_clients?.client_name || "N/A",
      p.isp_clients?.username || "N/A",
      p.invoice_number,
      p.amount,
      getPaymentMethodLabel(p.paid_via),
      p.payment_reference || "-",
    ]);

    const csvContent = [
      `Historial de Pagos - ${format(historyStartDate, "dd/MM/yyyy")} a ${format(historyEndDate, "dd/MM/yyyy")}`,
      "",
      `Total Recaudado: $${historyTotals.total.toLocaleString()}`,
      "",
      headers.join(","),
      ...rows.map((row) => row.join(",")),
    ].join("\n");

    const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pagos_${format(historyStartDate, "yyyy-MM-dd")}_${format(historyEndDate, "yyyy-MM-dd")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Historial exportado");
  };

  if (!mikrotikId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Selecciona un dispositivo MikroTik para registrar pagos
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Create Invoice Button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Gestión de Pagos</h2>
          <p className="text-muted-foreground">
            Registra pagos y crea facturas para tus clientes
          </p>
        </div>
        <Button onClick={() => setCreateInvoiceDialogOpen(true)}>
          <FilePlus className="h-4 w-4 mr-2" />
          Crear Factura
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 md:w-[400px]">
          <TabsTrigger value="register" className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Registrar Pago
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Historial
          </TabsTrigger>
        </TabsList>

        {/* Register Payment Tab */}
        <TabsContent value="register" className="space-y-4">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Client Search Panel */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Buscar Cliente
                </CardTitle>
                <CardDescription>
                  Busca por nombre, usuario, cédula o teléfono
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar cliente..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9"
                  />
                </div>

                <ScrollArea className="h-[400px] border rounded-md">
                  {loadingClients ? (
                    <div className="p-4 text-center">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                    </div>
                  ) : filteredClients.length === 0 ? (
                    <div className="p-4 text-center text-muted-foreground">
                      No se encontraron clientes
                    </div>
                  ) : (
                    <div className="divide-y">
                      {filteredClients.map((client) => {
                        const billing = billingSettings?.find((b) => b.client_id === client.id);
                        const hasPending = pendingInvoices?.some((i) => i.client_id === client.id);
                        
                        return (
                          <div
                            key={client.id}
                            className={cn(
                              "p-3 cursor-pointer hover:bg-muted/50 transition-colors",
                              selectedClient?.id === client.id && "bg-primary/10"
                            )}
                            onClick={() => setSelectedClient(client)}
                          >
                            <div className="flex items-start justify-between">
                              <div>
                                <p className="font-medium">{client.client_name}</p>
                                <p className="text-sm text-muted-foreground">{client.username}</p>
                                {client.identification_number && (
                                  <p className="text-xs text-muted-foreground">CC: {client.identification_number}</p>
                                )}
                              </div>
                              <div className="flex flex-col items-end gap-1">
                                {billing?.is_suspended && (
                                  <Badge variant="destructive" className="text-xs">
                                    <Ban className="h-3 w-3 mr-1" />
                                    Suspendido
                                  </Badge>
                                )}
                                {hasPending && (
                                  <Badge variant="outline" className="text-xs">
                                    <Clock className="h-3 w-3 mr-1" />
                                    Pendiente
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Client Info & Invoices Panel */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Receipt className="h-5 w-5" />
                  {selectedClient ? selectedClient.client_name : "Seleccionar Cliente"}
                </CardTitle>
                {selectedClient && (
                  <CardDescription>
                    {selectedClient.plan_or_speed && `Plan: ${selectedClient.plan_or_speed} • `}
                    {selectedClient.total_monthly_price && `$${selectedClient.total_monthly_price.toLocaleString()}/mes`}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                {!selectedClient ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <User className="h-12 w-12 mx-auto mb-4 opacity-30" />
                    <p>Selecciona un cliente para ver sus facturas pendientes</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Client Status Info */}
                    <div className="flex flex-wrap gap-2">
                      {clientBilling?.is_suspended && (
                        <Badge variant="destructive">
                          <Ban className="h-3 w-3 mr-1" />
                          Servicio Suspendido
                        </Badge>
                      )}
                      {clientBilling?.last_payment_date && (
                        <Badge variant="outline">
                          Último pago: {format(parseISO(clientBilling.last_payment_date), "dd/MM/yyyy")}
                        </Badge>
                      )}
                    </div>

                    {/* Pending Invoices */}
                    <div className="space-y-2">
                      <h4 className="font-medium text-sm">Facturas Pendientes</h4>
                      {clientInvoices.length === 0 ? (
                        <div className="text-center py-4 text-muted-foreground border rounded-md">
                          <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
                          <p className="text-sm">Sin facturas pendientes</p>
                        </div>
                      ) : (
                        <ScrollArea className="h-[280px]">
                          <div className="space-y-2">
                            {clientInvoices.map((invoice) => (
                              <div
                                key={invoice.id}
                                className="p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                              >
                                <div className="flex items-center justify-between mb-2">
                                  <span className="font-mono text-sm">{invoice.invoice_number}</span>
                                  {getStatusBadge(invoice.status)}
                                </div>
                                <div className="flex items-center justify-between text-sm text-muted-foreground mb-3">
                                  <span>
                                    {format(parseISO(invoice.billing_period_start), "dd MMM", { locale: es })} - {format(parseISO(invoice.billing_period_end), "dd MMM yyyy", { locale: es })}
                                  </span>
                                  <span>Vence: {format(parseISO(invoice.due_date), "dd/MM/yyyy")}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-lg font-bold">${invoice.amount.toLocaleString()}</span>
                                  <Button size="sm" onClick={() => openPaymentDialog(invoice)}>
                                    <DollarSign className="h-4 w-4 mr-1" />
                                    Registrar Pago
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Quick Stats */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-yellow-500/10">
                    <Clock className="h-5 w-5 text-yellow-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Facturas Pendientes</p>
                    <p className="text-xl font-bold">
                      {pendingInvoices?.filter((i) => i.status === "pending").length || 0}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-red-500/10">
                    <AlertTriangle className="h-5 w-5 text-red-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Facturas Vencidas</p>
                    <p className="text-xl font-bold">
                      {pendingInvoices?.filter((i) => i.status === "overdue").length || 0}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-orange-500/10">
                    <Ban className="h-5 w-5 text-orange-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Clientes Suspendidos</p>
                    <p className="text-xl font-bold">
                      {billingSettings?.filter((b) => b.is_suspended).length || 0}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <DollarSign className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Por Cobrar</p>
                    <p className="text-xl font-bold">
                      ${pendingInvoices?.reduce((acc, i) => acc + Number(i.amount), 0).toLocaleString() || 0}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <History className="h-5 w-5" />
                    Historial de Pagos Registrados
                  </CardTitle>
                  <CardDescription>
                    Pagos registrados manualmente y automáticos
                  </CardDescription>
                </div>
                <Button variant="outline" onClick={exportHistoryToCSV} disabled={!filteredHistory.length}>
                  <Download className="h-4 w-4 mr-2" />
                  Exportar CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {/* Filters */}
              <div className="flex flex-wrap gap-4 mb-6">
                <div className="flex items-center gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm">
                        <CalendarIcon className="h-4 w-4 mr-2" />
                        {format(historyStartDate, "dd/MM/yy")} - {format(historyEndDate, "dd/MM/yy")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <div className="flex">
                        <div className="border-r p-3">
                          <p className="text-sm font-medium mb-2">Desde</p>
                          <Calendar
                            mode="single"
                            selected={historyStartDate}
                            onSelect={(date) => date && setHistoryStartDate(date)}
                            className="pointer-events-auto"
                          />
                        </div>
                        <div className="p-3">
                          <p className="text-sm font-medium mb-2">Hasta</p>
                          <Calendar
                            mode="single"
                            selected={historyEndDate}
                            onSelect={(date) => date && setHistoryEndDate(date)}
                            className="pointer-events-auto"
                          />
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>

                <Select value={historyMethodFilter} onValueChange={setHistoryMethodFilter}>
                  <SelectTrigger className="w-[180px]">
                    <Filter className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Método de pago" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los métodos</SelectItem>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="ml-auto flex items-center gap-4">
                  <Badge variant="secondary" className="text-lg px-4 py-2">
                    Total: ${historyTotals.total.toLocaleString()}
                  </Badge>
                </div>
              </div>

              {/* Summary by method */}
              {Object.keys(historyTotals.byMethod).length > 0 && (
                <div className="flex flex-wrap gap-2 mb-4">
                  {Object.entries(historyTotals.byMethod).map(([method, amount]) => (
                    <Badge key={method} variant="outline">
                      {getPaymentMethodLabel(method)}: ${(amount as number).toLocaleString()}
                    </Badge>
                  ))}
                </div>
              )}

              {/* History Table */}
              {loadingHistory ? (
                <div className="text-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto" />
                </div>
              ) : filteredHistory.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-4 opacity-30" />
                  <p>No hay pagos registrados en este período</p>
                </div>
              ) : (
                <ScrollArea className="h-[500px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead>Factura</TableHead>
                        <TableHead>Monto</TableHead>
                        <TableHead>Método</TableHead>
                        <TableHead>Referencia</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredHistory.map((payment: any) => (
                        <TableRow key={payment.id}>
                          <TableCell>
                            {format(parseISO(payment.paid_at), "dd/MM/yyyy HH:mm")}
                          </TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium">{payment.isp_clients?.client_name || "N/A"}</p>
                              <p className="text-xs text-muted-foreground">{payment.isp_clients?.username || ""}</p>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-sm">{payment.invoice_number}</TableCell>
                          <TableCell className="font-semibold">${Number(payment.amount).toLocaleString()}</TableCell>
                          <TableCell>{getPaymentMethodLabel(payment.paid_via)}</TableCell>
                          <TableCell className="text-muted-foreground">{payment.payment_reference || "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Payment Dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Registrar Pago
            </DialogTitle>
            <DialogDescription>
              {selectedClient?.client_name} - Factura {selectedInvoice?.invoice_number}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Monto a Pagar</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="number"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="pl-9 text-lg font-semibold"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Método de Pago</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((method) => {
                    const Icon = method.icon;
                    return (
                      <SelectItem key={method.value} value={method.value}>
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4" />
                          {method.label}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Fecha de Pago</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start">
                    <CalendarIcon className="h-4 w-4 mr-2" />
                    {format(paymentDate, "dd/MM/yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={paymentDate}
                    onSelect={(date) => date && setPaymentDate(date)}
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label>Referencia / Comprobante (opcional)</Label>
              <Input
                placeholder="Ej: Transferencia #12345"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
              />
            </div>

            {clientBilling?.is_suspended && (
              <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                <div className="flex items-center gap-2 text-green-600">
                  <RefreshCw className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    El cliente será reactivado automáticamente al registrar este pago
                  </span>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={resetPaymentForm}>
              Cancelar
            </Button>
            <Button
              onClick={handleRegisterPayment}
              disabled={registerPaymentMutation.isPending || reactivatingSuspended}
            >
              {(registerPaymentMutation.isPending || reactivatingSuspended) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              <CheckCircle className="h-4 w-4 mr-2" />
              Confirmar Pago
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Invoice Dialog */}
      <CreateInvoiceDialog
        open={createInvoiceDialogOpen}
        onOpenChange={setCreateInvoiceDialogOpen}
        mikrotikId={mikrotikId || ""}
        clients={clients || []}
        loadingClients={loadingClients}
      />
    </div>
  );
}
