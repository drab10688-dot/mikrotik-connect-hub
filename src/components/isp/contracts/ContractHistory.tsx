import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getSelectedDeviceId } from "@/lib/mikrotik";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, Download, Trash2, Search, Calendar, CheckCircle2, Clock, Loader2, PenTool } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { ContractPreview, type ClientContractData } from "./ContractPreview";
import { SignaturePad } from "./SignaturePad";
import {
  DEFAULT_TERMS,
  DEFAULT_COMPANY_INFO,
  type CompanyInfo,
  type ContractTerms,
} from "./ContractTermsEditor";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

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
  service_option: string | null;
  service_price: string | null;
  total_price: string | null;
}

export function ContractHistory() {
  const mikrotikId = getSelectedDeviceId();
  const queryClient = useQueryClient();
  const { isAdmin, isSuperAdmin } = useAuth();
  const [search, setSearch] = useState("");
  const [deletingContract, setDeletingContract] = useState<Contract | null>(null);
  const [downloadingContract, setDownloadingContract] = useState<Contract | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const pdfRef = useRef<HTMLDivElement>(null);
  
  // Sign contract state
  const [signingContract, setSigningContract] = useState<Contract | null>(null);
  const [showSignatureDialog, setShowSignatureDialog] = useState(false);

  const getTerms = (): ContractTerms => {
    const saved = localStorage.getItem("isp_contract_terms");
    return saved ? JSON.parse(saved) : DEFAULT_TERMS;
  };

  const getCompanyInfo = (): CompanyInfo => {
    const saved = localStorage.getItem("isp_company_info");
    return saved ? JSON.parse(saved) : DEFAULT_COMPANY_INFO;
  };

  const terms = getTerms();
  const companyInfo = getCompanyInfo();

  const [managerName, setManagerName] = useState(() => {
    const savedCompany = localStorage.getItem("isp_company_info");
    if (savedCompany) {
      const parsed = JSON.parse(savedCompany);
      return parsed.managerName || "";
    }
    return "";
  });

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

  // Sign contract mutation
  const signContractMutation = useMutation({
    mutationFn: async ({ contractId, managerSignature }: { contractId: string; managerSignature: string }) => {
      const { error } = await supabase
        .from("isp_contracts")
        .update({
          manager_signature_url: managerSignature,
          signed_at: new Date().toISOString(),
          status: "signed",
        })
        .eq("id", contractId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["isp-contracts"] });
      toast.success("Contrato firmado correctamente");
      setShowSignatureDialog(false);
      setSigningContract(null);
    },
    onError: (error: Error) => {
      toast.error("Error al firmar: " + error.message);
    },
  });

  const handleOpenSignDialog = (contract: Contract) => {
    setSigningContract(contract);
    setShowSignatureDialog(true);
  };

  const handleManagerSignatureComplete = (signatureDataUrl: string) => {
    if (!signingContract) return;
    localStorage.setItem("isp_manager_name", managerName);
    signContractMutation.mutate({
      contractId: signingContract.id,
      managerSignature: signatureDataUrl,
    });
  };

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

  // Generate PDF from contract data
  const generatePdfFromContract = async () => {
    if (!downloadingContract || !pdfRef.current) return;

    setIsGeneratingPdf(true);
    
    try {
      // Wait for QR code and content to render
      await new Promise(resolve => setTimeout(resolve, 600));

      const canvas = await html2canvas(pdfRef.current, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: "#ffffff",
        logging: false,
        onclone: (clonedDoc) => {
          const imgs = clonedDoc.querySelectorAll("img");
          imgs.forEach((img) => {
            if (!img.complete) {
              img.style.display = "none";
            }
          });
        },
      });

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "letter",
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;

      // IMPORTANT: Ajustar por ancho para evitar que el contenido se "encoga" intentando caber en 1 sola página
      const ratio = pdfWidth / imgWidth;

      // Paginar por altura
      const pageHeightInPixels = pdfHeight / ratio;
      const totalPages = Math.ceil(imgHeight / pageHeightInPixels);

      for (let page = 0; page < totalPages; page++) {
        if (page > 0) pdf.addPage();

        const sourceY = page * pageHeightInPixels;
        const sourceHeight = Math.min(pageHeightInPixels, imgHeight - sourceY);
        const destHeight = sourceHeight * ratio;

        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = imgWidth;
        pageCanvas.height = sourceHeight;
        const ctx = pageCanvas.getContext("2d");
        
        if (ctx) {
          ctx.drawImage(
            canvas,
            0, sourceY, imgWidth, sourceHeight,
            0, 0, imgWidth, sourceHeight
          );
          
          const pageImgData = pageCanvas.toDataURL("image/jpeg", 0.95);
          pdf.addImage(pageImgData, "JPEG", 0, 0, pdfWidth, destHeight);
        }
      }

      pdf.save(`contrato_${downloadingContract.contract_number}.pdf`);
      toast.success("PDF descargado correctamente");
    } catch (error) {
      console.error("Error generating PDF:", error);
      toast.error("Error al generar el PDF");
    } finally {
      setIsGeneratingPdf(false);
      setDownloadingContract(null);
    }
  };

  // Trigger PDF generation when contract is set
  useEffect(() => {
    if (downloadingContract && pdfRef.current) {
      generatePdfFromContract();
    }
  }, [downloadingContract]);

  const handleDownload = (contract: Contract) => {
    setDownloadingContract(contract);
  };

  // Convert contract to ClientContractData format
  const contractToClientData = (contract: Contract): ClientContractData => ({
    clientName: contract.client_name,
    identification: contract.identification,
    address: contract.address || "",
    phone: contract.phone || "",
    email: contract.email || "",
    plan: contract.plan,
    speed: contract.speed || undefined,
    price: contract.price || undefined,
    equipment: contract.equipment || undefined,
    contractNumber: contract.contract_number,
    date: contract.created_at,
    serviceOption: contract.service_option || undefined,
    servicePrice: contract.service_price || undefined,
    totalPrice: contract.total_price || undefined,
  });

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
                        {/* Sign button for draft contracts */}
                        {contract.status === "draft" && !contract.signed_at && (isAdmin || isSuperAdmin) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-primary hover:text-primary"
                            onClick={() => handleOpenSignDialog(contract)}
                            title="Firmar contrato"
                          >
                            <PenTool className="w-4 h-4" />
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDownload(contract)}
                          disabled={isGeneratingPdf && downloadingContract?.id === contract.id}
                        >
                          {isGeneratingPdf && downloadingContract?.id === contract.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Download className="w-4 h-4" />
                          )}
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

      {/* Dialog for manager signature */}
      <Dialog open={showSignatureDialog} onOpenChange={setShowSignatureDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PenTool className="w-5 h-5" />
              Firmar Contrato
            </DialogTitle>
            <DialogDescription>
              Firmar contrato <strong>{signingContract?.contract_number}</strong> de{" "}
              <strong>{signingContract?.client_name}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nombre del Representante Legal / Gerente</Label>
              <Input
                value={managerName}
                onChange={(e) => setManagerName(e.target.value)}
                placeholder="Ingrese el nombre del gerente"
              />
            </div>
            <div className="space-y-2">
              <Label>Firma del Gerente</Label>
              <SignaturePad
                onSignatureComplete={handleManagerSignatureComplete}
                title="Firma del Gerente"
              />
            </div>
            {signContractMutation.isPending && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-6 h-6 animate-spin mr-2" />
                <span>Guardando firma...</span>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Hidden container for PDF generation */}
      {downloadingContract && (
        <div className="fixed -left-[10000px] top-0 w-[896px]">
          <ContractPreview
            ref={pdfRef}
            clientData={contractToClientData(downloadingContract)}
            terms={terms}
            companyInfo={companyInfo}
            clientSignature={downloadingContract.client_signature_url || undefined}
            managerSignature={downloadingContract.manager_signature_url || undefined}
          />
        </div>
      )}
    </Card>
  );
}