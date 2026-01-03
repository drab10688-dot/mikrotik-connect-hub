import { jsPDF } from "jspdf";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";

interface InvoiceData {
  invoice_number: string;
  amount: number;
  due_date: string;
  billing_period_start: string;
  billing_period_end: string;
  status: string;
  paid_at: string | null;
  paid_via: string | null;
}

interface ClientData {
  client_name: string;
  phone: string | null;
  address?: string | null;
  email?: string | null;
  identification_number?: string | null;
}

interface CompanyData {
  name: string;
  nit: string;
  address: string;
  phone: string;
  email: string;
  website?: string;
  logoUrl?: string;
}

// Load company data from localStorage (same source as ContractTermsEditor)
function getCompanyFromStorage(): CompanyData {
  const DEFAULT_COMPANY: CompanyData = {
    name: "Suros Comunicaciones SAS ZOMAC",
    nit: "901692609",
    address: "Dirección de la empresa",
    phone: "312 6189282",
    email: "administracion@sur-os.com",
    website: "https://suros-comunicaciones.com",
    logoUrl: "",
  };

  try {
    const saved = localStorage.getItem("isp_company_info");
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        name: parsed.name || DEFAULT_COMPANY.name,
        nit: parsed.nit || DEFAULT_COMPANY.nit,
        address: parsed.address || DEFAULT_COMPANY.address,
        phone: parsed.contact || DEFAULT_COMPANY.phone,
        email: parsed.email || DEFAULT_COMPANY.email,
        website: parsed.website || DEFAULT_COMPANY.website,
        logoUrl: parsed.logoUrl || "",
      };
    }
  } catch (e) {
    console.error("Error loading company info:", e);
  }
  return DEFAULT_COMPANY;
}

