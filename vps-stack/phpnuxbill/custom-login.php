<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Portal de Acceso - OmniSync</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #050a18;
      color: #e2e8f0;
      overflow: hidden;
    }

    /* Animated background */
    .bg-layer {
      position: fixed;
      inset: 0;
      z-index: 0;
    }

    .bg-gradient {
      position: absolute;
      inset: 0;
      background:
        radial-gradient(ellipse 80% 60% at 50% 0%, rgba(56, 189, 248, 0.12) 0%, transparent 60%),
        radial-gradient(ellipse 60% 50% at 80% 100%, rgba(139, 92, 246, 0.10) 0%, transparent 50%),
        radial-gradient(ellipse 50% 40% at 10% 80%, rgba(6, 182, 212, 0.08) 0%, transparent 50%);
    }

    .bg-grid {
      position: absolute;
      inset: 0;
      background-image:
        linear-gradient(rgba(148, 163, 184, 0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(148, 163, 184, 0.03) 1px, transparent 1px);
      background-size: 60px 60px;
    }

    .bg-dots {
      position: absolute;
      inset: 0;
      background-image: radial-gradient(rgba(148, 163, 184, 0.08) 1px, transparent 1px);
      background-size: 24px 24px;
    }

    /* Floating orbs */
    .orb {
      position: absolute;
      border-radius: 50%;
      filter: blur(80px);
      animation: float 20s ease-in-out infinite;
    }

    .orb-1 {
      width: 300px; height: 300px;
      background: rgba(56, 189, 248, 0.08);
      top: -100px; right: -50px;
      animation-delay: 0s;
    }

    .orb-2 {
      width: 250px; height: 250px;
      background: rgba(139, 92, 246, 0.06);
      bottom: -80px; left: -60px;
      animation-delay: -7s;
    }

    .orb-3 {
      width: 200px; height: 200px;
      background: rgba(6, 182, 212, 0.05);
      top: 40%; left: 60%;
      animation-delay: -14s;
    }

    @keyframes float {
      0%, 100% { transform: translate(0, 0) scale(1); }
      33% { transform: translate(30px, -20px) scale(1.05); }
      66% { transform: translate(-20px, 15px) scale(0.95); }
    }

    /* Container */
    .container {
      position: relative;
      z-index: 1;
      width: 100%;
      max-width: 440px;
      padding: 20px;
    }

    /* Card */
    .card {
      background: rgba(15, 23, 42, 0.65);
      border: 1px solid rgba(148, 163, 184, 0.08);
      border-radius: 24px;
      padding: 40px 28px 32px;
      backdrop-filter: blur(40px);
      -webkit-backdrop-filter: blur(40px);
      box-shadow:
        0 0 0 1px rgba(148, 163, 184, 0.05),
        0 20px 50px -15px rgba(0, 0, 0, 0.5),
        0 0 80px -20px rgba(56, 189, 248, 0.06);
      position: relative;
      overflow: hidden;
    }

    .card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(56, 189, 248, 0.3), rgba(139, 92, 246, 0.3), transparent);
    }

    /* Logo */
    .logo-area {
      text-align: center;
      margin-bottom: 32px;
    }

    .logo-sphere {
      width: 64px;
      height: 64px;
      margin: 0 auto 16px;
      border-radius: 50%;
      background: linear-gradient(135deg, #0ea5e9, #06b6d4, #8b5cf6);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow:
        0 0 30px rgba(6, 182, 212, 0.3),
        0 0 60px rgba(6, 182, 212, 0.1);
      animation: pulse-glow 3s ease-in-out infinite;
      position: relative;
    }

    .logo-sphere::after {
      content: '';
      position: absolute;
      inset: 2px;
      border-radius: 50%;
      background: linear-gradient(135deg, rgba(14, 165, 233, 0.8), rgba(6, 182, 212, 0.6));
      backdrop-filter: blur(4px);
    }

    .logo-sphere svg {
      position: relative;
      z-index: 1;
      width: 32px;
      height: 32px;
      color: white;
    }

    @keyframes pulse-glow {
      0%, 100% { box-shadow: 0 0 30px rgba(6, 182, 212, 0.3), 0 0 60px rgba(6, 182, 212, 0.1); }
      50% { box-shadow: 0 0 40px rgba(6, 182, 212, 0.4), 0 0 80px rgba(6, 182, 212, 0.15); }
    }

    .logo-area h1 {
      font-size: 1.5rem;
      font-weight: 800;
      letter-spacing: -0.025em;
      background: linear-gradient(135deg, #e2e8f0, #f8fafc);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .logo-area p {
      color: #64748b;
      font-size: 0.875rem;
      margin-top: 6px;
      font-weight: 400;
    }

    /* Tabs */
    .tabs {
      display: flex;
      gap: 4px;
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(148, 163, 184, 0.06);
      border-radius: 14px;
      padding: 4px;
      margin-bottom: 28px;
    }

    .tab {
      flex: 1;
      padding: 10px 8px;
      border: none;
      background: transparent;
      color: #64748b;
      font-size: 0.8rem;
      font-weight: 500;
      border-radius: 10px;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font-family: inherit;
      position: relative;
    }

    .tab.active {
      background: rgba(6, 182, 212, 0.12);
      color: #22d3ee;
      box-shadow: 0 0 20px rgba(6, 182, 212, 0.08);
    }

    .tab:hover:not(.active) {
      color: #94a3b8;
      background: rgba(148, 163, 184, 0.04);
    }

    .tab svg {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
    }

    /* Tab content */
    .tab-content {
      display: none;
      animation: fadeIn 0.3s ease;
    }

    .tab-content.active { display: block; }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Form */
    .form-group {
      margin-bottom: 18px;
    }

    .form-group label {
      display: block;
      font-size: 0.8rem;
      color: #94a3b8;
      margin-bottom: 8px;
      font-weight: 500;
      letter-spacing: 0.01em;
    }

    .input-wrapper {
      position: relative;
    }

    .input-wrapper svg {
      position: absolute;
      left: 14px;
      top: 50%;
      transform: translateY(-50%);
      width: 18px;
      height: 18px;
      color: #475569;
      pointer-events: none;
      transition: color 0.2s;
    }

    .form-group input {
      width: 100%;
      padding: 13px 16px 13px 44px;
      background: rgba(15, 23, 42, 0.5);
      border: 1px solid rgba(148, 163, 184, 0.1);
      border-radius: 12px;
      color: #f1f5f9;
      font-size: 0.95rem;
      font-family: inherit;
      outline: none;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .form-group input:focus {
      border-color: rgba(6, 182, 212, 0.5);
      box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.08), 0 0 20px rgba(6, 182, 212, 0.05);
      background: rgba(15, 23, 42, 0.7);
    }

    .form-group input:focus + svg,
    .form-group input:focus ~ svg {
      color: #22d3ee;
    }

    .form-group input::placeholder {
      color: #334155;
    }

    /* Button */
    .btn {
      width: 100%;
      padding: 14px;
      border: none;
      border-radius: 12px;
      font-size: 0.95rem;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      margin-top: 8px;
      position: relative;
      overflow: hidden;
    }

    .btn-primary {
      background: linear-gradient(135deg, #0ea5e9, #06b6d4);
      color: white;
      box-shadow: 0 4px 20px rgba(6, 182, 212, 0.25);
    }

    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 30px rgba(6, 182, 212, 0.35);
      background: linear-gradient(135deg, #0284c7, #0891b2);
    }

    .btn-primary:active {
      transform: translateY(0);
    }

    .btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    .btn-primary::after {
      content: '';
      position: absolute;
      top: 0;
      left: -100%;
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent);
      transition: left 0.5s;
    }

    .btn-primary:hover::after {
      left: 100%;
    }

    /* QR Section */
    .qr-section {
      text-align: center;
    }

    .qr-instructions {
      color: #94a3b8;
      font-size: 0.85rem;
      margin-bottom: 20px;
      line-height: 1.6;
    }

    .btn-scan-toggle {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 12px 24px;
      background: rgba(6, 182, 212, 0.08);
      border: 1px solid rgba(6, 182, 212, 0.2);
      border-radius: 12px;
      color: #22d3ee;
      font-size: 0.85rem;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.3s;
      margin-bottom: 16px;
    }

    .btn-scan-toggle:hover {
      background: rgba(6, 182, 212, 0.15);
      border-color: rgba(6, 182, 212, 0.35);
      box-shadow: 0 0 20px rgba(6, 182, 212, 0.1);
    }

    .btn-scan-toggle svg {
      width: 18px;
      height: 18px;
    }

    /* Video scanner */
    .video-container {
      display: none;
      position: relative;
      margin: 16px 0;
      border-radius: 16px;
      overflow: hidden;
      border: 2px solid rgba(6, 182, 212, 0.2);
      box-shadow: 0 0 30px rgba(6, 182, 212, 0.05);
    }

    .video-container video {
      width: 100%;
      display: block;
      border-radius: 14px;
    }

    .video-container canvas { display: none; }

    .scan-overlay {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 180px;
      height: 180px;
      pointer-events: none;
    }

    .scan-corner {
      position: absolute;
      width: 24px;
      height: 24px;
      border-color: #22d3ee;
      border-style: solid;
      border-width: 0;
    }

    .scan-corner.tl { top: 0; left: 0; border-top-width: 3px; border-left-width: 3px; border-top-left-radius: 8px; }
    .scan-corner.tr { top: 0; right: 0; border-top-width: 3px; border-right-width: 3px; border-top-right-radius: 8px; }
    .scan-corner.bl { bottom: 0; left: 0; border-bottom-width: 3px; border-left-width: 3px; border-bottom-left-radius: 8px; }
    .scan-corner.br { bottom: 0; right: 0; border-bottom-width: 3px; border-right-width: 3px; border-bottom-right-radius: 8px; }

    .scan-line {
      position: absolute;
      left: 10%;
      right: 10%;
      height: 2px;
      background: linear-gradient(90deg, transparent, #22d3ee, transparent);
      animation: scan-down 2s ease-in-out infinite;
      box-shadow: 0 0 10px rgba(34, 211, 238, 0.5);
    }

    @keyframes scan-down {
      0%, 100% { top: 10%; opacity: 0; }
      10% { opacity: 1; }
      90% { opacity: 1; }
      100% { top: 90%; opacity: 0; }
    }

    .or-divider {
      display: flex;
      align-items: center;
      gap: 14px;
      margin: 24px 0;
      color: #334155;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      font-weight: 500;
    }

    .or-divider::before, .or-divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(148, 163, 184, 0.1), transparent);
    }

    /* Upload zone */
    .upload-zone {
      border: 2px dashed rgba(148, 163, 184, 0.1);
      border-radius: 16px;
      padding: 28px 20px;
      cursor: pointer;
      transition: all 0.3s;
      background: rgba(15, 23, 42, 0.3);
    }

    .upload-zone:hover {
      border-color: rgba(6, 182, 212, 0.3);
      background: rgba(6, 182, 212, 0.03);
    }

    .upload-zone svg {
      width: 36px;
      height: 36px;
      color: #475569;
      margin-bottom: 10px;
      transition: color 0.3s;
    }

    .upload-zone:hover svg {
      color: #22d3ee;
    }

    .upload-zone p {
      color: #64748b;
      font-size: 0.8rem;
      margin-top: 4px;
    }

    #qr-file-input { display: none; }

    .qr-result {
      display: none;
      margin-top: 20px;
      padding: 14px 18px;
      background: rgba(34, 197, 94, 0.08);
      border: 1px solid rgba(34, 197, 94, 0.2);
      border-radius: 12px;
      color: #4ade80;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 1rem;
      letter-spacing: 2px;
      word-break: break-all;
    }

    .qr-result.error {
      background: rgba(239, 68, 68, 0.08);
      border-color: rgba(239, 68, 68, 0.2);
      color: #f87171;
    }

    /* Messages */
    .message {
      display: none;
      padding: 14px 18px;
      border-radius: 12px;
      margin-bottom: 20px;
      font-size: 0.85rem;
      line-height: 1.5;
      font-weight: 500;
      backdrop-filter: blur(8px);
    }

    .message.success {
      display: block;
      background: rgba(34, 197, 94, 0.08);
      border: 1px solid rgba(34, 197, 94, 0.15);
      color: #4ade80;
    }

    .message.error {
      display: block;
      background: rgba(239, 68, 68, 0.08);
      border: 1px solid rgba(239, 68, 68, 0.15);
      color: #f87171;
    }

    /* Spinner */
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255,255,255,0.2);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      margin-right: 8px;
      vertical-align: middle;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Footer */
    .footer {
      text-align: center;
      margin-top: 24px;
      padding-top: 20px;
      border-top: 1px solid rgba(148, 163, 184, 0.06);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .footer span {
      color: #334155;
      font-size: 0.7rem;
      letter-spacing: 0.05em;
      font-weight: 500;
    }

    .footer .brand {
      background: linear-gradient(135deg, #06b6d4, #8b5cf6);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      font-weight: 700;
    }

    /* Status dot */
    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
      animation: blink 2s ease-in-out infinite;
    }

    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    /* Responsive */
    @media (max-width: 480px) {
      .container { padding: 12px; }
      .card { padding: 28px 20px 24px; border-radius: 20px; }
      .tab { font-size: 0.75rem; padding: 9px 4px; }
    }
  </style>
</head>
<body>
  <div class="bg-layer">
    <div class="bg-gradient"></div>
    <div class="bg-grid"></div>
    <div class="bg-dots"></div>
    <div class="orb orb-1"></div>
    <div class="orb orb-2"></div>
    <div class="orb orb-3"></div>
  </div>

  <div class="container">
    <div class="card">
      <div class="logo-area">
        <div class="logo-sphere">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
            <path d="M2 12h20"/>
            <path d="M12 2c2.5 2.5 4 6 4 10s-1.5 7.5-4 10"/>
            <path d="M12 2c-2.5 2.5-4 6-4 10s1.5 7.5 4 10"/>
          </svg>
        </div>
        <h1>OmniSync</h1>
        <p>Portal de acceso a Internet</p>
      </div>

      <div id="msg" class="message"></div>

      <!-- Tabs -->
      <div class="tabs">
        <button class="tab active" onclick="switchTab('voucher')" id="tab-btn-voucher">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/></svg>
          Voucher
        </button>
        <button class="tab" onclick="switchTab('qr')" id="tab-btn-qr">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="3" height="3"/><path d="M21 14v3"/><path d="M14 21h3"/></svg>
          Escanear QR
        </button>
        <button class="tab" onclick="switchTab('login')" id="tab-btn-login">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Usuario
        </button>
      </div>

      <!-- Tab: Voucher -->
      <div id="tab-voucher" class="tab-content active">
        <form onsubmit="submitVoucher(event)">
          <div class="form-group">
            <label>Código de Voucher</label>
            <div class="input-wrapper">
              <input type="text" id="voucher-code" placeholder="Ingresa tu código aquí" autocomplete="off" required>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/></svg>
            </div>
          </div>
          <button type="submit" class="btn btn-primary" id="btn-voucher">Activar Voucher</button>
        </form>
      </div>

      <!-- Tab: QR Scanner -->
      <div id="tab-qr" class="tab-content">
        <div class="qr-section">
          <p class="qr-instructions">Escanea el código QR de tu voucher con la cámara o sube una imagen</p>

          <button class="btn-scan-toggle" onclick="toggleCamera()" id="btn-camera">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            <span id="camera-label">Abrir Cámara</span>
          </button>

          <div class="video-container" id="video-container">
            <video id="qr-video" playsinline></video>
            <canvas id="qr-canvas"></canvas>
            <div class="scan-overlay">
              <div class="scan-corner tl"></div>
              <div class="scan-corner tr"></div>
              <div class="scan-corner bl"></div>
              <div class="scan-corner br"></div>
              <div class="scan-line"></div>
            </div>
          </div>

          <div class="or-divider">o sube una imagen</div>

          <div class="upload-zone" onclick="document.getElementById('qr-file-input').click()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <p>Toca aquí para subir la foto del QR</p>
          </div>

          <input type="file" id="qr-file-input" accept="image/*" capture="environment" onchange="processQRImage(this)">

          <div id="qr-result" class="qr-result"></div>
        </div>
      </div>

      <!-- Tab: Login -->
      <div id="tab-login" class="tab-content">
        <form onsubmit="submitLogin(event)">
          <div class="form-group">
            <label>Usuario</label>
            <div class="input-wrapper">
              <input type="text" id="login-user" placeholder="Tu nombre de usuario" required>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </div>
          </div>
          <div class="form-group">
            <label>Contraseña</label>
            <div class="input-wrapper">
              <input type="password" id="login-pass" placeholder="Tu contraseña" required>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </div>
          </div>
          <button type="submit" class="btn btn-primary" id="btn-login">Iniciar Sesión</button>
        </form>
      </div>

      <div class="footer">
        <div class="status-dot"></div>
        <span>Powered by <span class="brand">OmniSync</span></span>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js"></script>

  <script>
    const BASE_URL = window.location.origin;
    let videoStream = null;
    let scanInterval = null;

    function switchTab(tab) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById('tab-btn-' + tab).classList.add('active');
      document.getElementById('tab-' + tab).classList.add('active');
      clearMessage();
      if (tab !== 'qr' && videoStream) stopCamera();
    }

    function showMessage(text, type) {
      const msg = document.getElementById('msg');
      msg.textContent = text;
      msg.className = 'message ' + type;
    }

    function clearMessage() {
      const msg = document.getElementById('msg');
      msg.className = 'message';
      msg.textContent = '';
    }

    async function submitVoucher(e) {
      e.preventDefault();
      const code = document.getElementById('voucher-code').value.trim();
      if (!code) return;
      await activateVoucher(code);
    }

    async function submitLogin(e) {
      e.preventDefault();
      const user = document.getElementById('login-user').value.trim();
      const pass = document.getElementById('login-pass').value.trim();
      if (!user || !pass) return;

      const btn = document.getElementById('btn-login');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>Verificando...';

      try {
        const form = new FormData();
        form.append('username', user);
        form.append('password', pass);

        const resp = await fetch(BASE_URL + '/?_route=login', {
          method: 'POST',
          body: form,
          redirect: 'follow',
        });

        if (resp.ok || resp.redirected) {
          showMessage('✅ Acceso concedido. Redirigiendo...', 'success');
          setTimeout(() => {
            window.location.href = resp.url || BASE_URL + '/?_route=home';
          }, 1000);
        } else {
          showMessage('❌ Usuario o contraseña incorrectos', 'error');
        }
      } catch (err) {
        showMessage('❌ Error de conexión: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Iniciar Sesión';
      }
    }

    async function activateVoucher(code) {
      const btn = document.getElementById('btn-voucher');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span>Activando...';
      }

      try {
        const form = new FormData();
        form.append('code', code);

        const resp = await fetch(BASE_URL + '/?_route=voucher/activation', {
          method: 'POST',
          body: form,
          redirect: 'follow',
        });

        if (resp.ok || resp.redirected) {
          showMessage('✅ Voucher activado correctamente. Redirigiendo...', 'success');
          if (videoStream) stopCamera();
          setTimeout(() => {
            window.location.href = resp.url || BASE_URL + '/?_route=home';
          }, 1500);
        } else {
          const text = await resp.text();
          if (text.includes('already') || text.includes('used')) {
            showMessage('⚠️ Este voucher ya fue utilizado', 'error');
          } else if (text.includes('invalid') || text.includes('not found')) {
            showMessage('❌ Voucher inválido o no encontrado', 'error');
          } else {
            showMessage('❌ No se pudo activar el voucher', 'error');
          }
        }
      } catch (err) {
        showMessage('❌ Error de conexión: ' + err.message, 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Activar Voucher';
        }
      }
    }

    function processQRImage(input) {
      const file = input.files[0];
      if (!file) return;

      const resultEl = document.getElementById('qr-result');
      resultEl.style.display = 'block';
      resultEl.className = 'qr-result';
      resultEl.textContent = 'Procesando imagen...';

      const reader = new FileReader();
      reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

          if (typeof jsQR === 'undefined') {
            resultEl.className = 'qr-result error';
            resultEl.textContent = 'Error: librería QR no cargada';
            return;
          }

          const qr = jsQR(imageData.data, imageData.width, imageData.height);
          if (qr && qr.data) {
            const code = qr.data.trim();
            resultEl.className = 'qr-result';
            resultEl.textContent = '🎫 ' + code;
            document.getElementById('voucher-code').value = code;
            showMessage('✅ QR detectado: ' + code + '. Activando...', 'success');
            setTimeout(() => activateVoucher(code), 800);
          } else {
            resultEl.className = 'qr-result error';
            resultEl.textContent = 'No se detectó código QR en la imagen';
          }
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
      input.value = '';
    }

    async function toggleCamera() {
      if (videoStream) { stopCamera(); } else { await startCamera(); }
    }

    async function startCamera() {
      const container = document.getElementById('video-container');
      const video = document.getElementById('qr-video');
      const label = document.getElementById('camera-label');

      try {
        videoStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
        });

        video.srcObject = videoStream;
        await video.play();
        container.style.display = 'block';
        label.textContent = 'Cerrar Cámara';

        const canvas = document.getElementById('qr-canvas');
        const ctx = canvas.getContext('2d');

        scanInterval = setInterval(() => {
          if (video.readyState !== video.HAVE_ENOUGH_DATA) return;
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

          if (typeof jsQR !== 'undefined') {
            const qr = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
            if (qr && qr.data) {
              const code = qr.data.trim();
              const resultEl = document.getElementById('qr-result');
              resultEl.style.display = 'block';
              resultEl.className = 'qr-result';
              resultEl.textContent = '🎫 ' + code;
              document.getElementById('voucher-code').value = code;
              showMessage('✅ QR detectado: ' + code + '. Activando...', 'success');
              stopCamera();
              setTimeout(() => activateVoucher(code), 800);
            }
          }
        }, 250);

      } catch (err) {
        console.error('Camera error:', err);
        showMessage('⚠️ No se pudo acceder a la cámara. Usa la opción de subir imagen.', 'error');
        label.textContent = 'Abrir Cámara';
      }
    }

    function stopCamera() {
      const container = document.getElementById('video-container');
      const video = document.getElementById('qr-video');
      const label = document.getElementById('camera-label');

      if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
      if (videoStream) { videoStream.getTracks().forEach(t => t.stop()); videoStream = null; }
      video.srcObject = null;
      container.style.display = 'none';
      label.textContent = 'Abrir Cámara';
    }

    (function() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('voucher') || params.get('code') || params.get('v');
      if (code) {
        document.getElementById('voucher-code').value = code;
        showMessage('Código detectado: ' + code + '. Activando...', 'success');
        setTimeout(() => activateVoucher(code), 500);
      }
      const msg = params.get('msg');
      if (msg) showMessage(decodeURIComponent(msg), 'error');
    })();
  </script>
</body>
</html>
