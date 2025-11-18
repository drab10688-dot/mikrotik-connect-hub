import { useRef, useEffect } from 'react';
import QRCode from 'qrcode';

interface PrintVoucherTicketProps {
  voucher: {
    code: string;
    password: string;
    profile: string;
    expires_at: string;
  };
  businessName?: string;
  logo?: string;
  showInstructions?: boolean;
  hotspotUrl?: string;
}

export const PrintVoucherTicket = ({ 
  voucher, 
  businessName = "WiFi Service",
  logo,
  showInstructions = true,
  hotspotUrl
}: PrintVoucherTicketProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) {
      // Generar código QR con URL del hotspot si está disponible, sino solo credenciales
      const qrData = hotspotUrl 
        ? `${hotspotUrl}?username=${encodeURIComponent(voucher.code)}&password=${encodeURIComponent(voucher.password)}`
        : `Usuario: ${voucher.code}\nContraseña: ${voucher.password}`;
      
      QRCode.toCanvas(canvasRef.current, qrData, {
        width: 200,
        margin: 1,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      });
    }
  }, [voucher, hotspotUrl]);

  return (
    <div className="voucher-ticket" style={{
      width: '80mm',
      padding: '10mm',
      fontFamily: 'monospace',
      fontSize: '12px',
      backgroundColor: 'white',
      color: 'black',
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '10px' }}>
        {logo && (
          <img 
            src={logo} 
            alt="Logo" 
            style={{ 
              maxWidth: '60mm', 
              maxHeight: '20mm', 
              margin: '0 auto 10px',
              display: 'block'
            }} 
          />
        )}
        <h2 style={{ margin: '5px 0', fontSize: '16px', fontWeight: 'bold' }}>
          {businessName}
        </h2>
        <div style={{ 
          borderTop: '2px dashed #000', 
          margin: '10px 0',
          borderBottom: '2px dashed #000',
          padding: '5px 0'
        }}>
          <strong>VOUCHER DE ACCESO WiFi</strong>
        </div>
      </div>

      {/* QR Code */}
      <div style={{ textAlign: 'center', margin: '15px 0' }}>
        <canvas ref={canvasRef} />
      </div>

      {/* Credentials */}
      <div style={{ 
        border: '2px solid #000', 
        padding: '10px', 
        margin: '10px 0',
        backgroundColor: '#f5f5f5'
      }}>
        <div style={{ marginBottom: '8px' }}>
          <strong>USUARIO:</strong>
          <div style={{ 
            fontSize: '16px', 
            fontWeight: 'bold',
            letterSpacing: '2px',
            fontFamily: 'monospace'
          }}>
            {voucher.code}
          </div>
        </div>
        <div style={{ borderTop: '1px dashed #000', paddingTop: '8px' }}>
          <strong>CONTRASEÑA:</strong>
          <div style={{ 
            fontSize: '16px', 
            fontWeight: 'bold',
            letterSpacing: '2px',
            fontFamily: 'monospace'
          }}>
            {voucher.password}
          </div>
        </div>
      </div>

      {/* Details */}
      <div style={{ fontSize: '11px', marginBottom: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
          <span>Perfil:</span>
          <strong>{voucher.profile}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Válido hasta:</span>
          <strong>{new Date(voucher.expires_at).toLocaleDateString('es-ES')}</strong>
        </div>
      </div>

      {/* Instructions */}
      {showInstructions && (
        <>
          <div style={{ 
            borderTop: '2px dashed #000', 
            paddingTop: '10px',
            marginTop: '10px'
          }}>
            <strong style={{ display: 'block', marginBottom: '5px' }}>
              INSTRUCCIONES DE USO:
            </strong>
            <ol style={{ 
              margin: '5px 0', 
              paddingLeft: '20px',
              fontSize: '10px',
              lineHeight: '1.5'
            }}>
              <li>Conecta a la red WiFi</li>
              <li>Abre tu navegador web</li>
              <li>Ingresa usuario y contraseña</li>
              <li>¡Disfruta tu conexión!</li>
            </ol>
          </div>

          <div style={{ 
            borderTop: '1px solid #000',
            marginTop: '10px',
            paddingTop: '5px',
            fontSize: '9px',
            textAlign: 'center',
            color: '#666'
          }}>
            <p style={{ margin: '5px 0' }}>
              Este voucher es personal e intransferible
            </p>
            <p style={{ margin: '5px 0' }}>
              Generado: {new Date().toLocaleString('es-ES')}
            </p>
          </div>
        </>
      )}

      {/* Footer */}
      <div style={{ 
        borderTop: '2px dashed #000',
        marginTop: '10px',
        paddingTop: '10px',
        textAlign: 'center',
        fontSize: '10px'
      }}>
        <strong>¡Gracias por su preferencia!</strong>
      </div>
    </div>
  );
};
