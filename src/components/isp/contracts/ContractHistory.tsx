import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getSelectedDeviceId } from "@/lib/mikrotik";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, Download, Trash2, Search, Calendar, User, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

interface Contract {
  id: string;
  contract_number: string;
  client_name: string;
  identification: string;
  address: string;
  phone: string;
  email: string;
  plan: string;
  speed: string;
  price: string;
  equipment: string[];
  client_signature_url: string | null;
  manager_signature_url: string | null;
  signed_at: string | null;
  status: string;
  created_at: string;
}

export function ContractHistory() {
  const mikrotikId = getSelectedDeviceId();
  const queryClient = useQueryClient();
  const { isAdmin, isSuperAdmin } = useAuth();
  const [search, setSearch] = useState("");
  const [deletingContract, setDeletingContract] = useState<Contract | null>(null);

  const { data: contracts, isLoading } = useQuery({
    queryKey: ["isp-contracts", mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) throw new Error("No hay dispositivo seleccionado");
      
      const { data, error } = await supabase
        .from("isp_contracts")
        .select("*")
        .eq("mikrotik_id", mikrotikId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Contract[];
    },
    enabled: !!mikrotikId,
  });

  const deleteMutation = useMutation({
    mutationFn: async (contractId: string) => {
      const { error } = await supabase
        .from("isp_contracts")
        .delete()
        .eq("id", contractId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["isp-contracts"] });
      toast.success("Contrato eliminado correctamente");
      setDeletingContract(null);
    },
    onError: (error: Error) => {
      toast.error("Error al eliminar: " + error.message);
    },
  });

  const filteredContracts = contracts?.filter(contract => {
    const searchLower = search.toLowerCase();
    return (
      contract.client_name.toLowerCase().includes(searchLower) ||
      contract.contract_number.toLowerCase().includes(searchLower) ||
      contract.identification.toLowerCase().includes(searchLower)
    );
  });

  const getStatusBadge = (status: string, signedAt: string | null) => {
    if (signedAt) {
      return (
        <Badge className="bg-green-500/10 text-green-600 border-green-500/30">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Firmado
        </Badge>
      );
    }
    switch (status) {
      case "signed":
        return (
          <Badge className="bg-green-500/10 text-green-600 border-green-500/30">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Firmado
          </Badge>
        );
      case "draft":
        return (
          <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/30">
            <Clock className="w-3 h-3 mr-1" />
            Borrador
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary">
            {status}
          </Badge>
        );
    }
  };

  const handleDownload = async (contract: Contract) => {
    // For now, create a simple text download - in a full implementation,
    // you would regenerate the PDF or use a stored PDF URL
    const content = `
CONTRATO DE PRESTACIÓN DE SERVICIOS DE INTERNET
================================================

Número de Contrato: ${contract.contract_number}
Fecha: ${format(new Date(contract.created_at), "PPP", { locale: es })}

DATOS DEL CLIENTE:
- Nombre: ${contract.client_name}
- Identificación: ${contract.identification}
- Dirección: ${contract.address}
- Teléfono: ${contract.phone}
- Email: ${contract.email || "No registrado"}

SERVICIO CONTRATADO:
- Plan: ${contract.plan}
- Velocidad: ${contract.speed || "N/A"}
- Precio: ${contract.price || "N/A"}

${contract.equipment?.length ? `EQUIPOS EN COMODATO:\n${contract.equipment.map(e => `- ${e}`).join("\n")}` : ""}

Estado: ${contract.signed_at ? "FIRMADO" : "BORRADOR"}
${contract.signed_at ? `Fecha de firma: ${format(new Date(contract.signed_at), "PPP", { locale: es })}` : ""}
    `.trim();

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contrato_${contract.contract_number}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    
    toast.success("Contrato descargado");
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>Historial de Contratos</CardTitle>
              <CardDescription>
                {contracts?.length || 0} contratos registrados
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Búsqueda */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, número de contrato o cédula..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Tabla */}
        {!filteredContracts || filteredContracts.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No hay contratos registrados</p>
            <p className="text-sm">Los contratos firmados aparecerán aquí</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contrato</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredContracts.map((contract) => (
                  <TableRow key={contract.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-muted-foreground" />
                        <span className="font-mono text-sm">{contract.contract_number}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{contract.client_name}</p>
                        <p className="text-sm text-muted-foreground">
                          C.C. {contract.identification}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p>{contract.plan}</p>
                        {contract.speed && (
                          <p className="text-sm text-muted-foreground">{contract.speed}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(contract.status, contract.signed_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Calendar className="w-3 h-3" />
                        {format(new Date(contract.created_at), "dd/MM/yyyy")}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDownload(contract)}
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                        {(isAdmin || isSuperAdmin) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeletingContract(contract)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </CardContent>

      {/* Diálogo de confirmación de eliminación */}
      <AlertDialog open={!!deletingContract} onOpenChange={() => setDeletingContract(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar contrato?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Se eliminará permanentemente el contrato{" "}
              <strong>{deletingContract?.contract_number}</strong> de{" "}
              <strong>{deletingContract?.client_name}</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingContract && deleteMutation.mutate(deletingContract.id)}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}