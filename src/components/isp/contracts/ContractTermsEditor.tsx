import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Save, RotateCcw, FileText, Building2 } from "lucide-react";
import { toast } from "sonner";

export interface CompanyInfo {
  name: string;
  nit: string;
  contact: string;
  email: string;
  website: string;
  address: string;
}

export interface ContractTerms {
  object: string;
  validity: string;
  payment: string;
  providerObligations: string;
  clientObligations: string;
  equipment: string;
  suspension: string;
  termination: string;
  freedom: string;
  pqr: string;
  dataProtection: string;
}

const DEFAULT_COMPANY_INFO: CompanyInfo = {
  name: "Suros Comunicaciones SAS ZOMAC",
  nit: "901692609",
  contact: "312 6189282",
  email: "administracion@sur-os.com",
  website: "https://suros-comunicaciones.com",
  address: "Dirección de la empresa",
};

const DEFAULT_TERMS: ContractTerms = {
  object: "El presente contrato tiene por objeto la prestación del servicio de Acceso a Internet Fijo bajo las condiciones establecidas en el plan contratado y las Condiciones Generales de Prestación del Servicio (CGPS) del Operador, las cuales se entregan al cliente y hacen parte integral de este acuerdo.",
  validity: "El contrato entrará en vigencia desde la fecha de instalación y tendrá una duración indefinida.",
  payment: "El cliente se compromete a pagar mensualmente el valor del plan contratado. El pago debe realizarse a más tardar el 16 de cada mes. El no pago oportuno generará intereses moratorios a la tasa máxima legal permitida.",
  providerObligations: "La empresa se compromete a:\na) Proporcionar el servicio de internet con la calidad ofrecida;\nb) Atender las solicitudes de soporte y PQR de acuerdo con los plazos legales;\nc) Realizar la compensación automática al usuario mediante un descuento en la factura en caso de interrupción del servicio, conforme a la normativa de la CRC.",
  clientObligations: "El cliente se compromete a hacer uso adecuado del servicio, mantener los equipos en préstamo en buen estado y realizar los pagos de manera oportuna.",
  equipment: "Los equipos listados son entregados al cliente bajo la modalidad de comodato (préstamo) y son responsabilidad del cliente. En caso de terminación del contrato, el cliente deberá devolverlos en buen estado en un plazo no superior a quince (15) días calendario posteriores a la terminación.",
  suspension: "El servicio podrá ser suspendido por:\na) Mora: Por falta de pago que sea superior a quince (15) días calendario contados a partir de la fecha límite de pago oportuno.\nb) Solicitud del Cliente: El cliente podrá solicitar la suspensión temporal por hasta dos (2) meses al año, sin costo.\nc) Uso inadecuado o fraude.",
  termination: "a. Por el Cliente: El cliente podrá terminar el contrato en cualquier momento, sin penalidad económica alguna, mediante solicitud presentada con una antelación mínima de tres (3) días hábiles a la fecha de corte de facturación.\n\nb. Por el Prestador: El prestador podrá terminar el contrato por incumplimiento grave de las obligaciones del cliente.",
  freedom: "El presente contrato no establece ni exige Cláusula de Permanencia Mínima (CPM). En consecuencia, el cliente tiene la facultad de terminar el contrato en cualquier momento, sin que ello implique el cobro de valor alguno por concepto de terminación anticipada, ya que la empresa no cobra cargos por conexión o instalación financiados.",
  pqr: "El cliente puede presentar PQR a través de los canales de atención de soporte/PQR. La empresa dará respuesta a las PQR en los plazos establecidos por la legislación vigente y la normativa de la CRC.",
  dataProtection: "La empresa se compromete a proteger los datos personales del cliente de acuerdo con la Ley 1581 de 2012 y demás normas aplicables. El cliente autoriza el tratamiento de sus datos para fines contractuales.",
};

interface ContractTermsEditorProps {
  onSave?: (terms: ContractTerms, companyInfo: CompanyInfo) => void;
}

