import { useState, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Download, Eye, PenTool, Printer, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

import { SignaturePad } from "./SignaturePad";
import { ContractPreview, type ClientContractData } from "./ContractPreview";
import { ContractTermsEditor, DEFAULT_TERMS, DEFAULT_COMPANY_INFO, type ContractTerms, type CompanyInfo } from "./ContractTermsEditor";

interface ContractGeneratorProps {
  clientData?: Partial<ClientContractData>;
  onContractSigned?: (contractData: ClientContractData, signatureUrl: string) => void;
}

export function ContractGenerator({ clientData, onContractSigned }: ContractGeneratorProps) {
  const contractRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showSignature, setShowSignature] = useState(false);
  const [clientSignature, setClientSignature] = useState<string | undefined>();
  const [isSigned, setIsSigned] = useState(false);

  // Equipos en préstamo
  const [equipment, setEquipment] = useState<string[]>(["Router WiFi"]);
  const [newEquipment, setNewEquipment] = useState("");

  // Términos y configuración de la empresa
  const [terms, setTerms] = useState<ContractTerms>(() => {
    const saved = localStorage.getItem("isp_contract_terms");
    return saved ? JSON.parse(saved) : DEFAULT_TERMS;
  });

  const [companyInfo, setCompanyInfo] = useState<CompanyInfo>(() => {
    const saved = localStorage.getItem("isp_company_info");
    return saved ? JSON.parse(saved) : DEFAULT_COMPANY_INFO;
  });

  // Datos completos del contrato
  const [contractFormData, setContractFormData] = useState<ClientContractData>({
    clientName: clientData?.clientName || "",
    identification: clientData?.identification || "",
    address: clientData?.address || "",
    phone: clientData?.phone || "",
    email: clientData?.email || "",
    plan: clientData?.plan || "",
    speed: clientData?.speed || "",
    price: clientData?.price || "",
    equipment: equipment,
    contractNumber: generateContractNumber(),
    date: new Date().toISOString(),
  });

  function generateContractNumber() {
    const prefix = "SUROS";
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const random = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}-${year}${month}-${random}`;
  }

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

  const handleSignatureComplete = (signatureDataUrl: string) => {
    setClientSignature(signatureDataUrl);
    setIsSigned(true);
    setShowSignature(false);
    toast.success("Firma registrada correctamente");
    onContractSigned?.(contractFormData, signatureDataUrl);
  };

  const generatePDF = async () => {
    if (!contractRef.current) return;

    setIsGenerating(true);
    try {
      const canvas = await html2canvas(contractRef.current, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
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
      const imgX = (pdfWidth - imgWidth * ratio) / 2;

      // Calculate total pages needed
      const totalPages = Math.ceil((imgHeight * ratio) / pdfHeight);

      for (let page = 0; page < totalPages; page++) {
        if (page > 0) {
          pdf.addPage();
        }

        const sourceY = page * (pdfHeight / ratio);
        const sourceHeight = Math.min(pdfHeight / ratio, imgHeight - sourceY);

        // Create a temporary canvas for this page section
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
            imgX,
            0,
            imgWidth * ratio,
            sourceHeight * ratio
          );
        }
      }

      const fileName = `contrato_${isSigned ? "firmado_" : ""}${contractFormData.contractNumber}.pdf`;
      pdf.save(fileName);
      toast.success("Contrato PDF generado correctamente");
    } catch (error) {
      console.error("Error generating PDF:", error);
      toast.error("Error al generar el PDF");
    } finally {
      setIsGenerating(false);
    }
  };

  const updateFormField = (field: keyof ClientContractData, value: string) => {
    setContractFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="generate" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="generate">
            <FileText className="w-4 h-4 mr-2" />
            Generar Contrato
          </TabsTrigger>
          <TabsTrigger value="terms">
            <PenTool className="w-4 h-4 mr-2" />
            Editar Términos
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

              {/* Estado de la firma */}
              {isSigned && (
                <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg flex items-center gap-3">
                  <CheckCircle2 className="w-6 h-6 text-green-600" />
                  <div>
                    <p className="font-medium text-green-700 dark:text-green-400">Contrato Firmado</p>
                    <p className="text-sm text-green-600 dark:text-green-500">El cliente ha firmado el contrato digitalmente</p>
                  </div>
                </div>
              )}

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
                        ref={contractRef}
                        clientData={contractFormData}
                        terms={terms}
                        companyInfo={companyInfo}
                        clientSignature={clientSignature}
                      />
                    </ScrollArea>
                    <div className="flex justify-end gap-2 pt-4">
                      <Button variant="outline" onClick={() => window.print()}>
                        <Printer className="w-4 h-4 mr-2" />
                        Imprimir
                      </Button>
                      <Button onClick={generatePDF} disabled={isGenerating}>
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

                <Dialog open={showSignature} onOpenChange={setShowSignature}>
                  <DialogTrigger asChild>
                    <Button variant={isSigned ? "outline" : "default"}>
                      <PenTool className="w-4 h-4 mr-2" />
                      {isSigned ? "Actualizar Firma" : "Firmar Contrato"}
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-lg">
                    <DialogHeader>
                      <DialogTitle>Firma Digital del Cliente</DialogTitle>
                    </DialogHeader>
                    <SignaturePad
                      onSignatureComplete={handleSignatureComplete}
                      onClear={() => setClientSignature(undefined)}
                    />
                  </DialogContent>
                </Dialog>

                <Button
                  onClick={generatePDF}
                  disabled={isGenerating || !contractFormData.clientName || !contractFormData.identification}
                  className="bg-gradient-to-r from-primary to-primary/80"
                >
                  {isGenerating ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4 mr-2" />
                  )}
                  Generar PDF
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Preview oculto para generación de PDF */}
          <div className="hidden">
            <ContractPreview
              ref={contractRef}
              clientData={contractFormData}
              terms={terms}
              companyInfo={companyInfo}
              clientSignature={clientSignature}
            />
          </div>
        </TabsContent>

        <TabsContent value="terms" className="mt-6">
          <ContractTermsEditor
            onSave={(newTerms, newCompanyInfo) => {
              setTerms(newTerms);
              setCompanyInfo(newCompanyInfo);
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
