import { useEffect, useRef } from "react";
import QRCode from "qrcode";

interface VoucherTicketProps {
  voucher: {
    name: string;
    password: string;
    profile?: string;
    comment?: string;
  };
  logo?: string;
  businessName?: string;
  showInstructions?: boolean;
  hotspotUrl?: string;
}

export const VoucherTicket = ({ voucher, logo, businessName = "MikroTik Hotspot", showInstructions = true, hotspotUrl }: VoucherTicketProps) => {
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (qrCanvasRef.current) {
      // Generar código QR con URL del hotspot si está disponible, sino solo credenciales
      const qrData = hotspotUrl 
        ? `${hotspotUrl}?username=${encodeURIComponent(voucher.name)}&password=${encodeURIComponent(voucher.password)}`
        : `Usuario: ${voucher.name}\nContraseña: ${voucher.password}`;
      
      QRCode.toCanvas(qrCanvasRef.current, qrData, {
        width: 200,
        margin: 1,
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
      });
    }
  }, [voucher, hotspotUrl]);

  return (
    <div className="voucher-ticket">
      {/* Logo */}
      {logo && (
        <div className="ticket-logo">
          <img src={logo} alt="Logo" />
        </div>
      )}

      {/* Nombre del negocio */}
      <div className="ticket-business-name">
        {businessName}
      </div>

      <div className="ticket-divider">━━━━━━━━━━━━━━━━━━━━━━━━━━━━</div>

      {/* Título */}
      <div className="ticket-title">VOUCHER DE ACCESO WIFI</div>

      {/* Código QR */}
      <div className="ticket-qr">
        <canvas ref={qrCanvasRef}></canvas>
      </div>

      {/* Credenciales */}
      <div className="ticket-credentials">
        <div className="credential-row">
          <span className="credential-label">Usuario:</span>
          <span className="credential-value">{voucher.name}</span>
        </div>
        <div className="credential-row">
          <span className="credential-label">Contraseña:</span>
          <span className="credential-value">{voucher.password}</span>
        </div>
        {voucher.profile && (
          <div className="credential-row">
            <span className="credential-label">Plan:</span>
            <span className="credential-value">{voucher.profile}</span>
          </div>
        )}
      </div>

      <div className="ticket-divider">━━━━━━━━━━━━━━━━━━━━━━━━━━━━</div>

      {/* Instrucciones */}
      {showInstructions && (
        <div className="ticket-instructions">
          <p className="instruction-title">Instrucciones de Conexión:</p>
          <ol>
            <li>Conectar a la red WiFi</li>
            <li>Abrir navegador web</li>
            <li>Ingresar usuario y contraseña</li>
            <li>Disfrutar de Internet</li>
          </ol>
        </div>
      )}

      {/* Pie de página */}
      <div className="ticket-footer">
        <p>Gracias por su preferencia</p>
        <p className="ticket-date">{new Date().toLocaleDateString('es-ES')}</p>
      </div>

      <div className="ticket-cut-line">- - - - - - - - - - - - - - - - - -</div>
    </div>
  );
};
