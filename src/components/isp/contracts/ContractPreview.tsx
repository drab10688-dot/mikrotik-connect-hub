import { forwardRef, useLayoutEffect, useState } from "react";
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
  serviceOption?: string;
  servicePrice?: string;
  totalPrice?: string;
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

    useLayoutEffect(() => {
      const generateQR = async () => {
        try {
          const verificationData = JSON.stringify({
            contract: clientData.contractNumber,
            client: clientData.clientName,
            id: clientData.identification,
            date: clientData.date,
            company: companyInfo.nit,
          });
          
          const verificationUrl = `${window.location.origin}/verify-contract?data=${btoa(encodeURIComponent(verificationData))}`;
          
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
          setQrCodeUrl("");
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

    const hasServiceOption = clientData.serviceOption && 
      clientData.servicePrice && 
      parseFloat(clientData.servicePrice.replace(/[^0-9.,]/g, "")) > 0;

    return (
      <div
        ref={ref}
        style={{ 
          backgroundColor: "#ffffff",
          color: "#000000",
          padding: "40px",
          maxWidth: "800px",
          margin: "0 auto",
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontSize: "11pt",
          lineHeight: "1.6"
        }}
      >
        {/* Header */}
        <div style={{ 
          marginBottom: "32px", 
          paddingBottom: "24px", 
          borderBottom: "3px double #1a365d" 
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {companyInfo.logoUrl ? (
              <div>
                <img
                  src={companyInfo.logoUrl}
                  alt="Logo"
                  style={{ maxHeight: "80px", maxWidth: "180px", objectFit: "contain" }}
                  crossOrigin="anonymous"
                />
              </div>
            ) : (
              <div style={{ width: "180px" }} />
            )}
            <div style={{ textAlign: "right" }}>
              <h1 style={{ 
                fontSize: "24px", 
                fontWeight: "bold", 
                color: "#1a365d", 
                letterSpacing: "0.05em",
                margin: 0 
              }}>
                {companyInfo.name}
              </h1>
              <p style={{ fontSize: "14px", color: "#4a5568", margin: "4px 0 0 0" }}>NIT: {companyInfo.nit}</p>
              <p style={{ fontSize: "12px", color: "#718096", margin: "4px 0 0 0" }}>{companyInfo.contact}</p>
            </div>
          </div>
        </div>

        {/* Título */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <h2 style={{ 
            fontSize: "18px", 
            fontWeight: "bold", 
            textTransform: "uppercase",
            letterSpacing: "0.15em",
            color: "#1a365d",
            borderBottom: "2px solid #e2e8f0",
            paddingBottom: "12px",
            display: "inline-block",
            margin: 0
          }}>
            Contrato de Prestación de Servicios de Internet
          </h2>
          <div style={{ marginTop: "16px", fontSize: "14px", color: "#4a5568" }}>
            <span style={{ marginRight: "32px" }}><strong>Contrato N°:</strong> {clientData.contractNumber}</span>
            <span><strong>Fecha:</strong> {formatDate(clientData.date)}</span>
          </div>
        </div>

        {/* Introducción */}
        <p style={{ textAlign: "justify", marginBottom: "24px", textIndent: "2em" }}>
          Entre <strong>{companyInfo.name}</strong>, identificada con NIT <strong>{companyInfo.nit}</strong>, 
          representada legalmente, quien en adelante se denominará <strong>EL PRESTADOR</strong>, y 
          <strong> {clientData.clientName}</strong>, identificado(a) con documento de identidad número 
          <strong> {clientData.identification}</strong>, domiciliado(a) en <strong>{clientData.address}</strong>, 
          quien en adelante se denominará <strong>EL SUSCRIPTOR</strong>, se celebra el presente contrato 
          de prestación de servicios de internet, regido por las siguientes cláusulas:
        </p>

        {/* Datos en tabla */}
        <table style={{ width: "100%", marginBottom: "32px", borderCollapse: "collapse" }}>
          <tbody>
            <tr>
              <td style={{ width: "50%", padding: "16px", backgroundColor: "#f7fafc", border: "1px solid #e2e8f0", verticalAlign: "top" }}>
                <h3 style={{ 
                  fontWeight: "bold", 
                  fontSize: "12px", 
                  textTransform: "uppercase",
                  color: "#1a365d",
                  borderBottom: "1px solid #cbd5e0",
                  paddingBottom: "8px",
                  marginBottom: "12px",
                  letterSpacing: "0.1em"
                }}>
                  El Prestador
                </h3>
                <div style={{ fontSize: "13px" }}>
                  <p style={{ margin: "4px 0" }}><strong>Razón Social:</strong> {companyInfo.name}</p>
                  <p style={{ margin: "4px 0" }}><strong>NIT:</strong> {companyInfo.nit}</p>
                  <p style={{ margin: "4px 0" }}><strong>Contacto:</strong> {companyInfo.contact}</p>
                  <p style={{ margin: "4px 0" }}><strong>Email:</strong> {companyInfo.email}</p>
                </div>
              </td>
              <td style={{ width: "50%", padding: "16px", backgroundColor: "#f7fafc", border: "1px solid #e2e8f0", verticalAlign: "top" }}>
                <h3 style={{ 
                  fontWeight: "bold", 
                  fontSize: "12px", 
                  textTransform: "uppercase",
                  color: "#1a365d",
                  borderBottom: "1px solid #cbd5e0",
                  paddingBottom: "8px",
                  marginBottom: "12px",
                  letterSpacing: "0.1em"
                }}>
                  El Suscriptor
                </h3>
                <div style={{ fontSize: "13px" }}>
                  <p style={{ margin: "4px 0" }}><strong>Nombre:</strong> {clientData.clientName}</p>
                  <p style={{ margin: "4px 0" }}><strong>Identificación:</strong> {clientData.identification}</p>
                  <p style={{ margin: "4px 0" }}><strong>Dirección:</strong> {clientData.address}</p>
                  <p style={{ margin: "4px 0" }}><strong>Teléfono:</strong> {clientData.phone}</p>
                  <p style={{ margin: "4px 0" }}><strong>Email:</strong> {clientData.email || "No registrado"}</p>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Plan Contratado */}
        <table style={{ 
          width: "100%",
          marginBottom: "32px", 
          borderCollapse: "collapse"
        }}>
          <tbody>
            <tr>
              <td style={{ 
                backgroundColor: "#1a365d",
                color: "white",
                padding: "16px",
                borderRadius: "8px 8px 0 0"
              }} colSpan={3}>
                <p style={{ 
                  fontWeight: "bold", 
                  fontSize: "12px", 
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  margin: 0
                }}>
                  Servicio Contratado
                </p>
              </td>
            </tr>
            <tr style={{ backgroundColor: "#2d3748" }}>
              <td style={{ 
                width: clientData.speed ? "50%" : "100%", 
                textAlign: "center", 
                padding: "16px",
                color: "white"
              }}>
                <p style={{ fontSize: "10px", textTransform: "uppercase", color: "#a0aec0", margin: 0 }}>Plan</p>
                <p style={{ fontSize: "18px", fontWeight: "bold", margin: "4px 0 0 0", color: "white" }}>{clientData.plan}</p>
              </td>
              {clientData.speed && (
                <td style={{ 
                  width: "50%", 
                  textAlign: "center", 
                  padding: "16px",
                  color: "white"
                }}>
                  <p style={{ fontSize: "10px", textTransform: "uppercase", color: "#a0aec0", margin: 0 }}>Velocidad</p>
                  <p style={{ fontSize: "18px", fontWeight: "bold", margin: "4px 0 0 0", color: "white" }}>{clientData.speed}</p>
                </td>
              )}
            </tr>
            <tr style={{ backgroundColor: "#1a365d" }}>
              <td style={{ 
                width: hasServiceOption ? "33%" : "50%", 
                textAlign: "center", 
                padding: "12px",
                borderTop: "1px solid #4a5568",
                color: "white"
              }}>
                <p style={{ fontSize: "10px", textTransform: "uppercase", color: "#a0aec0", margin: 0 }}>Precio Plan</p>
                <p style={{ fontSize: "14px", fontWeight: "bold", margin: "4px 0 0 0", color: "white" }}>{clientData.price || "$0"}</p>
              </td>
              {hasServiceOption && (
                <td style={{ 
                  width: "33%", 
                  textAlign: "center", 
                  padding: "12px",
                  borderTop: "1px solid #4a5568",
                  color: "white"
                }}>
                  <p style={{ fontSize: "10px", textTransform: "uppercase", color: "#a0aec0", margin: 0 }}>{clientData.serviceOption}</p>
                  <p style={{ fontSize: "14px", fontWeight: "bold", margin: "4px 0 0 0", color: "white" }}>{clientData.servicePrice}</p>
                </td>
              )}
              <td style={{ 
                width: hasServiceOption ? "33%" : "50%", 
                textAlign: "center", 
                padding: "12px",
                borderTop: "1px solid #4a5568",
                color: "white",
                borderRadius: "0 0 8px 8px"
              }}>
                <p style={{ fontSize: "10px", textTransform: "uppercase", color: "#a0aec0", margin: 0 }}>Total Mensual</p>
                <p style={{ fontSize: "18px", fontWeight: "bold", color: "#fbbf24", margin: "4px 0 0 0" }}>
                  {clientData.totalPrice || clientData.price || "$0"}
                </p>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Equipos */}
        {clientData.equipment && clientData.equipment.length > 0 && (
          <div style={{ marginBottom: "32px" }}>
            <h3 style={{ 
              fontWeight: "bold", 
              fontSize: "12px", 
              textTransform: "uppercase",
              color: "#1a365d",
              letterSpacing: "0.1em",
              marginBottom: "12px"
            }}>
              Equipos Entregados en Comodato
            </h3>
            <table style={{ 
              width: "100%",
              backgroundColor: "#fffbeb", 
              border: "2px solid #fbbf24",
              borderCollapse: "collapse"
            }}>
              <tbody>
                <tr>
                  <td style={{ padding: "16px" }}>
                    {clientData.equipment.map((item, index) => (
                      <p key={index} style={{ fontSize: "13px", marginBottom: "4px", margin: index === 0 ? 0 : "4px 0 0 0" }}>
                        <span style={{ color: "#d97706", marginRight: "8px" }}>●</span>
                        {item}
                      </p>
                    ))}
                    <p style={{ fontSize: "11px", marginTop: "12px", fontStyle: "italic", color: "#92400e", margin: "12px 0 0 0" }}>
                      * Los equipos son propiedad de EL PRESTADOR y deben ser devueltos al finalizar el contrato.
                    </p>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Cláusulas */}
        <div style={{ marginBottom: "32px" }}>
          <h3 style={{ 
            fontWeight: "bold", 
            textAlign: "center",
            fontSize: "16px", 
            textTransform: "uppercase",
            color: "#1a365d",
            borderBottom: "2px solid #1a365d",
            paddingBottom: "12px",
            marginBottom: "24px",
            letterSpacing: "0.1em"
          }}>
            Cláusulas del Contrato
          </h3>

          <div>
            <div style={{ marginBottom: "20px" }}>
              <h4 style={{ fontWeight: "bold", color: "#1a365d", marginBottom: "8px", fontSize: "12px" }}>
                CLÁUSULA PRIMERA - OBJETO DEL CONTRATO
              </h4>
              <p style={{ textAlign: "justify", whiteSpace: "pre-line", textIndent: "2em", margin: 0 }}>{terms.object}</p>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <h4 style={{ fontWeight: "bold", color: "#1a365d", marginBottom: "8px", fontSize: "12px" }}>
                CLÁUSULA SEGUNDA - VIGENCIA Y RENOVACIÓN
              </h4>
              <p style={{ textAlign: "justify", whiteSpace: "pre-line", textIndent: "2em", margin: 0 }}>{terms.validity}</p>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <h4 style={{ fontWeight: "bold", color: "#1a365d", marginBottom: "8px", fontSize: "12px" }}>
                CLÁUSULA TERCERA - VALOR Y FORMA DE PAGO
              </h4>
              <p style={{ textAlign: "justify", whiteSpace: "pre-line", textIndent: "2em", margin: 0 }}>{terms.payment}</p>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <h4 style={{ fontWeight: "bold", color: "#1a365d", marginBottom: "8px", fontSize: "12px" }}>
                CLÁUSULA CUARTA - OBLIGACIONES DEL PRESTADOR
              </h4>
              <p style={{ textAlign: "justify", whiteSpace: "pre-line", textIndent: "2em", margin: 0 }}>{terms.providerObligations}</p>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <h4 style={{ fontWeight: "bold", color: "#1a365d", marginBottom: "8px", fontSize: "12px" }}>
                CLÁUSULA QUINTA - OBLIGACIONES DEL SUSCRIPTOR
              </h4>
              <p style={{ textAlign: "justify", whiteSpace: "pre-line", textIndent: "2em", margin: 0 }}>{terms.clientObligations}</p>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <h4 style={{ fontWeight: "bold", color: "#1a365d", marginBottom: "8px", fontSize: "12px" }}>
                CLÁUSULA SEXTA - EQUIPOS EN COMODATO
              </h4>
              <p style={{ textAlign: "justify", whiteSpace: "pre-line", textIndent: "2em", margin: 0 }}>{terms.equipment}</p>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <h4 style={{ fontWeight: "bold", color: "#1a365d", marginBottom: "8px", fontSize: "12px" }}>
                CLÁUSULA SÉPTIMA - SUSPENSIÓN DEL SERVICIO
              </h4>
              <p style={{ textAlign: "justify", whiteSpace: "pre-line", textIndent: "2em", margin: 0 }}>{terms.suspension}</p>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <h4 style={{ fontWeight: "bold", color: "#1a365d", marginBottom: "8px", fontSize: "12px" }}>
                CLÁUSULA OCTAVA - TERMINACIÓN DEL CONTRATO
              </h4>
              <p style={{ textAlign: "justify", whiteSpace: "pre-line", textIndent: "2em", margin: 0 }}>{terms.termination}</p>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <h4 style={{ fontWeight: "bold", color: "#1a365d", marginBottom: "8px", fontSize: "12px" }}>
                CLÁUSULA NOVENA - LIBERTAD DE PERMANENCIA
              </h4>
              <p style={{ textAlign: "justify", whiteSpace: "pre-line", textIndent: "2em", margin: 0 }}>{terms.freedom}</p>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <h4 style={{ fontWeight: "bold", color: "#1a365d", marginBottom: "8px", fontSize: "12px" }}>
                CLÁUSULA DÉCIMA - PETICIONES, QUEJAS Y RECURSOS (PQR)
              </h4>
              <p style={{ textAlign: "justify", whiteSpace: "pre-line", textIndent: "2em", margin: 0 }}>{terms.pqr}</p>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <h4 style={{ fontWeight: "bold", color: "#1a365d", marginBottom: "8px", fontSize: "12px" }}>
                CLÁUSULA UNDÉCIMA - PROTECCIÓN DE DATOS PERSONALES
              </h4>
              <p style={{ textAlign: "justify", whiteSpace: "pre-line", textIndent: "2em", margin: 0 }}>{terms.dataProtection}</p>
            </div>
          </div>
        </div>

        {/* Declaración */}
        <table style={{ 
          width: "100%",
          marginBottom: "32px", 
          backgroundColor: "#f0fdf4",
          border: "2px solid #22c55e",
          borderCollapse: "collapse"
        }}>
          <tbody>
            <tr>
              <td style={{ padding: "20px" }}>
                <p style={{ fontSize: "13px", textAlign: "justify", margin: 0 }}>
                  Las partes declaran que han leído y comprendido cada una de las cláusulas de este contrato, 
                  aceptando expresamente su contenido. EL SUSCRIPTOR declara que la información proporcionada 
                  es veraz y autoriza el uso de sus datos personales para los fines del presente contrato, 
                  conforme a la política de protección de datos de EL PRESTADOR.
                </p>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Firmas */}
        <div style={{ marginTop: "40px", paddingTop: "32px", borderTop: "3px double #1a365d" }}>
          <h3 style={{ 
            fontWeight: "bold", 
            textAlign: "center",
            fontSize: "16px", 
            textTransform: "uppercase",
            color: "#1a365d",
            letterSpacing: "0.1em",
            marginBottom: "8px"
          }}>
            Firmas de Aceptación
          </h3>
          <p style={{ textAlign: "center", fontSize: "13px", color: "#4a5568", marginBottom: "32px" }}>
            En constancia de lo anterior, las partes firman el presente contrato en la fecha indicada.
          </p>
          
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              <tr>
                <td style={{ width: "50%", textAlign: "center", padding: "0 24px", verticalAlign: "bottom" }}>
                  <table style={{ width: "100%", maxWidth: "250px", margin: "0 auto", borderCollapse: "collapse" }}>
                    <tbody>
                      <tr>
                        <td style={{ height: "100px", textAlign: "center", verticalAlign: "bottom", borderBottom: "2px solid #1a365d" }}>
                          {clientSignature && (
                            <img
                              src={clientSignature}
                              alt="Firma del suscriptor"
                              style={{ maxHeight: "90px", maxWidth: "200px" }}
                            />
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <p style={{ fontWeight: "bold", color: "#1a365d", marginTop: "12px", marginBottom: "4px" }}>EL SUSCRIPTOR</p>
                  <p style={{ fontSize: "13px", margin: "4px 0" }}>{clientData.clientName}</p>
                  <p style={{ fontSize: "13px", color: "#4a5568", margin: 0 }}>C.C. {clientData.identification}</p>
                </td>
                <td style={{ width: "50%", textAlign: "center", padding: "0 24px", verticalAlign: "bottom" }}>
                  <table style={{ width: "100%", maxWidth: "250px", margin: "0 auto", borderCollapse: "collapse" }}>
                    <tbody>
                      <tr>
                        <td style={{ height: "100px", textAlign: "center", verticalAlign: "bottom", borderBottom: "2px solid #1a365d" }}>
                          {managerSignature && (
                            <img
                              src={managerSignature}
                              alt="Firma del gerente"
                              style={{ maxHeight: "90px", maxWidth: "200px" }}
                            />
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <p style={{ fontWeight: "bold", color: "#1a365d", marginTop: "12px", marginBottom: "4px" }}>EL PRESTADOR</p>
                  <p style={{ fontSize: "13px", margin: "4px 0" }}>{managerName || companyInfo.managerName || companyInfo.name}</p>
                  <p style={{ fontSize: "13px", color: "#4a5568", margin: 0 }}>Representante Legal</p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Footer con QR */}
        <div style={{ marginTop: "48px", paddingTop: "24px", borderTop: "1px solid #e2e8f0" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              <tr>
                <td style={{ verticalAlign: "middle", width: "50%" }}>
                  <table style={{ borderCollapse: "collapse" }}>
                    <tbody>
                      <tr>
                        <td style={{ verticalAlign: "middle", paddingRight: "12px" }}>
                          {qrCodeUrl && (
                            <img
                              src={qrCodeUrl}
                              alt="QR de verificación"
                              style={{ width: "80px", height: "80px" }}
                            />
                          )}
                        </td>
                        <td style={{ verticalAlign: "middle" }}>
                          <p style={{ fontSize: "11px", fontWeight: "bold", color: "#1a365d", margin: 0 }}>
                            Verificación Digital
                          </p>
                          <p style={{ fontSize: "11px", color: "#718096", margin: "2px 0" }}>
                            Escanee el código QR para
                          </p>
                          <p style={{ fontSize: "11px", color: "#718096", margin: "2px 0" }}>
                            verificar la autenticidad
                          </p>
                          <p style={{ fontSize: "10px", fontFamily: "monospace", color: "#4a5568", marginTop: "4px", margin: "4px 0 0 0" }}>
                            {clientData.contractNumber}
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </td>
                <td style={{ textAlign: "right", verticalAlign: "middle", width: "50%" }}>
                  <p style={{ fontSize: "11px", fontWeight: "bold", color: "#718096", margin: "2px 0" }}>{companyInfo.name}</p>
                  <p style={{ fontSize: "11px", color: "#718096", margin: "2px 0" }}>NIT: {companyInfo.nit}</p>
                  <p style={{ fontSize: "11px", color: "#718096", margin: "2px 0" }}>{companyInfo.contact}</p>
                  <p style={{ fontSize: "11px", color: "#718096", margin: "2px 0" }}>{companyInfo.email}</p>
                  <p style={{ fontSize: "10px", color: "#a0aec0", marginTop: "8px", margin: "8px 0 0 0" }}>
                    Documento generado el {formatDate(new Date().toISOString())}
                  </p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }
);

ContractPreview.displayName = "ContractPreview";
