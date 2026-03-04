/**
 * HMON Print Utilities
 * Supports 80mm thermal tickets and A4 card sheets
 */
import QRCode from "qrcode";

export interface PrintVoucher {
  code: string;
  password: string;
  profile: string;
  validity?: string;
  price?: number;
}

export interface PrintConfig {
  businessName: string;
  logo?: string;
  hotspotUrl: string;
}

function buildLoginUrl(hotspotUrl: string, code: string, password: string): string {
  const sep = hotspotUrl.includes("?") ? "&" : "?";
  return `${hotspotUrl}${sep}username=${code}&password=${password}`;
}

// ─── 80mm Thermal Ticket ─────────────────────────────────

export async function printTicket80mm(voucher: PrintVoucher, config: PrintConfig) {
  const qrCanvas = document.createElement("canvas");
  await QRCode.toCanvas(qrCanvas, buildLoginUrl(config.hotspotUrl, voucher.code, voucher.password), { width: 200, errorCorrectionLevel: "H" });

  const w = window.open("", "_blank");
  if (!w) return;

  w.document.write(`<!DOCTYPE html><html><head><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Courier New',monospace;width:80mm;padding:8mm 6mm;background:#fff}
.ticket{text-align:center}
.logo{max-width:50mm;max-height:18mm;margin:0 auto 3mm}
.biz{font-size:16px;font-weight:bold;margin-bottom:4mm}
.title{font-size:14px;font-weight:bold;border-top:2px dashed #000;border-bottom:2px dashed #000;padding:3mm 0;margin:3mm 0}
.qr{margin:4mm auto}
.qr img{width:45mm;height:45mm}
.cred{text-align:left;margin:4mm 0}
.cred-item{margin:2mm 0;padding:2mm 3mm;background:#f3f3f3;border-radius:2mm}
.lbl{font-weight:bold;font-size:9px;text-transform:uppercase;color:#555}
.val{font-size:13px;word-break:break-all;font-weight:bold}
.footer{font-size:8px;color:#888;margin-top:4mm;border-top:1px dashed #ccc;padding-top:3mm}
@media print{@page{margin:0;size:80mm auto}}
</style></head><body><div class="ticket">
${config.logo ? `<img src="${config.logo}" class="logo"/>` : ""}
<div class="biz">${config.businessName}</div>
<div class="title">🌐 VOUCHER WiFi</div>
<div class="qr"><img src="${qrCanvas.toDataURL()}"/></div>
<div class="cred">
<div class="cred-item"><div class="lbl">Usuario</div><div class="val">${voucher.code}</div></div>
<div class="cred-item"><div class="lbl">Contraseña</div><div class="val">${voucher.password}</div></div>
<div class="cred-item"><div class="lbl">Plan</div><div class="val">${voucher.profile}</div></div>
${voucher.validity ? `<div class="cred-item"><div class="lbl">Duración</div><div class="val">${voucher.validity}</div></div>` : ""}
${voucher.price ? `<div class="cred-item"><div class="lbl">Precio</div><div class="val">$${voucher.price.toFixed(2)}</div></div>` : ""}
</div>
<div class="footer">Escanea el QR para conectarte automáticamente<br/>Powered by HMON • Omnisync</div>
</div>
<script>window.onload=()=>setTimeout(()=>window.print(),400);window.onafterprint=()=>window.close();</script>
</body></html>`);
  w.document.close();
}

// ─── A4 Card Sheet ──────────────────────────────────────

export async function printCardsA4(vouchers: PrintVoucher[], config: PrintConfig) {
  const qrImages: string[] = [];
  for (const v of vouchers) {
    const canvas = document.createElement("canvas");
    await QRCode.toCanvas(canvas, buildLoginUrl(config.hotspotUrl, v.code, v.password), { width: 180, errorCorrectionLevel: "H" });
    qrImages.push(canvas.toDataURL());
  }

  const w = window.open("", "_blank");
  if (!w) return;

  const cards = vouchers.map((v, i) => `
<div class="card">
  <div class="card-header">${config.businessName}</div>
  <div class="card-qr"><img src="${qrImages[i]}"/></div>
  <div class="card-info">
    <div class="card-row"><span class="card-lbl">USR:</span><span class="card-val">${v.code}</span></div>
    <div class="card-row"><span class="card-lbl">PWD:</span><span class="card-val">${v.password}</span></div>
    <div class="card-row"><span class="card-lbl">Plan:</span><span class="card-val">${v.profile}</span></div>
    ${v.validity ? `<div class="card-row"><span class="card-lbl">Dur:</span><span class="card-val">${v.validity}</span></div>` : ""}
    ${v.price ? `<div class="card-row"><span class="card-lbl">$</span><span class="card-val">${v.price.toFixed(2)}</span></div>` : ""}
  </div>
</div>`).join("");

  w.document.write(`<!DOCTYPE html><html><head><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;padding:8mm;background:#fff}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:5mm}
.card{border:1.5px solid #333;border-radius:3mm;padding:4mm;page-break-inside:avoid;text-align:center}
.card-header{font-size:11px;font-weight:bold;margin-bottom:2mm;padding-bottom:2mm;border-bottom:1px dashed #999}
.card-qr img{width:35mm;height:35mm;margin:2mm auto}
.card-info{text-align:left;font-size:9px;line-height:1.6}
.card-row{display:flex;gap:1mm}
.card-lbl{font-weight:bold;color:#555;min-width:28px}
.card-val{font-family:monospace;font-weight:bold}
@media print{@page{margin:8mm;size:A4}}
</style></head><body>
<div class="grid">${cards}</div>
<script>window.onload=()=>setTimeout(()=>window.print(),500);window.onafterprint=()=>window.close();</script>
</body></html>`);
  w.document.close();
}
