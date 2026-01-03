import { jsPDF } from "jspdf";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import omnilinkLogo from "@/assets/omnilink-logo.jpeg";

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
  city: string;
}

// Default company data - can be customized later
const defaultCompany: CompanyData = {
  name: "OmniLink S.A.S",
  nit: "901.234.567-8",
  address: "Calle Principal #123",
  phone: "+57 300 123 4567",
  email: "facturacion@omnilink.com",
  city: "Colombia"
};

export async function generateInvoicePDF(
  invoice: InvoiceData,
  client: ClientData,
  company: CompanyData = defaultCompany,
  serviceDescription: string = "Servicio de Internet - Plan Mensual"
): Promise<void> {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4"
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  let y = 20;

  // Colors
  const primaryColor: [number, number, number] = [0, 150, 199]; // Cyan-like color
  const darkColor: [number, number, number] = [30, 41, 59]; // Slate-800
  const mutedColor: [number, number, number] = [100, 116, 139]; // Slate-500

  // Load and add logo
  try {
    const img = new Image();
    img.src = omnilinkLogo;
    await new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
    });
    doc.addImage(img, "JPEG", margin, y, 45, 45);
  } catch (error) {
    console.error("Error loading logo:", error);
  }

  // Company info (right side of logo)
  doc.setFontSize(18);
  doc.setTextColor(...darkColor);
  doc.setFont("helvetica", "bold");
  doc.text(company.name, margin + 55, y + 10);

  doc.setFontSize(9);
  doc.setTextColor(...mutedColor);
  doc.setFont("helvetica", "normal");
  doc.text(`NIT: ${company.nit}`, margin + 55, y + 18);
  doc.text(company.address, margin + 55, y + 24);
  doc.text(`${company.city}`, margin + 55, y + 30);
  doc.text(`Tel: ${company.phone}`, margin + 55, y + 36);
  doc.text(company.email, margin + 55, y + 42);

  // Invoice title and number box (right side)
  const boxWidth = 55;
  const boxX = pageWidth - margin - boxWidth;
  doc.setFillColor(...primaryColor);
  doc.roundedRect(boxX, y, boxWidth, 25, 3, 3, "F");
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("FACTURA", boxX + boxWidth / 2, y + 10, { align: "center" });
  
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(invoice.invoice_number, boxX + boxWidth / 2, y + 18, { align: "center" });

  // Status badge
  y += 30;
  const statusX = boxX + boxWidth / 2;
  if (invoice.status === "paid") {
    doc.setFillColor(34, 197, 94); // Green
    doc.roundedRect(boxX + 5, y, boxWidth - 10, 10, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.text("PAGADA", statusX, y + 7, { align: "center" });
  } else if (invoice.status === "overdue") {
    doc.setFillColor(239, 68, 68); // Red
    doc.roundedRect(boxX + 5, y, boxWidth - 10, 10, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.text("VENCIDA", statusX, y + 7, { align: "center" });
  } else {
    doc.setFillColor(251, 191, 36); // Amber
    doc.roundedRect(boxX + 5, y, boxWidth - 10, 10, 2, 2, "F");
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(10);
    doc.text("PENDIENTE", statusX, y + 7, { align: "center" });
  }

  y = 75;

  // Separator line
  doc.setDrawColor(...primaryColor);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);

  y += 10;

  // Client info section
  doc.setFillColor(241, 245, 249); // Slate-100
  doc.roundedRect(margin, y, pageWidth - margin * 2, 35, 3, 3, "F");

  doc.setFontSize(11);
  doc.setTextColor(...primaryColor);
  doc.setFont("helvetica", "bold");
  doc.text("DATOS DEL CLIENTE", margin + 5, y + 8);

  doc.setFontSize(10);
  doc.setTextColor(...darkColor);
  doc.setFont("helvetica", "normal");
  doc.text(`Nombre: ${client.client_name}`, margin + 5, y + 16);
  
  if (client.identification_number) {
    doc.text(`Documento: ${client.identification_number}`, margin + 5, y + 23);
  }
  
  if (client.phone) {
    doc.text(`Teléfono: ${client.phone}`, margin + 5, y + 30);
  }

  // Right column of client info
  if (client.address) {
    doc.text(`Dirección: ${client.address}`, pageWidth / 2, y + 16);
  }
  if (client.email) {
    doc.text(`Email: ${client.email}`, pageWidth / 2, y + 23);
  }

  y += 45;

  // Invoice dates section
  const dateBoxWidth = (pageWidth - margin * 2 - 10) / 3;
  
  // Emission date
  doc.setFillColor(...primaryColor);
  doc.roundedRect(margin, y, dateBoxWidth, 20, 2, 2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("FECHA DE EMISIÓN", margin + dateBoxWidth / 2, y + 7, { align: "center" });
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(format(new Date(), "dd/MM/yyyy"), margin + dateBoxWidth / 2, y + 15, { align: "center" });

  // Due date
  doc.setFillColor(...primaryColor);
  doc.roundedRect(margin + dateBoxWidth + 5, y, dateBoxWidth, 20, 2, 2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("FECHA DE VENCIMIENTO", margin + dateBoxWidth + 5 + dateBoxWidth / 2, y + 7, { align: "center" });
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(format(parseISO(invoice.due_date), "dd/MM/yyyy"), margin + dateBoxWidth + 5 + dateBoxWidth / 2, y + 15, { align: "center" });

  // Billing period
  doc.setFillColor(...primaryColor);
  doc.roundedRect(margin + (dateBoxWidth + 5) * 2, y, dateBoxWidth, 20, 2, 2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("PERÍODO FACTURADO", margin + (dateBoxWidth + 5) * 2 + dateBoxWidth / 2, y + 7, { align: "center" });
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const periodText = `${format(parseISO(invoice.billing_period_start), "dd MMM", { locale: es })} - ${format(parseISO(invoice.billing_period_end), "dd MMM yyyy", { locale: es })}`;
  doc.text(periodText, margin + (dateBoxWidth + 5) * 2 + dateBoxWidth / 2, y + 15, { align: "center" });

  y += 30;

  // Items table header
  doc.setFillColor(...darkColor);
  doc.rect(margin, y, pageWidth - margin * 2, 10, "F");
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("DESCRIPCIÓN", margin + 5, y + 7);
  doc.text("CANTIDAD", pageWidth - margin - 80, y + 7, { align: "center" });
  doc.text("VALOR", pageWidth - margin - 20, y + 7, { align: "right" });

  y += 10;

  // Items table body
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(226, 232, 240); // Slate-200
  doc.setLineWidth(0.3);

  // Service row
  doc.setTextColor(...darkColor);
  doc.setFont("helvetica", "normal");
  doc.rect(margin, y, pageWidth - margin * 2, 12, "S");
  doc.text(serviceDescription, margin + 5, y + 8);
  doc.text("1", pageWidth - margin - 80, y + 8, { align: "center" });
  doc.text(`$${invoice.amount.toLocaleString("es-CO")}`, pageWidth - margin - 5, y + 8, { align: "right" });

  y += 12;

  // Add some empty rows for aesthetics
  for (let i = 0; i < 2; i++) {
    doc.rect(margin, y, pageWidth - margin * 2, 10, "S");
    y += 10;
  }

  y += 5;

  // Totals section
  const totalsX = pageWidth - margin - 80;
  const totalsWidth = 80;

  // Subtotal
  doc.setFillColor(241, 245, 249);
  doc.rect(totalsX, y, totalsWidth, 10, "F");
  doc.setTextColor(...mutedColor);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Subtotal:", totalsX + 5, y + 7);
  doc.setTextColor(...darkColor);
  doc.text(`$${invoice.amount.toLocaleString("es-CO")}`, totalsX + totalsWidth - 5, y + 7, { align: "right" });

  y += 10;

  // IVA (0% for internet services in many cases)
  doc.setFillColor(241, 245, 249);
  doc.rect(totalsX, y, totalsWidth, 10, "F");
  doc.setTextColor(...mutedColor);
  doc.text("IVA (0%):", totalsX + 5, y + 7);
  doc.setTextColor(...darkColor);
  doc.text("$0", totalsX + totalsWidth - 5, y + 7, { align: "right" });

  y += 10;

  // Total
  doc.setFillColor(...primaryColor);
  doc.rect(totalsX, y, totalsWidth, 12, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("TOTAL:", totalsX + 5, y + 8);
  doc.text(`$${invoice.amount.toLocaleString("es-CO")}`, totalsX + totalsWidth - 5, y + 8, { align: "right" });

  y += 25;

  // Payment info (if paid)
  if (invoice.status === "paid" && invoice.paid_at) {
    doc.setFillColor(220, 252, 231); // Green-100
    doc.roundedRect(margin, y, pageWidth - margin * 2, 20, 3, 3, "F");
    doc.setTextColor(22, 163, 74); // Green-600
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("✓ PAGO RECIBIDO", margin + 5, y + 8);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Fecha de pago: ${format(parseISO(invoice.paid_at), "dd/MM/yyyy")} | Método: ${invoice.paid_via || "No especificado"}`, margin + 5, y + 15);
    y += 25;
  }

  // Notes section
  doc.setFillColor(254, 249, 195); // Yellow-100
  doc.roundedRect(margin, y, pageWidth - margin * 2, 25, 3, 3, "F");
  doc.setTextColor(161, 98, 7); // Yellow-700
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("INFORMACIÓN IMPORTANTE:", margin + 5, y + 8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("• El servicio puede ser suspendido si el pago no se realiza antes de la fecha de vencimiento.", margin + 5, y + 14);
  doc.text("• Para cualquier consulta sobre esta factura, comuníquese a nuestras líneas de atención.", margin + 5, y + 20);

  y += 30;

  // Footer
  doc.setDrawColor(...primaryColor);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);

  y += 8;
  doc.setTextColor(...mutedColor);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(`Factura generada el ${format(new Date(), "dd/MM/yyyy 'a las' HH:mm")}`, pageWidth / 2, y, { align: "center" });
  doc.text(`${company.name} - NIT: ${company.nit}`, pageWidth / 2, y + 5, { align: "center" });
  doc.text("Este documento es una representación gráfica de la factura electrónica.", pageWidth / 2, y + 10, { align: "center" });

  // Save the PDF
  doc.save(`Factura_${invoice.invoice_number}.pdf`);
}
