import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Search, CreditCard, Receipt, CheckCircle, AlertTriangle, Loader2, Calendar, DollarSign, Building2, ExternalLink } from "lucide-react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Separator } from "@/components/ui/separator";

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
  const [searchQuery, setSearchQuery] = useState("");
  const [searchType, setSearchType] = useState<'identification' | 'contract'>('identification');
  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null);
  const [billingSetting, setBillingSetting] = useState<BillingSetting | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [platforms, setPlatforms] = useState<PaymentPlatform[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
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
        .eq('identification_number', searchQuery.trim())
        .eq('is_potential_client', false)
        .single();

      if (clientError || !clientData) {
        // Try searching by contract number
        const { data: contractData, error: contractError } = await supabase
          .from('isp_contracts')
          .select('client_id, mikrotik_id')
          .eq('contract_number', searchQuery.trim())
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

        setClientInfo(clientFromContract);
      } else {
        setClientInfo(clientData);
      }

      const client = clientData || (await supabase
        .from('isp_clients')
        .select('id, client_name, username, plan_or_speed, connection_type, mikrotik_id')
        .eq('identification_number', searchQuery.trim())
        .single()).data;

      if (!client) {
        setIsSearching(false);
        return;
      }

      // Get billing settings
      const { data: billing } = await supabase
        .from('client_billing_settings')
        .select('monthly_amount, billing_day, is_suspended')
        .eq('client_id', client.id)
        .single();

      if (billing) {
        setBillingSetting(billing);
      }

      // Get pending invoices
      const { data: invoiceData } = await supabase
        .from('client_invoices')
        .select('id, invoice_number, amount, due_date, status, billing_period_start, billing_period_end, paid_at')
        .eq('client_id', client.id)
        .in('status', ['pending', 'overdue'])
        .order('due_date', { ascending: true });

      if (invoiceData) {
        setInvoices(invoiceData);
      }

      // Get payment platforms for this mikrotik
      const { data: platformsData } = await supabase
        .from('payment_platforms')
        .select('platform, is_active, public_key, environment')
        .eq('mikrotik_id', client.mikrotik_id)
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

  const initiatePayment = async (invoice: Invoice, platform: string) => {
    setIsProcessingPayment(true);
    setSelectedInvoice(invoice);

    try {
      const { data, error } = await supabase.functions.invoke('payment-gateway', {
        body: {
          action: 'create-payment',
          platform,
          invoice_id: invoice.id,
          amount: invoice.amount,
          description: `Pago factura ${invoice.invoice_number}`,
          customer_email: '',
          mikrotik_id: clientInfo?.mikrotik_id
        }
      });

      if (error) throw error;

      if (data?.redirect_url) {
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
                                  ) : (
                                    <CreditCard className="h-4 w-4" />
                                  )}
                                  {platform.platform === 'wompi' ? 'Wompi' : 'Mercado Pago'}
                                  <ExternalLink className="h-3 w-3" />
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
          </div>
        )}
      </div>
    </div>
  );
}
