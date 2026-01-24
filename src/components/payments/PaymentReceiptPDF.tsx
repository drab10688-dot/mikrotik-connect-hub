import { jsPDF } from "jspdf";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface ReceiptData {
  receiptNumber: string;
  clientName: string;
  clientId: string;
  username: string;
  phone: string | null;
  email: string | null;
  invoiceNumber: string;
  invoiceAmount: number;
  paidAmount: number;
  paymentMethod: string;
  paymentReference: string | null;
  paymentDate: Date;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  planOrSpeed: string | null;
}

interface CompanyInfo {
  name: string;
  nit: string;
  contact: string;
  email: string;
  website: string;
  address: string;
  logoUrl?: string;
  managerName?: string;
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia Bancaria",
  nequi: "Nequi",
  daviplata: "Daviplata",
  pse: "PSE",
  tarjeta: "Tarjeta Crédito/Débito",
  otro: "Otro",
};

function getCompanyInfo(): CompanyInfo {
  const saved = localStorage.getItem("isp_company_info");
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      // fallback
    }
  }
  return {
    name: "WISP Manager",
    nit: "",
    contact: "",
    email: "",
    website: "",
    address: "",
  };
}

export async function generatePaymentReceiptPDF(data: ReceiptData): Promise<jsPDF> {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: [80, 185], // Formato tipo ticket, más alto para incluir logo
  });

  const pageWidth = 80;
  const margin = 5;
  const contentWidth = pageWidth - margin * 2;
  let y = 8;

  // Get company info from contract terms
  const companyInfo = getCompanyInfo();

  // Helper function for centered text
  const centerText = (text: string, yPos: number, fontSize: number = 10) => {
    doc.setFontSize(fontSize);
    const textWidth = doc.getTextWidth(text);
    doc.text(text, (pageWidth - textWidth) / 2, yPos);
  };

  // Helper function for left-right text
  const leftRightText = (left: string, right: string, yPos: number) => {
    doc.setFontSize(9);
    doc.text(left, margin, yPos);
    const rightWidth = doc.getTextWidth(right);
    doc.text(right, pageWidth - margin - rightWidth, yPos);
  };

  // Add logo if available
  if (companyInfo.logoUrl) {
    try {
      // Load image and add to PDF
      const img = new Image();
      img.crossOrigin = "anonymous";
      
      await new Promise<void>((resolve, reject) => {
        img.onload = () => {
          try {
            // Calculate dimensions to fit width while maintaining aspect ratio
            const maxWidth = 35;
            const maxHeight = 20;
            let imgWidth = img.width;
            let imgHeight = img.height;
            
            // Scale down if necessary
            if (imgWidth > maxWidth) {
              const ratio = maxWidth / imgWidth;
              imgWidth = maxWidth;
              imgHeight = imgHeight * ratio;
            }
            if (imgHeight > maxHeight) {
              const ratio = maxHeight / imgHeight;
              imgHeight = maxHeight;
              imgWidth = imgWidth * ratio;
            }
            
            // Center the logo
            const logoX = (pageWidth - imgWidth) / 2;
            doc.addImage(img, "PNG", logoX, y, imgWidth, imgHeight);
            y += imgHeight + 3;
            resolve();
          } catch (e) {
            console.error("Error adding logo to PDF:", e);
            resolve(); // Continue without logo
          }
        };
        img.onerror = () => {
          console.error("Error loading logo image");
          resolve(); // Continue without logo
        };
        img.src = companyInfo.logoUrl!;
      });
    } catch (e) {
      console.error("Error processing logo:", e);
    }
  }

  // Header - Company Name
  doc.setFont("helvetica", "bold");
  centerText(companyInfo.name.toUpperCase(), y, 11);
  y += 4;

  // Company NIT
  if (companyInfo.nit) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    centerText(`NIT: ${companyInfo.nit}`, y, 8);
    y += 3;
  }

  // Company Contact
  if (companyInfo.contact) {
    doc.setFontSize(7);
    centerText(`Tel: ${companyInfo.contact}`, y, 7);
    y += 3;
  }

  // Company Address
  if (companyInfo.address && companyInfo.address !== "Dirección de la empresa") {
    doc.setFontSize(7);
    centerText(companyInfo.address, y, 7);
    y += 3;
  }

  y += 2;

  doc.setFont("helvetica", "bold");
  centerText("RECIBO DE PAGO", y, 10);
  y += 5;

  // Divider
  doc.setDrawColor(0);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 4;

  // Receipt info
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(`Recibo: ${data.receiptNumber}`, margin, y);
  y += 4;

  doc.setFont("helvetica", "normal");
  doc.text(`Fecha: ${format(data.paymentDate, "dd/MM/yyyy HH:mm", { locale: es })}`, margin, y);
  y += 5;

  // Divider
  doc.line(margin, y, pageWidth - margin, y);
  y += 4;

  // Client info
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("CLIENTE", margin, y);
  y += 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(data.clientName, margin, y);
  y += 3.5;
  doc.text(`Usuario: ${data.username}`, margin, y);
  y += 3.5;
  if (data.clientId) {
    doc.text(`CC/NIT: ${data.clientId}`, margin, y);
    y += 3.5;
  }
  if (data.phone) {
    doc.text(`Tel: ${data.phone}`, margin, y);
    y += 3.5;
  }
  y += 2;

  // Divider
  doc.line(margin, y, pageWidth - margin, y);
  y += 4;

  // Invoice details
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("DETALLE", margin, y);
  y += 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  leftRightText("Factura:", data.invoiceNumber, y);
  y += 3.5;

  if (data.planOrSpeed) {
    leftRightText("Plan:", data.planOrSpeed, y);
    y += 3.5;
  }

  const periodStart = format(new Date(data.billingPeriodStart), "dd/MM/yy", { locale: es });
  const periodEnd = format(new Date(data.billingPeriodEnd), "dd/MM/yy", { locale: es });
  leftRightText("Período:", `${periodStart} - ${periodEnd}`, y);
  y += 5;

  // Divider
  doc.line(margin, y, pageWidth - margin, y);
  y += 4;

  // Payment details
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("PAGO", margin, y);
  y += 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  leftRightText("Método:", PAYMENT_METHOD_LABELS[data.paymentMethod] || data.paymentMethod, y);
  y += 3.5;

  if (data.paymentReference) {
    leftRightText("Referencia:", data.paymentReference, y);
    y += 3.5;
  }

  y += 2;

  // Amount box
  doc.setDrawColor(0);
  doc.setFillColor(240, 240, 240);
  doc.roundedRect(margin, y, contentWidth, 12, 2, 2, "F");
  
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  centerText("TOTAL PAGADO", y + 4, 8);
  
  doc.setFontSize(14);
  centerText(`$${data.paidAmount.toLocaleString()}`, y + 10, 14);
  y += 16;

  // Divider
  doc.line(margin, y, pageWidth - margin, y);
  y += 4;

  // Footer
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  centerText("Gracias por su pago", y, 8);
  y += 3;
  centerText("Este documento es un comprobante válido", y, 7);
  y += 3;

  // Company email/website in footer
  if (companyInfo.email) {
    centerText(companyInfo.email, y, 6);
    y += 2.5;
  }
  if (companyInfo.website) {
    centerText(companyInfo.website, y, 6);
    y += 2.5;
  }

  centerText(`Generado: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, y, 6);

  return doc;
}

export async function downloadPaymentReceipt(data: ReceiptData) {
  const doc = await generatePaymentReceiptPDF(data);
  doc.save(`recibo_${data.receiptNumber}.pdf`);
}

export async function getReceiptBlob(data: ReceiptData): Promise<Blob> {
  const doc = await generatePaymentReceiptPDF(data);
  return doc.output("blob");
}