// Compress and resize image for smaller PDF
async function loadAndCompressLogo(url: string, maxWidth: number = 150): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ratio = Math.min(maxWidth / img.width, maxWidth / img.height);
      canvas.width = img.width * ratio;
      canvas.height = img.height * ratio;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        // Use JPEG with compression for smaller file size
        resolve(canvas.toDataURL("image/jpeg", 0.6));
      } else {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// Internal function to build the PDF document
async function buildInvoicePDF(
  invoice: InvoiceData,
  client: ClientData,
  company?: CompanyData,
  serviceDescription: string = "Servicio de Internet - Plan Mensual"
): Promise<jsPDF> {
  const companyData = company || getCompanyFromStorage();

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true // Enable compression
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  let y = 15;

  // Professional color palette
  const primaryColor: [number, number, number] = [15, 82, 186]; // Deep blue
  const accentColor: [number, number, number] = [37, 99, 235]; // Bright blue
  const darkColor: [number, number, number] = [17, 24, 39]; // Near black
  const grayColor: [number, number, number] = [107, 114, 128];
  const lightGray: [number, number, number] = [243, 244, 246];

  // Top accent bar
  doc.setFillColor(...primaryColor);
  doc.rect(0, 0, pageWidth, 8, "F");

  y = 20;

  // Logo (compressed)
  let logoWidth = 0;
  if (companyData.logoUrl) {
    try {
      const compressedLogo = await loadAndCompressLogo(companyData.logoUrl, 120);
      if (compressedLogo) {
        doc.addImage(compressedLogo, "JPEG", margin, y, 28, 28);
        logoWidth = 35;
      }
    } catch (error) {
      console.error("Error loading logo:", error);
    }
  }

  // Company name and info
  const companyX = margin + logoWidth;
  doc.setFontSize(16);
  doc.setTextColor(...darkColor);
  doc.setFont("helvetica", "bold");
  doc.text(companyData.name, companyX, y + 6);

  doc.setFontSize(8);
  doc.setTextColor(...grayColor);
  doc.setFont("helvetica", "normal");
  doc.text(`NIT: ${companyData.nit}`, companyX, y + 12);
  doc.text(`${companyData.address} | Tel: ${companyData.phone}`, companyX, y + 17);
  doc.text(`${companyData.email}${companyData.website ? ' | ' + companyData.website : ''}`, companyX, y + 22);

  // Invoice header box (right side)
  const boxWidth = 52;
  const boxX = pageWidth - margin - boxWidth;
  
  doc.setFillColor(...primaryColor);
  doc.roundedRect(boxX, y - 5, boxWidth, 35, 2, 2, "F");
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("FACTURA DE VENTA", boxX + boxWidth / 2, y + 3, { align: "center" });
  
  doc.setFontSize(11);
  doc.text(invoice.invoice_number, boxX + boxWidth / 2, y + 11, { align: "center" });

  // Status badge
  doc.setFontSize(8);
  const statusY = y + 20;
  let statusText = "PENDIENTE";
  let statusBg: [number, number, number] = [251, 191, 36];
  let statusFg: [number, number, number] = [0, 0, 0];
  
  if (invoice.status === "paid") {
    statusText = "✓ PAGADA";
    statusBg = [34, 197, 94];
    statusFg = [255, 255, 255];
  } else if (invoice.status === "overdue") {
    statusText = "VENCIDA";
    statusBg = [239, 68, 68];
    statusFg = [255, 255, 255];
  }
  
  doc.setFillColor(...statusBg);
  doc.roundedRect(boxX + 8, statusY, boxWidth - 16, 8, 1, 1, "F");
  doc.setTextColor(...statusFg);
  doc.setFont("helvetica", "bold");
  doc.text(statusText, boxX + boxWidth / 2, statusY + 5.5, { align: "center" });

  y = 58;

  // Separator
  doc.setDrawColor(...accentColor);
  doc.setLineWidth(0.8);
  doc.line(margin, y, pageWidth - margin, y);

  y += 8;

  // Two-column layout: Client info and Invoice dates
  const colWidth = (pageWidth - margin * 2 - 10) / 2;

  // Client info box
  doc.setFillColor(...lightGray);
  doc.roundedRect(margin, y, colWidth, 42, 2, 2, "F");

  doc.setFontSize(9);
  doc.setTextColor(...accentColor);
  doc.setFont("helvetica", "bold");
  doc.text("FACTURAR A:", margin + 5, y + 7);

  doc.setFontSize(10);
  doc.setTextColor(...darkColor);
  doc.text(client.client_name, margin + 5, y + 14);

  doc.setFontSize(8);
  doc.setTextColor(...grayColor);
  doc.setFont("helvetica", "normal");
  
  let clientY = y + 20;
  if (client.identification_number) {
    doc.text(`CC/NIT: ${client.identification_number}`, margin + 5, clientY);
    clientY += 5;
  }
  if (client.phone) {
    doc.text(`Tel: ${client.phone}`, margin + 5, clientY);
    clientY += 5;
  }
  if (client.address) {
    doc.text(`Dir: ${client.address}`, margin + 5, clientY);
    clientY += 5;
  }
  if (client.email) {
    doc.text(client.email, margin + 5, clientY);
  }

  // Invoice dates box
  const datesX = margin + colWidth + 10;
  doc.setFillColor(...lightGray);
  doc.roundedRect(datesX, y, colWidth, 42, 2, 2, "F");

  doc.setFontSize(9);
  doc.setTextColor(...accentColor);
  doc.setFont("helvetica", "bold");
  doc.text("DETALLES DE FACTURA:", datesX + 5, y + 7);

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  
  const labelX = datesX + 5;
  const valueX = datesX + colWidth - 5;
  
  doc.setTextColor(...grayColor);
  doc.text("Fecha de emisión:", labelX, y + 15);
  doc.setTextColor(...darkColor);
  doc.text(format(new Date(), "dd/MM/yyyy"), valueX, y + 15, { align: "right" });

  doc.setTextColor(...grayColor);
  doc.text("Fecha de vencimiento:", labelX, y + 22);
  doc.setTextColor(...darkColor);
  doc.setFont("helvetica", "bold");
  doc.text(format(parseISO(invoice.due_date), "dd/MM/yyyy"), valueX, y + 22, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setTextColor(...grayColor);
  doc.text("Período facturado:", labelX, y + 29);
  doc.setTextColor(...darkColor);
  const periodStart = format(parseISO(invoice.billing_period_start), "dd MMM", { locale: es });
  const periodEnd = format(parseISO(invoice.billing_period_end), "dd MMM yyyy", { locale: es });
  doc.text(`${periodStart} - ${periodEnd}`, valueX, y + 29, { align: "right" });

  if (invoice.status === "paid" && invoice.paid_at) {
    doc.setTextColor(34, 197, 94);
    doc.text("Fecha de pago:", labelX, y + 36);
    doc.text(format(parseISO(invoice.paid_at), "dd/MM/yyyy"), valueX, y + 36, { align: "right" });
  }

  y += 52;

  // Items table
  const tableWidth = pageWidth - margin * 2;
  
  // Table header
  doc.setFillColor(...primaryColor);
  doc.rect(margin, y, tableWidth, 9, "F");
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("DESCRIPCIÓN DEL SERVICIO", margin + 4, y + 6);
  doc.text("CANT.", margin + tableWidth - 55, y + 6, { align: "center" });
  doc.text("VALOR UNITARIO", margin + tableWidth - 25, y + 6, { align: "right" });

  y += 9;

  // Table row
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(229, 231, 235);
  doc.setLineWidth(0.2);
  doc.rect(margin, y, tableWidth, 12, "S");
  
  doc.setTextColor(...darkColor);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(serviceDescription, margin + 4, y + 7);
  doc.text("1", margin + tableWidth - 55, y + 7, { align: "center" });
  doc.setFont("helvetica", "bold");
  doc.text(`$${invoice.amount.toLocaleString("es-CO")}`, margin + tableWidth - 4, y + 7, { align: "right" });

  y += 12;

  // Empty row for visual balance
  doc.rect(margin, y, tableWidth, 8, "S");
  y += 8;

  // Totals section (right-aligned)
  const totalsWidth = 75;
  const totalsX = pageWidth - margin - totalsWidth;

  y += 5;

  // Subtotal row
  doc.setFillColor(...lightGray);
  doc.rect(totalsX, y, totalsWidth, 9, "F");
  doc.setFontSize(9);
  doc.setTextColor(...grayColor);
  doc.setFont("helvetica", "normal");
  doc.text("Subtotal:", totalsX + 4, y + 6);
  doc.setTextColor(...darkColor);
  doc.text(`$${invoice.amount.toLocaleString("es-CO")}`, totalsX + totalsWidth - 4, y + 6, { align: "right" });

  y += 9;

  // IVA row
  doc.setFillColor(...lightGray);
  doc.rect(totalsX, y, totalsWidth, 9, "F");
  doc.setTextColor(...grayColor);
  doc.text("IVA (0%):", totalsX + 4, y + 6);
  doc.setTextColor(...darkColor);
  doc.text("$0", totalsX + totalsWidth - 4, y + 6, { align: "right" });

  y += 9;

  // Total row
  doc.setFillColor(...primaryColor);
  doc.rect(totalsX, y, totalsWidth, 12, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("TOTAL A PAGAR:", totalsX + 4, y + 8);
  doc.text(`$${invoice.amount.toLocaleString("es-CO")}`, totalsX + totalsWidth - 4, y + 8, { align: "right" });

  y += 22;

  // Payment info (if paid)
  if (invoice.status === "paid") {
    doc.setFillColor(220, 252, 231);
    doc.roundedRect(margin, y, tableWidth, 14, 2, 2, "F");
    doc.setTextColor(22, 101, 52);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("✓ PAGO CONFIRMADO", margin + 4, y + 6);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const payMethod = invoice.paid_via || "No especificado";
    doc.text(`Método de pago: ${payMethod}`, margin + 4, y + 11);
    y += 18;
  }

  // Notes section
  doc.setFillColor(254, 252, 232);
  doc.roundedRect(margin, y, tableWidth, 18, 2, 2, "F");
  doc.setTextColor(146, 64, 14);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("NOTA:", margin + 4, y + 6);
  doc.setFont("helvetica", "normal");
  doc.text("El servicio puede ser suspendido si no se realiza el pago antes del vencimiento.", margin + 18, y + 6);
  doc.text(`Para consultas: ${companyData.phone} | ${companyData.email}`, margin + 4, y + 13);

  // Footer
  const footerY = pageHeight - 15;
  
  doc.setFillColor(...primaryColor);
  doc.rect(0, footerY - 5, pageWidth, 20, "F");
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.text(`${companyData.name} | NIT: ${companyData.nit}`, pageWidth / 2, footerY, { align: "center" });
  doc.text("Documento generado electrónicamente - Conserve este comprobante para cualquier reclamación", pageWidth / 2, footerY + 5, { align: "center" });

  return doc;
}

// Generate and download PDF
export async function generateInvoicePDF(
  invoice: InvoiceData,
  client: ClientData,
  company?: CompanyData,
  serviceDescription: string = "Servicio de Internet - Plan Mensual"
): Promise<void> {
  const doc = await buildInvoicePDF(invoice, client, company, serviceDescription);
  doc.save(`Factura_${invoice.invoice_number}.pdf`);
}

// Generate PDF as Blob for uploading/sending
export async function generateInvoicePDFBlob(
  invoice: InvoiceData,
  client: ClientData,
  company?: CompanyData,
  serviceDescription: string = "Servicio de Internet - Plan Mensual"
): Promise<Blob> {
  const doc = await buildInvoicePDF(invoice, client, company, serviceDescription);
  return doc.output('blob');
}
