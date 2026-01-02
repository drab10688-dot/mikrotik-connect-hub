import { forwardRef } from "react";
import type { ContractTerms, CompanyInfo } from "./ContractTermsEditor";

export interface ClientContractData {
  clientName: string;
  identification: string;
  address: string;
  phone: string;
  email: string;
  plan: string;
  speed?: string;
  price?: string;
  equipment?: string[];
  contractNumber: string;
  date: string;
}

interface ContractPreviewProps {
  clientData: ClientContractData;
  terms: ContractTerms;
  companyInfo: CompanyInfo;
  clientSignature?: string;
  companySignature?: string;
}

export const ContractPreview = forwardRef<HTMLDivElement, ContractPreviewProps>(
  ({ clientData, terms, companyInfo, clientSignature, companySignature }, ref) => {
    const formatDate = (dateStr: string) => {
      const date = new Date(dateStr);
      return date.toLocaleDateString("es-CO", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    };

    return (
      <div
        ref={ref}
        className="bg-white text-black p-8 max-w-4xl mx-auto text-sm leading-relaxed"
        style={{ fontFamily: "Arial, sans-serif" }}
      >
        {/* Header */}
        <div className="text-center mb-6 border-b-2 border-gray-300 pb-4">
          <h1 className="text-2xl font-bold text-gray-800">{companyInfo.name}</h1>
          <p className="text-gray-600">NIT: {companyInfo.nit}</p>
        </div>

        <h2 className="text-xl font-bold text-center mb-6">
          CONTRATO DE PRESTACIÓN DE SERVICIOS DE INTERNET
        </h2>

        <p className="text-right mb-6">
          <strong>Número de Contrato:</strong> {clientData.contractNumber}
        </p>

        {/* Datos de la Empresa */}
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <h3 className="font-bold text-lg mb-3 border-b pb-2">DATOS DE LA EMPRESA PRESTADORA</h3>
          <div className="grid grid-cols-2 gap-2">
            <p><strong>Nombre:</strong> {companyInfo.name}</p>
            <p><strong>NIT:</strong> {companyInfo.nit}</p>
            <p><strong>Contacto:</strong> {companyInfo.contact}</p>
            <p><strong>Email:</strong> {companyInfo.email}</p>
          </div>
        </div>

        {/* Datos del Cliente */}
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <h3 className="font-bold text-lg mb-3 border-b pb-2">DATOS DEL CLIENTE</h3>
          <div className="grid grid-cols-2 gap-2">
            <p><strong>Nombre:</strong> {clientData.clientName}</p>
            <p><strong>Identificación:</strong> {clientData.identification}</p>
            <p><strong>Dirección:</strong> {clientData.address}</p>
            <p><strong>Teléfono:</strong> {clientData.phone}</p>
            <p className="col-span-2"><strong>Correo:</strong> {clientData.email}</p>
          </div>
        </div>

        {/* Plan Contratado */}
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <h3 className="font-bold text-lg mb-3 border-b pb-2">PLAN CONTRATADO</h3>
          <p>
            <strong>Plan:</strong> {clientData.plan}
            {clientData.speed && <> | <strong>Velocidad:</strong> {clientData.speed}</>}
            {clientData.price && <> | <strong>Precio:</strong> {clientData.price}</>}
          </p>
        </div>

        {/* Equipos en Préstamo */}
        {clientData.equipment && clientData.equipment.length > 0 && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <h3 className="font-bold text-lg mb-3 border-b pb-2">EQUIPOS EN PRÉSTAMO</h3>
            <ul className="list-disc list-inside">
              {clientData.equipment.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Términos y Condiciones */}
        <div className="mb-6">
          <h3 className="font-bold text-xl text-center mb-4 border-b-2 border-gray-300 pb-2">
            TÉRMINOS Y CONDICIONES
          </h3>

          <div className="space-y-4">
            <div>
              <h4 className="font-bold">1. OBJETO DEL CONTRATO</h4>
              <p className="whitespace-pre-line">{terms.object}</p>
            </div>

            <div>
              <h4 className="font-bold">2. VIGENCIA Y RENOVACIÓN</h4>
              <p className="whitespace-pre-line">{terms.validity}</p>
            </div>

            <div>
              <h4 className="font-bold">3. VALOR Y FORMA DE PAGO</h4>
              <p className="whitespace-pre-line">{terms.payment}</p>
            </div>

            <div>
              <h4 className="font-bold">4. OBLIGACIONES DEL PRESTADOR</h4>
              <p className="whitespace-pre-line">{terms.providerObligations}</p>
            </div>

            <div>
              <h4 className="font-bold">5. OBLIGACIONES DEL CLIENTE</h4>
              <p className="whitespace-pre-line">{terms.clientObligations}</p>
            </div>

            <div>
              <h4 className="font-bold">6. EQUIPOS SUMINISTRADOS (COMODATO)</h4>
              <p className="whitespace-pre-line">{terms.equipment}</p>
            </div>

            <div>
              <h4 className="font-bold">7. SUSPENSIÓN DEL SERVICIO</h4>
              <p className="whitespace-pre-line">{terms.suspension}</p>
            </div>

            <div>
              <h4 className="font-bold">8. TERMINACIÓN DEL CONTRATO</h4>
              <p className="whitespace-pre-line">{terms.termination}</p>
            </div>

            <div>
              <h4 className="font-bold">9. LIBERTAD DE PERMANENCIA</h4>
              <p className="whitespace-pre-line">{terms.freedom}</p>
            </div>

            <div>
              <h4 className="font-bold">10. PETICIONES, QUEJAS Y RECURSOS (PQR)</h4>
              <p className="whitespace-pre-line">{terms.pqr}</p>
            </div>

            <div>
              <h4 className="font-bold">11. PROTECCIÓN DE DATOS PERSONALES</h4>
              <p className="whitespace-pre-line">{terms.dataProtection}</p>
            </div>
          </div>
        </div>

        {/* Sección de Firmas */}
        <div className="mt-8 pt-6 border-t-2 border-gray-300">
          <h3 className="font-bold text-xl text-center mb-6">FIRMAS</h3>
          <p className="text-center mb-6"><strong>Fecha:</strong> {formatDate(clientData.date)}</p>
          
          <div className="grid grid-cols-2 gap-8">
            {/* Firma del Cliente */}
            <div className="text-center">
              <div className="h-24 border-b-2 border-gray-400 mb-2 flex items-end justify-center">
                {clientSignature && (
                  <img
                    src={clientSignature}
                    alt="Firma del cliente"
                    className="max-h-20 max-w-full object-contain"
                  />
                )}
              </div>
              <p className="font-semibold">Firma del Cliente</p>
              <p>{clientData.clientName}</p>
              <p>C.C. {clientData.identification}</p>
            </div>

            {/* Firma del Representante */}
            <div className="text-center">
              <div className="h-24 border-b-2 border-gray-400 mb-2 flex items-end justify-center">
                {companySignature && (
                  <img
                    src={companySignature}
                    alt="Firma representante"
                    className="max-h-20 max-w-full object-contain"
                  />
                )}
              </div>
              <p className="font-semibold">Firma Representante Legal</p>
              <p>{companyInfo.name}</p>
              <p>NIT {companyInfo.nit}</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 pt-4 border-t text-center text-xs text-gray-500">
          <p>{companyInfo.name}</p>
          <p>NIT: {companyInfo.nit} | Contacto: {companyInfo.contact} | Email: {companyInfo.email}</p>
          <p className="mt-2">Generado el {formatDate(new Date().toISOString())}</p>
        </div>
      </div>
    );
  }
);

ContractPreview.displayName = "ContractPreview";
