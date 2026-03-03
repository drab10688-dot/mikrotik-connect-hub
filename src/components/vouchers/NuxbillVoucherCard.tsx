import { useEffect, useRef } from "react";
import QRCode from "qrcode";

interface NuxbillVoucherCardProps {
  voucher: {
    code: string;
    password: string;
    profile: string;
    validity?: string;
    price?: number | string;
  };
  portalUrl: string;
  mikrotikId: string;
  businessName?: string;
  logo?: string;
}

export const NuxbillVoucherCard = ({
  voucher,
  portalUrl,
  mikrotikId,
  businessName = "WiFi Service",
  logo,
}: NuxbillVoucherCardProps) => {
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (qrCanvasRef.current) {
      const qrUrl = `${portalUrl}?id=${encodeURIComponent(mikrotikId)}&code=${encodeURIComponent(voucher.code)}`;
      QRCode.toCanvas(qrCanvasRef.current, qrUrl, {
        width: 140,
        margin: 1,
        color: { dark: "#1a1a2e", light: "#ffffff" },
        errorCorrectionLevel: "H",
      });
    }
  }, [voucher, portalUrl, mikrotikId]);

  return (
    <div
      className="nuxbill-voucher-card"
      style={{
        width: "260px",
        minHeight: "360px",
        borderRadius: "16px",
        overflow: "hidden",
        fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
        background: "linear-gradient(145deg, #0f0f23 0%, #1a1a3e 50%, #16213e 100%)",
        color: "#fff",
        position: "relative",
        boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
      }}
    >
      {/* Decorative circle */}
      <div
        style={{
          position: "absolute",
          top: "-40px",
          right: "-40px",
          width: "120px",
          height: "120px",
          borderRadius: "50%",
          background: "rgba(99, 102, 241, 0.15)",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: "-30px",
          left: "-30px",
          width: "100px",
          height: "100px",
          borderRadius: "50%",
          background: "rgba(16, 185, 129, 0.1)",
        }}
      />

      {/* Header */}
      <div
        style={{
          padding: "16px 20px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {logo ? (
            <img
              src={logo}
              alt="Logo"
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "8px",
                objectFit: "contain",
                background: "#fff",
                padding: "2px",
              }}
            />
          ) : (
            <div
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "8px",
                background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "14px",
              }}
            >
              📶
            </div>
          )}
          <span
            style={{
              fontSize: "13px",
              fontWeight: 700,
              letterSpacing: "0.5px",
            }}
          >
            {businessName}
          </span>
        </div>
      </div>

      {/* Credentials */}
      <div style={{ padding: "14px 20px", position: "relative", zIndex: 1 }}>
        <div style={{ marginBottom: "10px" }}>
          <div
            style={{
              fontSize: "10px",
              textTransform: "uppercase",
              letterSpacing: "1.5px",
              color: "rgba(255,255,255,0.5)",
              marginBottom: "4px",
            }}
          >
            Usuario
          </div>
          <div
            style={{
              fontSize: "16px",
              fontWeight: 700,
              fontFamily: "'Courier New', monospace",
              letterSpacing: "2px",
              background: "rgba(255,255,255,0.08)",
              padding: "6px 10px",
              borderRadius: "6px",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            {voucher.code}
          </div>
        </div>
        <div>
          <div
            style={{
              fontSize: "10px",
              textTransform: "uppercase",
              letterSpacing: "1.5px",
              color: "rgba(255,255,255,0.5)",
              marginBottom: "4px",
            }}
          >
            Contraseña
          </div>
          <div
            style={{
              fontSize: "16px",
              fontWeight: 700,
              fontFamily: "'Courier New', monospace",
              letterSpacing: "2px",
              background: "rgba(255,255,255,0.08)",
              padding: "6px 10px",
              borderRadius: "6px",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            {voucher.password}
          </div>
        </div>
      </div>

      {/* Plan info pill */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: "8px",
          padding: "0 20px",
          position: "relative",
          zIndex: 1,
        }}
      >
        {voucher.validity && (
          <span
            style={{
              fontSize: "11px",
              fontWeight: 600,
              padding: "4px 12px",
              borderRadius: "20px",
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              color: "#fff",
            }}
          >
            {voucher.validity}
          </span>
        )}
        {voucher.price != null && Number(voucher.price) > 0 && (
          <span
            style={{
              fontSize: "11px",
              fontWeight: 600,
              padding: "4px 12px",
              borderRadius: "20px",
              background: "linear-gradient(135deg, #10b981, #059669)",
              color: "#fff",
            }}
          >
            $ {Number(voucher.price).toLocaleString("es-CO")}
          </span>
        )}
      </div>

      {/* QR Code */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "14px 20px 10px",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div
          style={{
            background: "#fff",
            borderRadius: "12px",
            padding: "8px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
          }}
        >
          <canvas ref={qrCanvasRef} />
        </div>
        <div
          style={{
            fontSize: "9px",
            color: "rgba(255,255,255,0.4)",
            marginTop: "6px",
            textAlign: "center",
          }}
        >
          Escanea para conectarte
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "8px 20px 14px",
          textAlign: "center",
          fontSize: "9px",
          color: "rgba(255,255,255,0.3)",
          position: "relative",
          zIndex: 1,
        }}
      >
        Powered by OmniSync
      </div>
    </div>
  );
};
