import { useState, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CalendarIcon, Loader2, Search, User, FileText, Plus } from "lucide-react";
import { format, addDays, startOfMonth, endOfMonth } from "date-fns";
import { es } from "date-fns/locale";

interface Client {
  id: string;
  client_name: string;
  username: string;
  phone: string | null;
  email: string | null;
  identification_number: string | null;
  total_monthly_price: number | null;
  plan_or_speed: string | null;
}

interface CreateInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mikrotikId: string;
  clients: Client[];
  loadingClients: boolean;
}

export function CreateInvoiceDialog({
  open,
  onOpenChange,
  mikrotikId,
  clients,
  loadingClients,
}: CreateInvoiceDialogProps) {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState<Date>(addDays(new Date(), 15));
  const [billingPeriodStart, setBillingPeriodStart] = useState<Date>(startOfMonth(new Date()));
  const [billingPeriodEnd, setBillingPeriodEnd] = useState<Date>(endOfMonth(new Date()));
  const [notes, setNotes] = useState("");

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

  // Generate invoice number
  const generateInvoiceNumber = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
    return `FAC-${year}${month}-${random}`;
  };

  // Create invoice mutation
  const createInvoiceMutation = useMutation({
    mutationFn: async () => {
      if (!selectedClient) throw new Error("Selecciona un cliente");

      const invoiceNumber = generateInvoiceNumber();
      const invoiceAmount = parseFloat(amount);

      if (isNaN(invoiceAmount) || invoiceAmount <= 0) {
        throw new Error("El monto debe ser mayor a 0");
      }

      const { data, error } = await supabase
        .from("client_invoices")
        .insert({
          mikrotik_id: mikrotikId,
          client_id: selectedClient.id,
          invoice_number: invoiceNumber,
          amount: invoiceAmount,
          due_date: format(dueDate, "yyyy-MM-dd"),
          billing_period_start: format(billingPeriodStart, "yyyy-MM-dd"),
          billing_period_end: format(billingPeriodEnd, "yyyy-MM-dd"),
          status: "pending",
          service_breakdown: notes
            ? { notes }
            : { plan: selectedClient.plan_or_speed || "Servicio de Internet" },
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Factura ${data.invoice_number} creada correctamente`);
      queryClient.invalidateQueries({ queryKey: ["client-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["pending-invoices"] });
      resetForm();
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast.error(`Error al crear factura: ${error.message}`);
    },
  });

  const resetForm = () => {
    setSelectedClient(null);
    setAmount("");
    setDueDate(addDays(new Date(), 15));
    setBillingPeriodStart(startOfMonth(new Date()));
    setBillingPeriodEnd(endOfMonth(new Date()));
    setNotes("");
    setSearchTerm("");
  };

  const handleSelectClient = (client: Client) => {
    setSelectedClient(client);
    if (client.total_monthly_price) {
      setAmount(String(client.total_monthly_price));
    }
  };

  const handleSubmit = () => {
    if (!selectedClient) {
      toast.error("Selecciona un cliente");
      return;
    }
    createInvoiceMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Crear Factura Manual
          </DialogTitle>
          <DialogDescription>
            Crea una factura para un cliente existente
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-4">
          {/* Client Selection */}
          {!selectedClient ? (
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar cliente por nombre, usuario, cédula..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>

              <ScrollArea className="h-[200px] border rounded-md">
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
                    {filteredClients.map((client) => (
                      <div
                        key={client.id}
                        className="p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => handleSelectClient(client)}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-medium">{client.client_name}</p>
                            <p className="text-sm text-muted-foreground">
                              {client.username}
                            </p>
                            {client.identification_number && (
                              <p className="text-xs text-muted-foreground">
                                CC: {client.identification_number}
                              </p>
                            )}
                          </div>
                          {client.total_monthly_price && (
                            <span className="text-sm font-medium">
                              ${client.total_monthly_price.toLocaleString()}/mes
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Selected Client Info */}
              <div className="p-4 border rounded-lg bg-muted/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-full bg-primary/10">
                      <User className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">{selectedClient.client_name}</p>
                      <p className="text-sm text-muted-foreground">
                        {selectedClient.username}
                        {selectedClient.plan_or_speed && ` • ${selectedClient.plan_or_speed}`}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedClient(null)}
                  >
                    Cambiar
                  </Button>
                </div>
              </div>

              {/* Invoice Details */}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="amount">Monto</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      $
                    </span>
                    <Input
                      id="amount"
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="pl-7"
                      placeholder="0"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Fecha de Vencimiento</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !dueDate && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {dueDate
                          ? format(dueDate, "dd/MM/yyyy", { locale: es })
                          : "Seleccionar"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={dueDate}
                        onSelect={(date) => date && setDueDate(date)}
                        locale={es}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {/* Billing Period */}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Periodo Inicio</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !billingPeriodStart && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {billingPeriodStart
                          ? format(billingPeriodStart, "dd/MM/yyyy", { locale: es })
                          : "Seleccionar"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={billingPeriodStart}
                        onSelect={(date) => date && setBillingPeriodStart(date)}
                        locale={es}
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-2">
                  <Label>Periodo Fin</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !billingPeriodEnd && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {billingPeriodEnd
                          ? format(billingPeriodEnd, "dd/MM/yyyy", { locale: es })
                          : "Seleccionar"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={billingPeriodEnd}
                        onSelect={(date) => date && setBillingPeriodEnd(date)}
                        locale={es}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <Label htmlFor="notes">Notas (opcional)</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Descripción adicional del servicio o factura..."
                  rows={3}
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!selectedClient || !amount || createInvoiceMutation.isPending}
          >
            {createInvoiceMutation.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            <Plus className="h-4 w-4 mr-2" />
            Crear Factura
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
