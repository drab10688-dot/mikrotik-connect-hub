import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Download, Eye, PenTool, Printer, CheckCircle2, Loader2, Save, History, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getSelectedDeviceId } from "@/lib/mikrotik";
import { useAuth } from "@/hooks/useAuth";

import { SignaturePad } from "./SignaturePad";
import { ContractPreview, type ClientContractData } from "./ContractPreview";
import { ContractTermsEditor, DEFAULT_TERMS, DEFAULT_COMPANY_INFO, type ContractTerms, type CompanyInfo } from "./ContractTermsEditor";
import { ContractHistory } from "./ContractHistory";

interface ContractGeneratorProps {
  clientData?: Partial<ClientContractData>;
  onContractSigned?: (contractData: ClientContractData, signatureUrl: string) => void;
}

export function ContractGenerator({ clientData, onContractSigned }: ContractGeneratorProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<HTMLDivElement>(null);
  const mikrotikId = getSelectedDeviceId();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showClientSignature, setShowClientSignature] = useState(false);
  const [showManagerSignature, setShowManagerSignature] = useState(false);
  const [clientSignature, setClientSignature] = useState<string | undefined>();
  const [managerSignature, setManagerSignature] = useState<string | undefined>();
  const [managerName, setManagerName] = useState(() => {
    const companyInfo = localStorage.getItem("isp_company_info");
    if (companyInfo) {
      const parsed = JSON.parse(companyInfo);
      return parsed.managerName || "";
    }
    return "";
  });
  const [isClientSigned, setIsClientSigned] = useState(false);
  const [isManagerSigned, setIsManagerSigned] = useState(false);

  // Equipos en préstamo
  const [equipment, setEquipment] = useState<string[]>(["Router WiFi"]);
  const [newEquipment, setNewEquipment] = useState("");

  // Términos y configuración de la empresa
  const getTerms = (): ContractTerms => {
    const saved = localStorage.getItem("isp_contract_terms");
    return saved ? JSON.parse(saved) : DEFAULT_TERMS;
  };

  const getCompanyInfo = (): CompanyInfo => {
    const saved = localStorage.getItem("isp_company_info");
    return saved ? JSON.parse(saved) : DEFAULT_COMPANY_INFO;
  };

  const [terms, setTerms] = useState<ContractTerms>(getTerms);
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo>(getCompanyInfo);

  const refreshCompanyData = () => {
    setTerms(getTerms());
    setCompanyInfo(getCompanyInfo());
  };

  // Datos del contrato
  const [contractFormData, setContractFormData] = useState<ClientContractData>(() => ({
    clientName: clientData?.clientName || "",
    identification: clientData?.identification || "",
    address: clientData?.address || "",
    phone: clientData?.phone || "",
    email: clientData?.email || "",
    plan: clientData?.plan || "",
    speed: clientData?.speed || "",
    price: clientData?.price || "",
    equipment: ["Router WiFi"],
    contractNumber: generateContractNumber(),
    date: new Date().toISOString(),
  }));

  const updateFromClientData = () => {
    if (clientData) {
      setContractFormData(prev => ({
        ...prev,
        clientName: clientData.clientName || prev.clientName,
        identification: clientData.identification || prev.identification,
        address: clientData.address || prev.address,
        phone: clientData.phone || prev.phone,
        email: clientData.email || prev.email,
        plan: clientData.plan || prev.plan,
        speed: clientData.speed || prev.speed,
        price: clientData.price || prev.price,
      }));
    }
  };

  useEffect(() => {
    if (clientData) {
      updateFromClientData();
    }
  }, [clientData]);

  function generateContractNumber() {
    const prefix = "SUROS";
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const random = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}-${year}${month}-${random}`;
  }

  // Mutation para guardar contrato
  const saveContractMutation = useMutation({
    mutationFn: async (data: {
      contractData: ClientContractData;
      clientSignature?: string;
      managerSignature?: string;
      status: string;
    }) => {
      if (!mikrotikId || !user) throw new Error("Faltan datos requeridos");

      const { error } = await supabase.from("isp_contracts").insert({
        mikrotik_id: mikrotikId,
        created_by: user.id,
        contract_number: data.contractData.contractNumber,
        client_name: data.contractData.clientName,
        identification: data.contractData.identification,
        address: data.contractData.address,
        phone: data.contractData.phone,
        email: data.contractData.email,
        plan: data.contractData.plan,
        speed: data.contractData.speed,
        price: data.contractData.price,
        equipment: data.contractData.equipment,
        client_signature_url: data.clientSignature,
        manager_signature_url: data.managerSignature,
        signed_at: data.clientSignature && data.managerSignature ? new Date().toISOString() : null,
        status: data.status,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["isp-contracts"] });
      toast.success("Contrato guardado en el historial");
    },
    onError: (error: Error) => {
      toast.error("Error al guardar: " + error.message);
    },
  });

  const handleAddEquipment = () => {
    if (newEquipment.trim()) {
      const updated = [...equipment, newEquipment.trim()];
      setEquipment(updated);
      setContractFormData(prev => ({ ...prev, equipment: updated }));
      setNewEquipment("");
    }
  };

  const handleRemoveEquipment = (index: number) => {
    const updated = equipment.filter((_, i) => i !== index);
    setEquipment(updated);
    setContractFormData(prev => ({ ...prev, equipment: updated }));
  };

  const handleClientSignatureComplete = (signatureDataUrl: string) => {
    setClientSignature(signatureDataUrl);
    setIsClientSigned(true);
    setShowClientSignature(false);
    toast.success("Firma del cliente registrada");
    onContractSigned?.(contractFormData, signatureDataUrl);
  };

  const handleManagerSignatureComplete = (signatureDataUrl: string) => {
    setManagerSignature(signatureDataUrl);
    setIsManagerSigned(true);
    setShowManagerSignature(false);
    localStorage.setItem("isp_manager_name", managerName);
    toast.success("Firma del gerente registrada");
  };

  const generatePDF = async (shouldSave = false) => {
    const el = pdfRef.current;
    if (!el) {
      toast.error("Error: No se encontró la vista previa del contrato");
      return;
    }

    const rect = el.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
      toast.error("Error: La vista previa no tiene tamaño. Abra la Vista Previa e intente de nuevo.");
      return;
    }

    setIsGenerating(true);

    try {
      // Esperar un momento para asegurar que el QR esté renderizado
      await new Promise(resolve => setTimeout(resolve, 300));

      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: "#ffffff",
        onclone: (clonedDoc) => {
          // Asegurar que las imágenes estén listas en el clon
          const images = clonedDoc.querySelectorAll('img');
          images.forEach(img => {
            if (!img.complete) {
              img.style.display = 'none';
            }
          });
        }
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;
      const ratio = Math.min(pdfWidth / imgWidth, pdfHeight / imgHeight);

      const totalPages = Math.ceil((imgHeight * ratio) / pdfHeight);

      for (let page = 0; page < totalPages; page++) {
        if (page > 0) {
          pdf.addPage();
        }

        const sourceY = page * (pdfHeight / ratio);
        const sourceHeight = Math.min(pdfHeight / ratio, imgHeight - sourceY);

        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = imgWidth;
        pageCanvas.height = sourceHeight;
        const pageCtx = pageCanvas.getContext("2d");
        
        if (pageCtx) {
          pageCtx.drawImage(
            canvas,
            0,
            sourceY,
            imgWidth,
            sourceHeight,
            0,
            0,
            imgWidth,
            sourceHeight
          );

          const pageImgData = pageCanvas.toDataURL("image/png");
          pdf.addImage(
            pageImgData,
            "PNG",
            (pdfWidth - imgWidth * ratio) / 2,
            0,
            imgWidth * ratio,
            sourceHeight * ratio
          );
        }
      }

      const isSigned = isClientSigned && isManagerSigned;
      const fileName = `contrato_${isSigned ? "firmado_" : ""}${contractFormData.contractNumber}.pdf`;
      pdf.save(fileName);

      // Guardar en base de datos si está firmado
      if (shouldSave && mikrotikId && user) {
        await saveContractMutation.mutateAsync({
          contractData: contractFormData,
          clientSignature,
          managerSignature,
          status: isSigned ? "signed" : "draft",
        });
      }

      toast.success("Contrato PDF generado correctamente");
    } catch (error) {
      console.error("Error generating PDF:", error);
      toast.error("Error al generar el PDF: " + (error instanceof Error ? error.message : "Error desconocido"));
    } finally {
      setIsGenerating(false);
    }
  };

  const updateFormField = (field: keyof ClientContractData, value: string) => {
    setContractFormData(prev => ({ ...prev, [field]: value }));
  };

  const isBothSigned = isClientSigned && isManagerSigned;

  return (
    <div className="space-y-6">
      <Tabs defaultValue="generate" className="w-full" onValueChange={(value) => {
        if (value === "generate") {
          refreshCompanyData();
          updateFromClientData();
        }
      }}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="generate">
            <FileText className="w-4 h-4 mr-2" />
            <span className="hidden sm:inline">Generar Contrato</span>
            <span className="sm:hidden">Generar</span>
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="w-4 h-4 mr-2" />
            <span className="hidden sm:inline">Historial</span>
            <span className="sm:hidden">Historial</span>
          </TabsTrigger>
          <TabsTrigger value="terms">
            <PenTool className="w-4 h-4 mr-2" />
            <span className="hidden sm:inline">Editar Términos</span>
            <span className="sm:hidden">Términos</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="generate" className="space-y-6 mt-6">
          {/* Formulario de datos del contrato */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle>Datos del Contrato</CardTitle>
                  <CardDescription>Complete o verifique los datos del cliente para el contrato</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Número de Contrato */}
              <div className="p-4 bg-muted/50 rounded-lg">
                <p className="text-sm text-muted-foreground">Número de Contrato</p>
                <p className="text-xl font-mono font-bold">{contractFormData.contractNumber}</p>
              </div>

              {/* Datos del Cliente */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nombre Completo del Cliente *</Label>
                  <Input
                    value={contractFormData.clientName}
                    onChange={(e) => updateFormField("clientName", e.target.value)}
                    placeholder="Nombre del cliente"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Número de Identificación *</Label>
                  <Input
                    value={contractFormData.identification}
                    onChange={(e) => updateFormField("identification", e.target.value)}
                    placeholder="Cédula o NIT"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Dirección *</Label>
                  <Input
                    value={contractFormData.address}
                    onChange={(e) => updateFormField("address", e.target.value)}
                    placeholder="Dirección completa"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Teléfono *</Label>
                  <Input
                    value={contractFormData.phone}
                    onChange={(e) => updateFormField("phone", e.target.value)}
                    placeholder="Número de contacto"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Correo Electrónico</Label>
                  <Input
                    type="email"
                    value={contractFormData.email}
                    onChange={(e) => updateFormField("email", e.target.value)}
                    placeholder="correo@ejemplo.com"
                  />
                </div>
              </div>

              {/* Plan */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Plan Contratado *</Label>
                  <Input
                    value={contractFormData.plan}
                    onChange={(e) => updateFormField("plan", e.target.value)}
                    placeholder="Ej: Plan Básico"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Velocidad</Label>
                  <Input
                    value={contractFormData.speed}
                    onChange={(e) => updateFormField("speed", e.target.value)}
                    placeholder="Ej: 10 Mbps"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Precio Mensual</Label>
                  <Input
                    value={contractFormData.price}
                    onChange={(e) => updateFormField("price", e.target.value)}
                    placeholder="Ej: $50.000 COP/mes"
                  />
                </div>
              </div>

              {/* Equipos */}
              <div className="space-y-4">
                <Label>Equipos en Préstamo (Comodato)</Label>
                <div className="flex gap-2">
                  <Input
                    value={newEquipment}
                    onChange={(e) => setNewEquipment(e.target.value)}
                    placeholder="Agregar equipo..."
                    onKeyPress={(e) => e.key === "Enter" && handleAddEquipment()}
                  />
                  <Button type="button" onClick={handleAddEquipment}>
                    Agregar
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {equipment.map((item, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-2 bg-muted px-3 py-1.5 rounded-full text-sm"
                    >
                      <span>{item}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveEquipment(index)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              {/* Estado de las firmas */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {isClientSigned && (
                  <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg flex items-center gap-3">
                    <CheckCircle2 className="w-6 h-6 text-green-600" />
                    <div>
                      <p className="font-medium text-green-700 dark:text-green-400">Firma del Cliente</p>
                      <p className="text-sm text-green-600 dark:text-green-500">Registrada correctamente</p>
                    </div>
                  </div>
                )}
                {isManagerSigned && (
                  <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg flex items-center gap-3">
                    <UserCheck className="w-6 h-6 text-blue-600" />
                    <div>
                      <p className="font-medium text-blue-700 dark:text-blue-400">Firma del Gerente</p>
                      <p className="text-sm text-blue-600 dark:text-blue-500">Registrada correctamente</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Acciones */}
              <div className="flex flex-wrap gap-3 pt-4 border-t">
                <Dialog open={showPreview} onOpenChange={setShowPreview}>
                  <DialogTrigger asChild>
                    <Button variant="outline">
                      <Eye className="w-4 h-4 mr-2" />
                      Vista Previa
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-5xl max-h-[90vh]">
                    <DialogHeader>
                      <DialogTitle>Vista Previa del Contrato</DialogTitle>
                    </DialogHeader>
                    <ScrollArea className="h-[70vh]">
                      <ContractPreview
                        ref={previewRef}
                        clientData={contractFormData}
                        terms={terms}
                        companyInfo={companyInfo}
                        clientSignature={clientSignature}
                        managerSignature={managerSignature}
                        managerName={managerName}
                      />
                    </ScrollArea>
                    <div className="flex justify-end gap-2 pt-4">
                      <Button variant="outline" onClick={() => window.print()}>
                        <Printer className="w-4 h-4 mr-2" />
                        Imprimir
                      </Button>
                      <Button onClick={() => generatePDF(false)} disabled={isGenerating}>
                        {isGenerating ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Download className="w-4 h-4 mr-2" />
                        )}
                        Descargar PDF
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>

                {/* Firma del Cliente */}
                <Dialog open={showClientSignature} onOpenChange={setShowClientSignature}>
                  <DialogTrigger asChild>
                    <Button variant={isClientSigned ? "outline" : "default"}>
                      <PenTool className="w-4 h-4 mr-2" />
                      {isClientSigned ? "Actualizar Firma Cliente" : "Firma del Cliente"}
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-lg">
                    <DialogHeader>
                      <DialogTitle>Firma Digital del Cliente</DialogTitle>
                    </DialogHeader>
                    <SignaturePad
                      onSignatureComplete={handleClientSignatureComplete}
                      onClear={() => setClientSignature(undefined)}
                      title="Firma del Suscriptor"
                      description="El cliente debe firmar dentro del recuadro"
                    />
                  </DialogContent>
                </Dialog>

                {/* Firma del Gerente */}
                <Dialog open={showManagerSignature} onOpenChange={setShowManagerSignature}>
                  <DialogTrigger asChild>
                    <Button variant={isManagerSigned ? "outline" : "secondary"}>
                      <UserCheck className="w-4 h-4 mr-2" />
                      {isManagerSigned ? "Actualizar Firma Gerente" : "Firma del Gerente"}
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-lg">
                    <DialogHeader>
                      <DialogTitle>Firma Digital del Representante Legal</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Nombre del Gerente</Label>
                        <Input
                          value={managerName}
                          onChange={(e) => setManagerName(e.target.value)}
                          placeholder="Nombre completo del gerente"
                        />
                      </div>
                      <SignaturePad
                        onSignatureComplete={handleManagerSignatureComplete}
                        onClear={() => setManagerSignature(undefined)}
                        title="Firma del Representante Legal"
                        description="El gerente debe firmar dentro del recuadro"
                      />
                    </div>
                  </DialogContent>
                </Dialog>

                {/* Generar y Guardar PDF */}
                <Button
                  onClick={() => generatePDF(true)}
                  disabled={isGenerating || !contractFormData.clientName || !contractFormData.identification}
                  className="bg-gradient-to-r from-primary to-primary/80"
                >
                  {isGenerating ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4 mr-2" />
                  )}
                  {isBothSigned ? "Guardar y Descargar" : "Generar PDF"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Preview offscreen para generación de PDF (no usar display:none) */}
          <div className="fixed -left-[10000px] top-0 w-[896px]">
            <ContractPreview
              ref={pdfRef}
              clientData={contractFormData}
              terms={terms}
              companyInfo={companyInfo}
              clientSignature={clientSignature}
              managerSignature={managerSignature}
              managerName={managerName}
            />
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <ContractHistory />
        </TabsContent>

        <TabsContent value="terms" className="mt-6">
          <ContractTermsEditor />
        </TabsContent>
      </Tabs>
    </div>
  );
}