import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Search, CreditCard, Receipt, CheckCircle, AlertTriangle, Loader2, Calendar, DollarSign, Building2, ExternalLink, Smartphone } from "lucide-react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ClientInfo {
  id: string;
  client_name: string;
  username: string;
  plan_or_speed: string | null;
  connection_type: string;
  mikrotik_id: string;
}

interface Invoice {
  id: string;
  invoice_number: string;
  amount: number;
  due_date: string;
  status: string;
  billing_period_start: string;
  billing_period_end: string;
  paid_at: string | null;
}

interface BillingSetting {
  monthly_amount: number;
  billing_day: number;
  is_suspended: boolean;
}

interface PaymentPlatform {
  platform: string;
  is_active: boolean;
  public_key: string;
  environment: string;
}

export default function ClientPaymentPortal() {
  const [searchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchType, setSearchType] = useState<'identification' | 'contract'>('identification');
  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null);
  const [billingSetting, setBillingSetting] = useState<BillingSetting | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [platforms, setPlatforms] = useState<PaymentPlatform[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [nequiDialogOpen, setNequiDialogOpen] = useState(false);
  const [nequiPhone, setNequiPhone] = useState("");
  const [nequiPendingInvoice, setNequiPendingInvoice] = useState<Invoice | null>(null);
  const [nequiPolling, setNequiPolling] = useState(false);
  const [nequiTransactionId, setNequiTransactionId] = useState<string | null>(null);
  const [nequiReference, setNequiReference] = useState<string | null>(null);
  const [nequiStatus, setNequiStatus] = useState<string | null>(null);

  // Auto-search if contract parameter is present in URL
  useEffect(() => {
    const contractParam = searchParams.get('contract');
    if (contractParam) {
      setSearchQuery(contractParam);
      // Trigger search after setting the query
      setTimeout(() => {
        handleSearchWithQuery(contractParam);
      }, 100);
    }
  }, [searchParams]);

  const handleSearchWithQuery = async (query: string) => {
    if (!query.trim()) {
      toast.error("Ingresa un número de identificación o contrato");
      return;
    }

    setIsSearching(true);
    setClientInfo(null);
    setBillingSetting(null);
    setInvoices([]);
    setPlatforms([]);

    try {
      // Search for client by identification number
      const { data: clientData, error: clientError } = await supabase
        .from('isp_clients')
        .select('id, client_name, username, plan_or_speed, connection_type, mikrotik_id')
        .eq('identification_number', query.trim())
        .eq('is_potential_client', false)
        .single();

      let foundClient: ClientInfo | null = null;

      if (clientError || !clientData) {
        // Try searching by contract number
        const { data: contractData, error: contractError } = await supabase
          .from('isp_contracts')
          .select('client_id, mikrotik_id')
          .eq('contract_number', query.trim())
          .single();

        if (contractError || !contractData) {
          toast.error("No se encontró ningún cliente con esos datos");
          setIsSearching(false);
          return;
        }

        // Get client info from contract
        const { data: clientFromContract } = await supabase
          .from('isp_clients')
          .select('id, client_name, username, plan_or_speed, connection_type, mikrotik_id')
          .eq('id', contractData.client_id)
          .single();

        if (!clientFromContract) {
          toast.error("No se encontró información del cliente");
          setIsSearching(false);
          return;
        }

        foundClient = clientFromContract;
        setClientInfo(clientFromContract);
      } else {
        foundClient = clientData;
        setClientInfo(clientData);
      }

      if (!foundClient) {
        setIsSearching(false);
        return;
      }

      // Get billing settings
      const { data: billing } = await supabase
        .from('client_billing_settings')
        .select('monthly_amount, billing_day, is_suspended')
        .eq('client_id', foundClient.id)
        .single();

      if (billing) {
        setBillingSetting(billing);
      }

      // Get pending invoices
      const { data: invoiceData } = await supabase
        .from('client_invoices')
        .select('id, invoice_number, amount, due_date, status, billing_period_start, billing_period_end, paid_at')
        .eq('client_id', foundClient.id)
        .in('status', ['pending', 'overdue'])
        .order('due_date', { ascending: true });

      if (invoiceData) {
        setInvoices(invoiceData);
      }

      // Get payment platforms for this mikrotik
      const { data: platformsData } = await supabase
        .from('payment_platforms')
        .select('platform, is_active, public_key, environment')
        .eq('mikrotik_id', foundClient.mikrotik_id)
        .eq('is_active', true);

      if (platformsData) {
        setPlatforms(platformsData);
      }

    } catch (error) {
      console.error('Search error:', error);
      toast.error("Error al buscar cliente");
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearch = () => {
    handleSearchWithQuery(searchQuery);
  };

  const initiatePayment = async (invoice: Invoice, platform: string) => {
    // For Nequi, show phone dialog first
    if (platform === 'nequi') {
      setNequiPendingInvoice(invoice);
      setNequiDialogOpen(true);
      return;
    }

    await processPayment(invoice, platform);
  };

  const processPayment = async (invoice: Invoice, platform: string, phoneNumber?: string) => {
    setIsProcessingPayment(true);
    setSelectedInvoice(invoice);

    try {
      const body: any = {
        action: 'create-payment',
        platform,
        invoice_id: invoice.id,
        amount: invoice.amount,
        description: `Pago factura ${invoice.invoice_number}`,
        customer_email: '',
        mikrotik_id: clientInfo?.mikrotik_id
      };

      if (phoneNumber) {
        body.phone_number = phoneNumber;
      }

      const { data, error } = await supabase.functions.invoke('payment-gateway', { body });

      if (error) throw error;

      if (data?.requires_phone) {
        // Nequi needs phone number - store transaction info for later
        setNequiTransactionId(data.transaction_id);
        setNequiReference(data.reference);
        toast.info(data.message);
      } else if (data?.redirect_url) {
        window.location.href = data.redirect_url;
      } else if (data?.checkout_url) {
        window.open(data.checkout_url, '_blank');
      } else {
        toast.info("Pago iniciado. Sigue las instrucciones en pantalla.");
      }

    } catch (error: any) {
      console.error('Payment error:', error);
      toast.error(`Error al procesar pago: ${error.message}`);
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const handleNequiPayment = async () => {
    if (!nequiPhone || nequiPhone.length < 10) {
      toast.error("Ingresa un número de celular válido");
      return;
    }
    if (!nequiPendingInvoice || !nequiTransactionId || !nequiReference) {
      toast.error("Error: información de transacción incompleta");
      return;
    }

    setIsProcessingPayment(true);
    setNequiDialogOpen(false);
    setNequiPolling(true);
    setNequiStatus('sending');

    try {
      // Send push notification
      const { data, error } = await supabase.functions.invoke('payment-gateway', {
        body: {
          action: 'nequi-push',
          transaction_id: nequiTransactionId,
          phone_number: nequiPhone,
          amount: nequiPendingInvoice.amount,
          mikrotik_id: clientInfo?.mikrotik_id,
          reference: nequiReference
        }
      });

      if (error) throw error;

      toast.success(data?.message || "Notificación enviada a tu app Nequi");
      setNequiStatus('waiting');

      // Start polling for payment status
      pollNequiPayment(nequiTransactionId, nequiReference);

    } catch (error: any) {
      console.error('Nequi push error:', error);
      toast.error(`Error: ${error.message}`);
      setNequiPolling(false);
      setNequiStatus(null);
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const pollNequiPayment = async (transactionId: string, reference: string) => {
    let attempts = 0;
    const maxAttempts = 30; // 5 minutes (10 seconds interval)

    const checkStatus = async () => {
      if (attempts >= maxAttempts) {
        setNequiPolling(false);
        setNequiStatus('timeout');
        toast.error("Tiempo de espera agotado. Si aprobaste el pago, el estado se actualizará pronto.");
        return;
      }

      attempts++;

      try {
        const { data, error } = await supabase.functions.invoke('payment-gateway', {
          body: {
            action: 'verify-payment',
            transaction_id: transactionId,
            platform: 'nequi',
            external_reference: reference
          }
        });

        if (error) {
          console.error('Status check error:', error);
          setTimeout(checkStatus, 10000);
          return;
        }

        if (data?.status === 'approved') {
          setNequiPolling(false);
          setNequiStatus('approved');
          toast.success("¡Pago aprobado! Tu servicio ha sido reactivado.");
          // Refresh invoices
          handleSearchWithQuery(searchQuery);
        } else if (data?.status === 'rejected') {
          setNequiPolling(false);
          setNequiStatus('rejected');
          toast.error("El pago fue rechazado");
        } else {
          // Still pending, continue polling
          setTimeout(checkStatus, 10000);
        }

      } catch (err) {
        console.error('Polling error:', err);
        setTimeout(checkStatus, 10000);
      }
    };

    checkStatus();
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid':
        return <Badge className="bg-green-500"><CheckCircle className="h-3 w-3 mr-1" />Pagado</Badge>;
      case 'pending':
        return <Badge variant="secondary">Pendiente</Badge>;
      case 'overdue':
        return <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />Vencido</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      <div className="container max-w-4xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <CreditCard className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-foreground">Portal de Pagos</h1>
          <p className="text-muted-foreground mt-2">
            Consulta y paga tu factura de internet
          </p>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Buscar mi Factura
            </CardTitle>
            <CardDescription>
              Ingresa tu número de cédula o número de contrato
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <Label htmlFor="search">Número de Identificación o Contrato</Label>
                <Input
                  id="search"
                  placeholder="Ej: 123456789 o CONT-2024-001"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
              </div>
              <div className="flex items-end">
                <Button onClick={handleSearch} disabled={isSearching} className="w-full sm:w-auto">
                  {isSearching ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Search className="h-4 w-4 mr-2" />
                  )}
                  Buscar
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {clientInfo && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Información del Cliente
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-sm text-muted-foreground">Nombre</p>
                    <p className="font-medium">{clientInfo.client_name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Usuario</p>
                    <p className="font-medium">{clientInfo.username}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Plan</p>
                    <p className="font-medium">{clientInfo.plan_or_speed || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Estado</p>
                    {billingSetting?.is_suspended ? (
                      <Badge variant="destructive">Servicio Suspendido</Badge>
                    ) : (
                      <Badge className="bg-green-500">Activo</Badge>
                    )}
                  </div>
                </div>

                {billingSetting && (
                  <div className="mt-4 pt-4 border-t">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Día de corte: {billingSetting.billing_day}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                        <span className="text-lg font-bold">${billingSetting.monthly_amount.toLocaleString()} COP</span>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {invoices.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Receipt className="h-5 w-5" />
                    Facturas Pendientes
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {invoices.map((invoice) => (
                    <div key={invoice.id} className="border rounded-lg p-4">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div>
                          <p className="font-mono font-medium">{invoice.invoice_number}</p>
                          <p className="text-sm text-muted-foreground">
                            Periodo: {format(parseISO(invoice.billing_period_start), 'dd MMM', { locale: es })} - {format(parseISO(invoice.billing_period_end), 'dd MMM yyyy', { locale: es })}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            {getStatusBadge(invoice.status)}
                            <span className="text-sm text-muted-foreground">
                              Vence: {format(parseISO(invoice.due_date), 'dd/MM/yyyy')}
                            </span>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-bold">${invoice.amount.toLocaleString()}</p>
                          <p className="text-sm text-muted-foreground">COP</p>
                        </div>
                      </div>

                      {platforms.length > 0 && (
                        <>
                          <Separator className="my-4" />
                          <div className="space-y-2">
                            <p className="text-sm font-medium">Pagar con:</p>
                            <div className="flex flex-wrap gap-2">
                              {platforms.map((platform) => (
                                <Button
                                  key={platform.platform}
                                  variant="outline"
                                  onClick={() => initiatePayment(invoice, platform.platform)}
                                  disabled={isProcessingPayment}
                                  className="flex items-center gap-2"
                                >
                                  {isProcessingPayment && selectedInvoice?.id === invoice.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : platform.platform === 'nequi' ? (
                                    <Smartphone className="h-4 w-4" />
                                  ) : (
                                    <CreditCard className="h-4 w-4" />
                                  )}
                                  {platform.platform === 'wompi' ? 'Wompi' : platform.platform === 'nequi' ? 'Nequi' : 'Mercado Pago'}
                                  {platform.platform !== 'nequi' && <ExternalLink className="h-3 w-3" />}
                                </Button>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-8 text-center">
                  <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
                  <p className="text-lg font-medium">¡Estás al día!</p>
                  <p className="text-muted-foreground">No tienes facturas pendientes de pago</p>
                </CardContent>
              </Card>
            )}

            {platforms.length === 0 && invoices.length > 0 && (
              <Card className="border-yellow-500/50 bg-yellow-500/10">
                <CardContent className="py-4 text-center">
                  <AlertTriangle className="h-8 w-8 text-yellow-500 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Actualmente no hay métodos de pago en línea disponibles. 
                    Contacta a tu proveedor para realizar el pago.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Nequi Payment Status Card */}
            {nequiPolling && (
              <Card className="border-pink-500/50 bg-pink-500/10">
                <CardContent className="py-6 text-center">
                  <Loader2 className="h-10 w-10 text-pink-500 mx-auto mb-4 animate-spin" />
                  <p className="text-lg font-medium">Esperando confirmación de Nequi</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Revisa tu app Nequi y aprueba el pago. Esta página se actualizará automáticamente.
                  </p>
                </CardContent>
              </Card>
            )}

            {nequiStatus === 'approved' && !nequiPolling && (
              <Card className="border-green-500/50 bg-green-500/10">
                <CardContent className="py-6 text-center">
                  <CheckCircle className="h-10 w-10 text-green-500 mx-auto mb-4" />
                  <p className="text-lg font-medium">¡Pago Exitoso!</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Tu pago con Nequi fue procesado correctamente.
                  </p>
                </CardContent>
              </Card>
            )}

            {nequiStatus === 'rejected' && !nequiPolling && (
              <Card className="border-destructive/50 bg-destructive/10">
                <CardContent className="py-6 text-center">
                  <AlertTriangle className="h-10 w-10 text-destructive mx-auto mb-4" />
                  <p className="text-lg font-medium">Pago Rechazado</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    El pago fue rechazado. Intenta nuevamente.
                  </p>
                </CardContent>
              </Card>
            )}

            {nequiStatus === 'timeout' && !nequiPolling && (
              <Card className="border-yellow-500/50 bg-yellow-500/10">
                <CardContent className="py-6 text-center">
                  <AlertTriangle className="h-10 w-10 text-yellow-500 mx-auto mb-4" />
                  <p className="text-lg font-medium">Tiempo Expirado</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    No recibimos respuesta. Si aprobaste el pago, el estado se actualizará pronto.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Nequi Phone Dialog */}
        <Dialog open={nequiDialogOpen} onOpenChange={setNequiDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Smartphone className="h-5 w-5 text-pink-500" />
                Pago con Nequi
              </DialogTitle>
              <DialogDescription>
                Ingresa tu número de celular registrado en Nequi para recibir la solicitud de pago
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="nequi-phone">Número de celular</Label>
                <Input
                  id="nequi-phone"
                  placeholder="3001234567"
                  value={nequiPhone}
                  onChange={(e) => setNequiPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  maxLength={10}
                />
              </div>
              {nequiPendingInvoice && (
                <div className="bg-muted p-3 rounded-lg">
                  <p className="text-sm text-muted-foreground">Monto a pagar:</p>
                  <p className="text-xl font-bold">${nequiPendingInvoice.amount.toLocaleString()} COP</p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setNequiDialogOpen(false)}>
                Cancelar
              </Button>
              <Button 
                onClick={handleNequiPayment} 
                disabled={isProcessingPayment || nequiPhone.length < 10}
                className="bg-pink-500 hover:bg-pink-600"
              >
                {isProcessingPayment ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Smartphone className="h-4 w-4 mr-2" />
                )}
                Solicitar Pago
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
