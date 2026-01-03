import { forwardRef, useEffect, useState } from "react";
import QRCode from "qrcode";
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
  managerSignature?: string;
  managerName?: string;
}

export const ContractPreview = forwardRef<HTMLDivElement, ContractPreviewProps>(
  ({ clientData, terms, companyInfo, clientSignature, managerSignature, managerName }, ref) => {
    const [qrCodeUrl, setQrCodeUrl] = useState<string>("");

    // Generar QR con datos de verificación
    useEffect(() => {
      const generateQR = async () => {
        const verificationData = JSON.stringify({
          contract: clientData.contractNumber,
          client: clientData.clientName,
          id: clientData.identification,
          date: clientData.date,
          company: companyInfo.nit,
        });
        
        // Crear URL de verificación (base64 encoded)
        const verificationUrl = `${window.location.origin}/verify-contract?data=${btoa(verificationData)}`;
        
        try {
          const qrDataUrl = await QRCode.toDataURL(verificationUrl, {
            width: 100,
            margin: 1,
            color: {
              dark: "#1a365d",
              light: "#ffffff",
            },
          });
          setQrCodeUrl(qrDataUrl);
        } catch (err) {
          console.error("Error generating QR:", err);
        }
      };

      generateQR();
    }, [clientData.contractNumber, clientData.clientName, clientData.identification, clientData.date, companyInfo.nit]);

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
        className="bg-white text-black p-10 max-w-4xl mx-auto leading-relaxed"
        style={{ 
          fontFamily: "'Georgia', 'Times New Roman', serif",
          fontSize: "11pt",
          lineHeight: "1.6"
        }}
      >
        {/* Header Elegante */}
        <div className="mb-8 pb-6" style={{ borderBottom: "3px double #1a365d" }}>
          <div className="flex items-center justify-between">
            {companyInfo.logoUrl ? (
              <div className="flex-shrink-0">
                <img
                  src={companyInfo.logoUrl}
                  alt="Logo de la empresa"
                  className="object-contain"
                  style={{ maxHeight: "80px", maxWidth: "180px" }}
                  crossOrigin="anonymous"
                />
              </div>
            ) : (
              <div className="w-[180px]" />
            )}
            <div className="text-right">
              <h1 className="text-2xl font-bold" style={{ color: "#1a365d", letterSpacing: "0.05em" }}>
                {companyInfo.name}
              </h1>
              <p className="text-sm" style={{ color: "#4a5568" }}>NIT: {companyInfo.nit}</p>
              <p className="text-xs mt-1" style={{ color: "#718096" }}>{companyInfo.contact}</p>
            </div>
          </div>
        </div>

        {/* Título del Contrato */}
        <div className="text-center mb-8">
          <h2 
            className="text-xl font-bold tracking-wide uppercase"
            style={{ 
              color: "#1a365d",
              letterSpacing: "0.15em",
              borderBottom: "2px solid #e2e8f0",
              paddingBottom: "12px",
              display: "inline-block"
            }}
          >
            Contrato de Prestación de Servicios de Internet
          </h2>
          <div className="mt-4 flex justify-center gap-8 text-sm" style={{ color: "#4a5568" }}>
            <span><strong>Contrato N°:</strong> {clientData.contractNumber}</span>
            <span><strong>Fecha:</strong> {formatDate(clientData.date)}</span>
          </div>
        </div>

        {/* Introducción */}
        <p className="text-justify mb-6" style={{ textIndent: "2em" }}>
          Entre <strong>{companyInfo.name}</strong>, identificada con NIT <strong>{companyInfo.nit}</strong>, 
          representada legalmente, quien en adelante se denominará <strong>EL PRESTADOR</strong>, y 
          <strong> {clientData.clientName}</strong>, identificado(a) con documento de identidad número 
          <strong> {clientData.identification}</strong>, domiciliado(a) en <strong>{clientData.address}</strong>, 
          quien en adelante se denominará <strong>EL SUSCRIPTOR</strong>, se celebra el presente contrato 
          de prestación de servicios de internet, regido por las siguientes cláusulas:
        </p>

        {/* Datos en Recuadros Elegantes */}
        <div className="grid grid-cols-2 gap-6 mb-8">
          {/* Datos del Prestador */}
          <div 
            className="p-4 rounded"
            style={{ 
              backgroundColor: "#f7fafc",
              border: "1px solid #e2e8f0"
            }}
          >
            <h3 
              className="font-bold text-sm uppercase mb-3 pb-2"
              style={{ 
                color: "#1a365d",
                borderBottom: "1px solid #cbd5e0",
                letterSpacing: "0.1em"
              }}
            >
              El Prestador
            </h3>
            <div className="space-y-1 text-sm">
              <p><strong>Razón Social:</strong> {companyInfo.name}</p>
              <p><strong>NIT:</strong> {companyInfo.nit}</p>
              <p><strong>Contacto:</strong> {companyInfo.contact}</p>
              <p><strong>Email:</strong> {companyInfo.email}</p>
            </div>
          </div>

          {/* Datos del Suscriptor */}
          <div 
            className="p-4 rounded"
            style={{ 
              backgroundColor: "#f7fafc",
              border: "1px solid #e2e8f0"
            }}
          >
            <h3 
              className="font-bold text-sm uppercase mb-3 pb-2"
              style={{ 
                color: "#1a365d",
                borderBottom: "1px solid #cbd5e0",
                letterSpacing: "0.1em"
              }}
            >
              El Suscriptor
            </h3>
            <div className="space-y-1 text-sm">
              <p><strong>Nombre:</strong> {clientData.clientName}</p>
              <p><strong>Identificación:</strong> {clientData.identification}</p>
              <p><strong>Dirección:</strong> {clientData.address}</p>
              <p><strong>Teléfono:</strong> {clientData.phone}</p>
              <p><strong>Email:</strong> {clientData.email || "No registrado"}</p>
            </div>
          </div>
        </div>

        {/* Plan Contratado */}
        <div 
          className="mb-8 p-5 rounded"
          style={{ 
            background: "linear-gradient(135deg, #1a365d 0%, #2d3748 100%)",
            color: "white"
          }}
        >
          <h3 className="font-bold text-sm uppercase mb-3" style={{ letterSpacing: "0.1em" }}>
            Servicio Contratado
          </h3>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xs uppercase opacity-75">Plan</p>
              <p className="text-lg font-bold">{clientData.plan}</p>
            </div>
            {clientData.speed && (
              <div>
                <p className="text-xs uppercase opacity-75">Velocidad</p>
                <p className="text-lg font-bold">{clientData.speed}</p>
              </div>
            )}
            {clientData.price && (
              <div>
                <p className="text-xs uppercase opacity-75">Valor Mensual</p>
                <p className="text-lg font-bold">{clientData.price}</p>
              </div>
            )}
          </div>
        </div>

        {/* Equipos en Comodato */}
        {clientData.equipment && clientData.equipment.length > 0 && (
          <div className="mb-8">
            <h3 
              className="font-bold text-sm uppercase mb-3"
              style={{ color: "#1a365d", letterSpacing: "0.1em" }}
            >
              Equipos Entregados en Comodato
            </h3>
            <div 
              className="p-4 rounded"
              style={{ backgroundColor: "#fffbeb", border: "1px solid #fbbf24" }}
            >
              <ul className="grid grid-cols-2 gap-2">
                {clientData.equipment.map((item, index) => (
                  <li key={index} className="flex items-center gap-2 text-sm">
                    <span style={{ color: "#d97706" }}>●</span>
                    {item}
                  </li>
                ))}
              </ul>
              <p className="text-xs mt-3 italic" style={{ color: "#92400e" }}>
                * Los equipos son propiedad de EL PRESTADOR y deben ser devueltos al finalizar el contrato.
              </p>
            </div>
          </div>
        )}

        {/* Términos y Condiciones */}
        <div className="mb-8">
          <h3 
            className="font-bold text-center text-lg uppercase mb-6 pb-3"
            style={{ 
              color: "#1a365d",
              borderBottom: "2px solid #1a365d",
              letterSpacing: "0.1em"
            }}
          >
            Cláusulas del Contrato
          </h3>

          <div className="space-y-5">
            <div>
              <h4 className="font-bold mb-2" style={{ color: "#1a365d" }}>
                CLÁUSULA PRIMERA - OBJETO DEL CONTRATO
              </h4>
              <p className="text-justify whitespace-pre-line" style={{ textIndent: "2em" }}>{terms.object}</p>
            </div>

            <div>
              <h4 className="font-bold mb-2" style={{ color: "#1a365d" }}>
                CLÁUSULA SEGUNDA - VIGENCIA Y RENOVACIÓN
              </h4>
              <p className="text-justify whitespace-pre-line" style={{ textIndent: "2em" }}>{terms.validity}</p>
            </div>

            <div>
              <h4 className="font-bold mb-2" style={{ color: "#1a365d" }}>
                CLÁUSULA TERCERA - VALOR Y FORMA DE PAGO
              </h4>
              <p className="text-justify whitespace-pre-line" style={{ textIndent: "2em" }}>{terms.payment}</p>
            </div>

            <div>
              <h4 className="font-bold mb-2" style={{ color: "#1a365d" }}>
                CLÁUSULA CUARTA - OBLIGACIONES DEL PRESTADOR
              </h4>
              <p className="text-justify whitespace-pre-line" style={{ textIndent: "2em" }}>{terms.providerObligations}</p>
            </div>

            <div>
              <h4 className="font-bold mb-2" style={{ color: "#1a365d" }}>
                CLÁUSULA QUINTA - OBLIGACIONES DEL SUSCRIPTOR
              </h4>
              <p className="text-justify whitespace-pre-line" style={{ textIndent: "2em" }}>{terms.clientObligations}</p>
            </div>

            <div>
              <h4 className="font-bold mb-2" style={{ color: "#1a365d" }}>
                CLÁUSULA SEXTA - EQUIPOS EN COMODATO
              </h4>
              <p className="text-justify whitespace-pre-line" style={{ textIndent: "2em" }}>{terms.equipment}</p>
            </div>

            <div>
              <h4 className="font-bold mb-2" style={{ color: "#1a365d" }}>
                CLÁUSULA SÉPTIMA - SUSPENSIÓN DEL SERVICIO
              </h4>
              <p className="text-justify whitespace-pre-line" style={{ textIndent: "2em" }}>{terms.suspension}</p>
            </div>

            <div>
              <h4 className="font-bold mb-2" style={{ color: "#1a365d" }}>
                CLÁUSULA OCTAVA - TERMINACIÓN DEL CONTRATO
              </h4>
              <p className="text-justify whitespace-pre-line" style={{ textIndent: "2em" }}>{terms.termination}</p>
            </div>

            <div>
              <h4 className="font-bold mb-2" style={{ color: "#1a365d" }}>
                CLÁUSULA NOVENA - LIBERTAD DE PERMANENCIA
              </h4>
              <p className="text-justify whitespace-pre-line" style={{ textIndent: "2em" }}>{terms.freedom}</p>
            </div>

            <div>
              <h4 className="font-bold mb-2" style={{ color: "#1a365d" }}>
                CLÁUSULA DÉCIMA - PETICIONES, QUEJAS Y RECURSOS (PQR)
              </h4>
              <p className="text-justify whitespace-pre-line" style={{ textIndent: "2em" }}>{terms.pqr}</p>
            </div>

            <div>
              <h4 className="font-bold mb-2" style={{ color: "#1a365d" }}>
                CLÁUSULA UNDÉCIMA - PROTECCIÓN DE DATOS PERSONALES
              </h4>
              <p className="text-justify whitespace-pre-line" style={{ textIndent: "2em" }}>{terms.dataProtection}</p>
            </div>
          </div>
        </div>

        {/* Declaración de Aceptación */}
        <div 
          className="mb-8 p-5 text-justify rounded"
          style={{ 
            backgroundColor: "#f0fdf4",
            border: "1px solid #22c55e"
          }}
        >
          <p className="text-sm">
            Las partes declaran que han leído y comprendido cada una de las cláusulas de este contrato, 
            aceptando expresamente su contenido. EL SUSCRIPTOR declara que la información proporcionada 
            es veraz y autoriza el uso de sus datos personales para los fines del presente contrato, 
            conforme a la política de protección de datos de EL PRESTADOR.
          </p>
        </div>

        {/* Sección de Firmas */}
        <div className="mt-10 pt-8" style={{ borderTop: "3px double #1a365d" }}>
          <h3 
            className="font-bold text-center text-lg uppercase mb-2"
            style={{ color: "#1a365d", letterSpacing: "0.1em" }}
          >
            Firmas de Aceptación
          </h3>
          <p className="text-center text-sm mb-8" style={{ color: "#4a5568" }}>
            En constancia de lo anterior, las partes firman el presente contrato en la fecha indicada.
          </p>
          
          <div className="grid grid-cols-2 gap-12">
            {/* Firma del Suscriptor */}
            <div className="text-center">
              <div 
                className="h-28 mb-3 flex items-end justify-center mx-auto"
                style={{ 
                  borderBottom: "2px solid #1a365d",
                  maxWidth: "250px"
                }}
              >
                {clientSignature && (
                  <img
                    src={clientSignature}
                    alt="Firma del suscriptor"
                    className="max-h-24 max-w-full object-contain"
                  />
                )}
              </div>
              <p className="font-bold" style={{ color: "#1a365d" }}>EL SUSCRIPTOR</p>
              <p className="text-sm mt-1">{clientData.clientName}</p>
              <p className="text-sm" style={{ color: "#4a5568" }}>C.C. {clientData.identification}</p>
            </div>

            {/* Firma del Representante Legal */}
            <div className="text-center">
              <div 
                className="h-28 mb-3 flex items-end justify-center mx-auto"
                style={{ 
                  borderBottom: "2px solid #1a365d",
                  maxWidth: "250px"
                }}
              >
                {managerSignature && (
                  <img
                    src={managerSignature}
                    alt="Firma del gerente"
                    className="max-h-24 max-w-full object-contain"
                  />
                )}
              </div>
              <p className="font-bold" style={{ color: "#1a365d" }}>EL PRESTADOR</p>
              <p className="text-sm mt-1">{managerName || companyInfo.name}</p>
              <p className="text-sm" style={{ color: "#4a5568" }}>Representante Legal</p>
            </div>
          </div>
        </div>

        {/* Footer con QR de Verificación */}
        <div 
          className="mt-12 pt-6"
          style={{ borderTop: "1px solid #e2e8f0" }}
        >
          <div className="flex items-center justify-between">
            {/* QR Code */}
            <div className="flex items-center gap-3">
              {qrCodeUrl && (
                <img
                  src={qrCodeUrl}
                  alt="QR de verificación"
                  className="w-20 h-20"
                />
              )}
              <div className="text-left">
                <p className="text-xs font-semibold" style={{ color: "#1a365d" }}>
                  Verificación Digital
                </p>
                <p className="text-xs" style={{ color: "#718096" }}>
                  Escanee el código QR para
                </p>
                <p className="text-xs" style={{ color: "#718096" }}>
                  verificar la autenticidad
                </p>
                <p className="text-xs font-mono mt-1" style={{ color: "#4a5568" }}>
                  {clientData.contractNumber}
                </p>
              </div>
            </div>

            {/* Company Info */}
            <div className="text-right">
              <div className="text-xs" style={{ color: "#718096" }}>
                <p className="font-semibold">{companyInfo.name}</p>
                <p>NIT: {companyInfo.nit}</p>
                <p>{companyInfo.contact}</p>
                <p>{companyInfo.email}</p>
              </div>
              <p className="text-xs mt-2" style={{ color: "#a0aec0" }}>
                Documento generado el {formatDate(new Date().toISOString())}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

ContractPreview.displayName = "ContractPreview";