export function ContractTermsEditor({ onSave }: ContractTermsEditorProps) {
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo>(() => {
    const saved = localStorage.getItem("isp_company_info");
    return saved ? JSON.parse(saved) : DEFAULT_COMPANY_INFO;
  });

  const [terms, setTerms] = useState<ContractTerms>(() => {
    const saved = localStorage.getItem("isp_contract_terms");
    return saved ? JSON.parse(saved) : DEFAULT_TERMS;
  });

  const handleSave = () => {
    localStorage.setItem("isp_contract_terms", JSON.stringify(terms));
    localStorage.setItem("isp_company_info", JSON.stringify(companyInfo));
    toast.success("Términos y condiciones guardados correctamente");
    onSave?.(terms, companyInfo);
  };

  const handleReset = () => {
    setTerms(DEFAULT_TERMS);
    setCompanyInfo(DEFAULT_COMPANY_INFO);
    localStorage.removeItem("isp_contract_terms");
    localStorage.removeItem("isp_company_info");
    toast.info("Términos restaurados a valores predeterminados");
  };

  const updateTerm = (key: keyof ContractTerms, value: string) => {
    setTerms(prev => ({ ...prev, [key]: value }));
  };

  const updateCompanyInfo = (key: keyof CompanyInfo, value: string) => {
    setCompanyInfo(prev => ({ ...prev, [key]: value }));
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>Términos y Condiciones del Contrato</CardTitle>
              <CardDescription>Personaliza los términos que aparecerán en los contratos generados</CardDescription>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleReset}>
              <RotateCcw className="w-4 h-4 mr-2" />
              Restaurar
            </Button>
            <Button size="sm" onClick={handleSave}>
              <Save className="w-4 h-4 mr-2" />
              Guardar
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Información de la Empresa */}
        <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-primary" />
            <h3 className="font-semibold">Información de la Empresa</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nombre de la Empresa</Label>
              <Input
                value={companyInfo.name}
                onChange={(e) => updateCompanyInfo("name", e.target.value)}
                placeholder="Nombre de la empresa"
              />
            </div>
            <div className="space-y-2">
              <Label>NIT</Label>
              <Input
                value={companyInfo.nit}
                onChange={(e) => updateCompanyInfo("nit", e.target.value)}
                placeholder="NIT"
              />
            </div>
            <div className="space-y-2">
              <Label>Teléfono de Contacto</Label>
              <Input
                value={companyInfo.contact}
                onChange={(e) => updateCompanyInfo("contact", e.target.value)}
                placeholder="Teléfono"
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                value={companyInfo.email}
                onChange={(e) => updateCompanyInfo("email", e.target.value)}
                placeholder="Email"
              />
            </div>
            <div className="space-y-2">
              <Label>Sitio Web</Label>
              <Input
                value={companyInfo.website}
                onChange={(e) => updateCompanyInfo("website", e.target.value)}
                placeholder="https://..."
              />
            </div>
            <div className="space-y-2">
              <Label>Dirección</Label>
              <Input
                value={companyInfo.address}
                onChange={(e) => updateCompanyInfo("address", e.target.value)}
                placeholder="Dirección"
              />
            </div>
          </div>
        </div>

        {/* Términos del Contrato */}
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="object">
            <AccordionTrigger>1. Objeto del Contrato</AccordionTrigger>
            <AccordionContent>
              <Textarea
                value={terms.object}
                onChange={(e) => updateTerm("object", e.target.value)}
                rows={4}
                className="resize-y"
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="validity">
            <AccordionTrigger>2. Vigencia y Renovación</AccordionTrigger>
            <AccordionContent>
              <Textarea
                value={terms.validity}
                onChange={(e) => updateTerm("validity", e.target.value)}
                rows={3}
                className="resize-y"
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="payment">
            <AccordionTrigger>3. Valor y Forma de Pago</AccordionTrigger>
            <AccordionContent>
              <Textarea
                value={terms.payment}
                onChange={(e) => updateTerm("payment", e.target.value)}
                rows={4}
                className="resize-y"
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="providerObligations">
            <AccordionTrigger>4. Obligaciones del Prestador</AccordionTrigger>
            <AccordionContent>
              <Textarea
                value={terms.providerObligations}
                onChange={(e) => updateTerm("providerObligations", e.target.value)}
                rows={5}
                className="resize-y"
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="clientObligations">
            <AccordionTrigger>5. Obligaciones del Cliente</AccordionTrigger>
            <AccordionContent>
              <Textarea
                value={terms.clientObligations}
                onChange={(e) => updateTerm("clientObligations", e.target.value)}
                rows={4}
                className="resize-y"
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="equipment">
            <AccordionTrigger>6. Equipos Suministrados (Comodato)</AccordionTrigger>
            <AccordionContent>
              <Textarea
                value={terms.equipment}
                onChange={(e) => updateTerm("equipment", e.target.value)}
                rows={4}
                className="resize-y"
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="suspension">
            <AccordionTrigger>7. Suspensión del Servicio</AccordionTrigger>
            <AccordionContent>
              <Textarea
                value={terms.suspension}
                onChange={(e) => updateTerm("suspension", e.target.value)}
                rows={5}
                className="resize-y"
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="termination">
            <AccordionTrigger>8. Terminación del Contrato</AccordionTrigger>
            <AccordionContent>
              <Textarea
                value={terms.termination}
                onChange={(e) => updateTerm("termination", e.target.value)}
                rows={5}
                className="resize-y"
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="freedom">
            <AccordionTrigger>9. Libertad de Permanencia</AccordionTrigger>
            <AccordionContent>
              <Textarea
                value={terms.freedom}
                onChange={(e) => updateTerm("freedom", e.target.value)}
                rows={4}
                className="resize-y"
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="pqr">
            <AccordionTrigger>10. Peticiones, Quejas y Recursos (PQR)</AccordionTrigger>
            <AccordionContent>
              <Textarea
                value={terms.pqr}
                onChange={(e) => updateTerm("pqr", e.target.value)}
                rows={4}
                className="resize-y"
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="dataProtection">
            <AccordionTrigger>11. Protección de Datos Personales</AccordionTrigger>
            <AccordionContent>
              <Textarea
                value={terms.dataProtection}
                onChange={(e) => updateTerm("dataProtection", e.target.value)}
                rows={4}
                className="resize-y"
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}

export { DEFAULT_TERMS, DEFAULT_COMPANY_INFO };
