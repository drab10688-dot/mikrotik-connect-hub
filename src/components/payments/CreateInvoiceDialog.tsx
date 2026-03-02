import { useState, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invoicesApi } from "@/lib/api-client";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, FileText } from "lucide-react";
import { format, addMonths } from "date-fns";

interface Client {
  id: string;
  client_name: string;
  username: string;
  total_monthly_price?: number;
  service_price?: number;
}

interface Contract {
  id: string;
  contract_number: string;
  client_name: string;
  client_id?: string;
  total_price?: string;
}

interface CreateInvoiceDialogProps {
  mikrotikId: string;
  clients?: Client[];
  contracts?: Contract[];
}

const CreateInvoiceDialog = ({ mikrotikId, clients = [], contracts = [] }: CreateInvoiceDialogProps) => {
  const [open, setOpen] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedContractId, setSelectedContractId] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(format(addMonths(new Date(), 1), "yyyy-MM-dd"));
  const [notes, setNotes] = useState("");
  const queryClient = useQueryClient();

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedClientId),
    [clients, selectedClientId]
  );

  const createMutation = useMutation({
    mutationFn: (data: any) => invoicesApi.generateForClient(data),
    onSuccess: () => {
      toast.success("Factura creada exitosamente");
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      setOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message || "Error al crear factura");
    },
  });

  const resetForm = () => {
    setSelectedClientId("");
    setSelectedContractId("");
    setAmount("");
    setDueDate(format(addMonths(new Date(), 1), "yyyy-MM-dd"));
    setNotes("");
  };

  const handleClientChange = (clientId: string) => {
    setSelectedClientId(clientId);
    const client = clients.find((c) => c.id === clientId);
    if (client) {
      const price = client.total_monthly_price || client.service_price || 0;
      setAmount(String(price));
    }
  };

  const handleSubmit = () => {
    if (!selectedClientId || !amount || !dueDate) {
      toast.error("Complete todos los campos requeridos");
      return;
    }

    const now = new Date();
    createMutation.mutate({
      mikrotik_id: mikrotikId,
      client_id: selectedClientId,
      contract_id: selectedContractId || undefined,
      amount: parseFloat(amount),
      due_date: dueDate,
      billing_period_start: format(now, "yyyy-MM-dd"),
      billing_period_end: format(addMonths(now, 1), "yyyy-MM-dd"),
      notes,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="h-4 w-4 mr-2" />
          Crear Factura
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Crear Factura Manual
          </DialogTitle>
          <DialogDescription>
            Genera una factura individual para un cliente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Cliente *</Label>
            <Select value={selectedClientId} onValueChange={handleClientChange}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar cliente" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.client_name} ({client.username})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {contracts.length > 0 && (
            <div className="space-y-2">
              <Label>Contrato (opcional)</Label>
              <Select value={selectedContractId} onValueChange={setSelectedContractId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sin contrato asociado" />
                </SelectTrigger>
                <SelectContent>
                  {contracts
                    .filter((c) => !selectedClientId || c.client_id === selectedClientId)
                    .map((contract) => (
                      <SelectItem key={contract.id} value={contract.id}>
                        {contract.contract_number} - {contract.client_name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Monto *</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              min="0"
              step="0.01"
            />
          </div>

          <div className="space-y-2">
            <Label>Fecha de vencimiento *</Label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Notas</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notas adicionales..."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creando..." : "Crear Factura"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreateInvoiceDialog;
