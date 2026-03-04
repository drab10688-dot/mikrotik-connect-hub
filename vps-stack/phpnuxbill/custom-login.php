<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Portal de Acceso - OmniSync</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #e2e8f0;
    }

    .container {
      width: 100%;
      max-width: 420px;
      padding: 20px;
    }

    .card {
      background: rgba(30, 41, 59, 0.9);
      border: 1px solid rgba(99, 102, 241, 0.2);
      border-radius: 16px;
      padding: 32px 24px;
      backdrop-filter: blur(20px);
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    }

    .logo-area {
      text-align: center;
      margin-bottom: 24px;
    }

    .logo-area h1 {
      font-size: 1.5rem;
      font-weight: 700;
      background: linear-gradient(135deg, #818cf8, #6366f1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .logo-area p {
      color: #94a3b8;
      font-size: 0.875rem;
      margin-top: 4px;
    }

    /* Tabs */
    .tabs {
      display: flex;
      gap: 4px;
      background: rgba(15, 23, 42, 0.6);
      border-radius: 10px;
      padding: 4px;
      margin-bottom: 24px;
    }

    .tab {
      flex: 1;
      padding: 10px;
      border: none;
      background: transparent;
      color: #94a3b8;
      font-size: 0.85rem;
      font-weight: 500;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .tab.active {
      background: rgba(99, 102, 241, 0.2);
      color: #818cf8;
    }

    .tab:hover:not(.active) {
      color: #cbd5e1;
    }

    /* Tab content */
    .tab-content { display: none; }
    .tab-content.active { display: block; }

    /* Form */
    .form-group {
      margin-bottom: 16px;
    }

    .form-group label {
      display: block;
      font-size: 0.8rem;
      color: #94a3b8;
      margin-bottom: 6px;
      font-weight: 500;
    }

    .form-group input {
      width: 100%;
      padding: 12px 14px;
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(99, 102, 241, 0.15);
      border-radius: 10px;
      color: #e2e8f0;
      font-size: 1rem;
      outline: none;
      transition: border-color 0.2s;
    }

    .form-group input:focus {
      border-color: #6366f1;
    }

    .form-group input::placeholder {
      color: #475569;
    }

    .btn {
      width: 100%;
      padding: 13px;
      border: none;
      border-radius: 10px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      margin-top: 8px;
    }

    .btn-primary {
      background: linear-gradient(135deg, #6366f1, #4f46e5);
      color: white;
    }

    .btn-primary:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4);
    }

    .btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    /* QR Scanner */
    .qr-section {
      text-align: center;
    }

    .qr-icon {
      width: 80px;
      height: 80px;
      margin: 0 auto 16px;
      background: rgba(99, 102, 241, 0.1);
      border: 2px dashed rgba(99, 102, 241, 0.3);
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s;
    }

    .qr-icon:hover {
      background: rgba(99, 102, 241, 0.15);
      border-color: rgba(99, 102, 241, 0.5);
    }

    .qr-icon svg {
      width: 40px;
      height: 40px;
      color: #818cf8;
    }

    .qr-instructions {
      color: #94a3b8;
      font-size: 0.85rem;
      margin-bottom: 16px;
      line-height: 1.5;
    }

    .qr-result {
      display: none;
      margin-top: 16px;
      padding: 12px;
      background: rgba(34, 197, 94, 0.1);
      border: 1px solid rgba(34, 197, 94, 0.3);
      border-radius: 10px;
      color: #4ade80;
      font-family: monospace;
      font-size: 1.1rem;
      letter-spacing: 2px;
      word-break: break-all;
    }

    .qr-result.error {
      background: rgba(239, 68, 68, 0.1);
      border-color: rgba(239, 68, 68, 0.3);
      color: #f87171;
    }

    #qr-file-input {
      display: none;
    }

    /* Video scanner */
    .video-container {
      display: none;
      position: relative;
      margin: 16px 0;
      border-radius: 12px;
      overflow: hidden;
      border: 2px solid rgba(99, 102, 241, 0.3);
    }

    .video-container video {
      width: 100%;
      display: block;
      border-radius: 10px;
    }

    .video-container canvas {
      display: none;
    }

    .scan-overlay {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 200px;
      height: 200px;
      border: 3px solid rgba(99, 102, 241, 0.6);
      border-radius: 16px;
      pointer-events: none;
    }

    .scan-overlay::before {
      content: '';
      position: absolute;
      top: -3px;
      left: -3px;
      right: -3px;
      bottom: -3px;
      border: 3px solid transparent;
      border-top-color: #6366f1;
      border-radius: 16px;
      animation: scan-rotate 2s linear infinite;
    }

    @keyframes scan-rotate {
      0% { clip-path: inset(0 0 95% 0); }
      25% { clip-path: inset(0 0 0 95%); }
      50% { clip-path: inset(95% 0 0 0); }
      75% { clip-path: inset(0 95% 0 0); }
      100% { clip-path: inset(0 0 95% 0); }
    }

    .btn-scan-toggle {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      background: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(99, 102, 241, 0.3);
      border-radius: 10px;
      color: #818cf8;
      font-size: 0.85rem;
      cursor: pointer;
      transition: all 0.2s;
      margin-bottom: 12px;
    }

    .btn-scan-toggle:hover {
      background: rgba(99, 102, 241, 0.25);
    }

    .or-divider {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 20px 0;
      color: #475569;
      font-size: 0.8rem;
    }

    .or-divider::before, .or-divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: rgba(71, 85, 105, 0.5);
    }

    /* Messages */
    .message {
      display: none;
      padding: 12px 16px;
      border-radius: 10px;
      margin-bottom: 16px;
      font-size: 0.875rem;
      line-height: 1.4;
    }

    .message.success {
      display: block;
      background: rgba(34, 197, 94, 0.1);
      border: 1px solid rgba(34, 197, 94, 0.3);
      color: #4ade80;
    }

    .message.error {
      display: block;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #f87171;
    }

    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      margin-right: 8px;
      vertical-align: middle;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .footer {
      text-align: center;
      margin-top: 16px;
      color: #475569;
      font-size: 0.75rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="logo-area">
        <h1>📡 Portal de Acceso</h1>
        <p>Conéctate a Internet</p>
      </div>

      <div id="msg" class="message"></div>

      <!-- Tabs -->
      <div class="tabs">
        <button class="tab active" onclick="switchTab('voucher')">🎫 Voucher</button>
        <button class="tab" onclick="switchTab('qr')">📷 Escanear QR</button>
        <button class="tab" onclick="switchTab('login')">👤 Usuario</button>
      </div>

      <!-- Tab: Voucher -->
      <div id="tab-voucher" class="tab-content active">
        <form onsubmit="submitVoucher(event)">
          <div class="form-group">
            <label>Código de Voucher</label>
            <input type="text" id="voucher-code" placeholder="Ingresa tu código" autocomplete="off" required>
          </div>
          <button type="submit" class="btn btn-primary" id="btn-voucher">Activar Voucher</button>
        </form>
      </div>

      <!-- Tab: QR Scanner -->
      <div id="tab-qr" class="tab-content">
        <div class="qr-section">
          <p class="qr-instructions">Escanea el código QR de tu voucher con la cámara</p>
          
          <!-- Camera scan button -->
          <button class="btn-scan-toggle" onclick="toggleCamera()" id="btn-camera">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
            <span id="camera-label">Abrir Cámara</span>
          </button>

          <!-- Video stream -->
          <div class="video-container" id="video-container">
            <video id="qr-video" playsinline></video>
            <canvas id="qr-canvas"></canvas>
            <div class="scan-overlay"></div>
          </div>

          <div class="or-divider">o sube una imagen</div>

          <!-- File input fallback -->
          <div class="qr-icon" onclick="document.getElementById('qr-file-input').click()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="3" y="3" width="7" height="7" rx="1"></rect>
              <rect x="14" y="3" width="7" height="7" rx="1"></rect>
              <rect x="3" y="14" width="7" height="7" rx="1"></rect>
              <rect x="14" y="14" width="3" height="3"></rect>
              <line x1="21" y1="14" x2="21" y2="17"></line>
              <line x1="14" y1="21" x2="17" y2="21"></line>
              <line x1="21" y1="21" x2="21" y2="21"></line>
            </svg>
          </div>
          <p class="qr-instructions" style="font-size:0.8rem">Toca el ícono para subir la foto del QR</p>

          <input type="file" id="qr-file-input" accept="image/*" capture="environment" onchange="processQRImage(this)">

          <div id="qr-result" class="qr-result"></div>
        </div>
      </div>

      <!-- Tab: Login -->
      <div id="tab-login" class="tab-content">
        <form onsubmit="submitLogin(event)">
          <div class="form-group">
            <label>Usuario</label>
            <input type="text" id="login-user" placeholder="Tu nombre de usuario" required>
          </div>
          <div class="form-group">
            <label>Contraseña</label>
            <input type="password" id="login-pass" placeholder="Tu contraseña" required>
          </div>
          <button type="submit" class="btn btn-primary" id="btn-login">Iniciar Sesión</button>
        </form>
      </div>

      <div class="footer">
        Powered by OmniSync &bull; <?php echo date('H:i'); ?>
      </div>
    </div>
  </div>

  <!-- jsQR library for QR decoding -->
  <script src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js"></script>

  <script>
    // ===== Config =====
    // PHPNuxBill base URL (auto-detected)
    const BASE_URL = window.location.origin;
    let videoStream = null;
    let scanInterval = null;

    // ===== Tab switching =====
    function switchTab(tab) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      event.target.classList.add('active');
      document.getElementById('tab-' + tab).classList.add('active');
      
      clearMessage();
      
      // Stop camera when switching away from QR tab
      if (tab !== 'qr' && videoStream) {
        stopCamera();
      }
    }

    // ===== Messages =====
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

    // ===== Voucher Submit =====
    async function submitVoucher(e) {
      e.preventDefault();
      const code = document.getElementById('voucher-code').value.trim();
      if (!code) return;
      await activateVoucher(code);
    }

    // ===== Login Submit =====
    async function submitLogin(e) {
      e.preventDefault();
      const user = document.getElementById('login-user').value.trim();
      const pass = document.getElementById('login-pass').value.trim();
      if (!user || !pass) return;

      const btn = document.getElementById('btn-login');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>Verificando...';

      try {
        // PHPNuxBill member login via POST
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

    // ===== Activate Voucher =====
    async function activateVoucher(code) {
      const btn = document.getElementById('btn-voucher');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span>Activando...';
      }

      try {
        // PHPNuxBill voucher activation via its built-in route
        const form = new FormData();
        form.append('code', code);
        
        const resp = await fetch(BASE_URL + '/?_route=voucher/activation', {
          method: 'POST',
          body: form,
          redirect: 'follow',
        });

        if (resp.ok || resp.redirected) {
          showMessage('✅ Voucher activado correctamente. Redirigiendo...', 'success');
          // Stop camera if active
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

    // ===== QR from Image =====
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
            
            // Auto-fill voucher field and activate
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
      
      // Reset input
      input.value = '';
    }

    // ===== Camera QR Scanner =====
    async function toggleCamera() {
      if (videoStream) {
        stopCamera();
      } else {
        await startCamera();
      }
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
        
        // Start scanning loop
        const canvas = document.getElementById('qr-canvas');
        const ctx = canvas.getContext('2d');
        
        scanInterval = setInterval(() => {
          if (video.readyState !== video.HAVE_ENOUGH_DATA) return;
          
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          
          if (typeof jsQR !== 'undefined') {
            const qr = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: 'dontInvert',
            });
            
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
        // Fallback: open file input
        showMessage('⚠️ No se pudo acceder a la cámara. Usa la opción de subir imagen.', 'error');
        label.textContent = 'Abrir Cámara';
      }
    }

    function stopCamera() {
      const container = document.getElementById('video-container');
      const video = document.getElementById('qr-video');
      const label = document.getElementById('camera-label');

      if (scanInterval) {
        clearInterval(scanInterval);
        scanInterval = null;
      }

      if (videoStream) {
        videoStream.getTracks().forEach(t => t.stop());
        videoStream = null;
      }

      video.srcObject = null;
      container.style.display = 'none';
      label.textContent = 'Abrir Cámara';
    }

    // ===== Check URL params =====
    (function() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('voucher') || params.get('code') || params.get('v');
      if (code) {
        document.getElementById('voucher-code').value = code;
        showMessage('Código detectado: ' + code + '. Activando...', 'success');
        setTimeout(() => activateVoucher(code), 500);
      }

      const msg = params.get('msg');
      if (msg) {
        showMessage(decodeURIComponent(msg), 'error');
      }
    })();
  </script>
</body>
</html>
