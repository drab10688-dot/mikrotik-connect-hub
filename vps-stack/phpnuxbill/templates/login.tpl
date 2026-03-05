{include file="customer/header-public.tpl"}

<div style="max-width:480px; margin:0 auto; padding:0 10px;">

    {* ── Tab Navigation ── *}
    <div class="os-tabs" style="display:flex; border-radius:12px 12px 0 0; overflow:hidden; border:1px solid rgba(51,65,85,0.6); border-bottom:none;">
        <button type="button" class="os-tab active" onclick="switchTab('login')" id="tab-login"
            style="flex:1; padding:12px; background:rgba(6,182,212,0.15); color:#06b6d4; border:none; font-weight:600; font-size:13px; cursor:pointer; transition:all 0.3s;">
            <i class="glyphicon glyphicon-user"></i> {Lang::T('Login')}
        </button>
        <button type="button" class="os-tab" onclick="switchTab('voucher')" id="tab-voucher"
            style="flex:1; padding:12px; background:rgba(30,41,59,0.6); color:#94a3b8; border:none; border-left:1px solid rgba(51,65,85,0.6); font-weight:600; font-size:13px; cursor:pointer; transition:all 0.3s;">
            <i class="glyphicon glyphicon-tag"></i> Voucher
        </button>
        <button type="button" class="os-tab" onclick="switchTab('qr')" id="tab-qr"
            style="flex:1; padding:12px; background:rgba(30,41,59,0.6); color:#94a3b8; border:none; border-left:1px solid rgba(51,65,85,0.6); font-weight:600; font-size:13px; cursor:pointer; transition:all 0.3s;">
            <i class="glyphicon glyphicon-qrcode"></i> QR
        </button>
    </div>

    {* ══════════════════════════════════════════ *}
    {* ── LOGIN TAB ── *}
    {* ══════════════════════════════════════════ *}
    <div class="panel" id="panel-login" style="border-radius:0 0 12px 12px !important; margin-top:0;">
        <div class="panel-body">
            <form action="{Text::url('login/post')}" method="post">
                <input type="hidden" name="csrf_token" value="{$csrf_token}">
                <div class="form-group">
                    <label>
                        {if $_c['registration_username'] == 'phone'}
                            <i class="glyphicon glyphicon-phone-alt"></i> {Lang::T('Phone Number')}
                        {elseif $_c['registration_username'] == 'email'}
                            <i class="glyphicon glyphicon-envelope"></i> {Lang::T('Email')}
                        {else}
                            <i class="glyphicon glyphicon-user"></i> {Lang::T('Usernames')}
                        {/if}
                    </label>
                    <input type="text" class="form-control" name="username" 
                        placeholder="{if $_c['registration_username'] == 'phone'}{Lang::T('Phone Number')}{elseif $_c['registration_username'] == 'email'}{Lang::T('Email')}{else}{Lang::T('Usernames')}{/if}" required>
                </div>
                <div class="form-group">
                    <label><i class="glyphicon glyphicon-lock"></i> {Lang::T('Password')}</label>
                    <input type="password" class="form-control" name="password" placeholder="{Lang::T('Password')}" required>
                </div>
                <button class="btn btn-primary btn-block" type="submit" style="margin-top:15px;">
                    <i class="glyphicon glyphicon-log-in"></i> {Lang::T('Login')}
                </button>
            </form>
            {if $_c['allow_registration'] eq 'yes'}
                <div style="text-align:center; margin-top:15px; padding-top:12px; border-top:1px solid rgba(51,65,85,0.6);">
                    <a href="{Text::url('register')}" style="color:#94a3b8; font-size:13px;">
                        {Lang::T("Don't have account? Register")}
                    </a>
                </div>
            {/if}
        </div>
    </div>

    {* ══════════════════════════════════════════ *}
    {* ── VOUCHER TAB ── *}
    {* ══════════════════════════════════════════ *}
    <div class="panel" id="panel-voucher" style="display:none; border-radius:0 0 12px 12px !important; margin-top:0;">
        <div class="panel-body">
            <form method="post" action="{Text::url('voucher/activation-post')}">
                <div class="form-group">
                    <label><i class="glyphicon glyphicon-tag"></i> {Lang::T('Enter voucher code here')}</label>
                    <input type="text" class="form-control" id="voucherCode" name="code" 
                        placeholder="{Lang::T('Enter voucher code here')}" 
                        style="text-align:center; font-size:18px; letter-spacing:3px; font-weight:700;"
                        autocomplete="off" required>
                </div>
                <button class="btn btn-success btn-block" type="submit" style="margin-top:15px;">
                    <i class="glyphicon glyphicon-flash"></i> {Lang::T('Recharge')}
                </button>
            </form>
            <div style="text-align:center; margin-top:12px;">
                <small style="color:#94a3b8;">{Lang::T('Enter your voucher code to activate your internet')}</small>
            </div>
        </div>
    </div>

    {* ══════════════════════════════════════════ *}
    {* ── QR SCANNER TAB ── *}
    {* ══════════════════════════════════════════ *}
    <div class="panel" id="panel-qr" style="display:none; border-radius:0 0 12px 12px !important; margin-top:0;">
        <div class="panel-body" style="text-align:center;">
            <p style="color:#94a3b8; margin-bottom:15px; font-size:13px;">
                <i class="glyphicon glyphicon-camera"></i> Escanea el código QR de tu voucher
            </p>

            {* Camera video feed *}
            <div id="qr-video-container" style="position:relative; width:100%; max-width:300px; margin:0 auto 15px; border-radius:12px; overflow:hidden; border:2px solid rgba(6,182,212,0.3); display:none;">
                <video id="qr-video" style="width:100%; display:block;" playsinline></video>
                <div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:60%; height:60%; border:2px solid rgba(6,182,212,0.6); border-radius:8px; pointer-events:none;"></div>
            </div>

            {* Buttons *}
            <button type="button" class="btn btn-primary" id="btn-start-camera" onclick="startCamera()" style="margin-bottom:10px;">
                <i class="glyphicon glyphicon-camera"></i> Abrir Cámara
            </button>
            <button type="button" class="btn btn-default" id="btn-stop-camera" onclick="stopCamera()" style="display:none; margin-bottom:10px;">
                <i class="glyphicon glyphicon-remove"></i> Cerrar Cámara
            </button>

            <div style="margin:10px 0; color:#94a3b8; font-size:12px;">— o sube una imagen —</div>

            <label class="btn btn-default btn-block" style="margin-bottom:15px;">
                <i class="glyphicon glyphicon-picture"></i> Subir imagen QR
                <input type="file" accept="image/*" id="qr-file-input" style="display:none;" onchange="scanFromFile(this)">
            </label>

            {* Result *}
            <div id="qr-result" style="display:none; padding:12px; background:rgba(34,197,94,0.1); border:1px solid rgba(34,197,94,0.3); border-radius:10px; margin-top:10px;">
                <i class="glyphicon glyphicon-ok" style="color:#22c55e;"></i>
                <span style="color:#22c55e; font-weight:600;"> Código detectado:</span>
                <div id="qr-result-code" style="font-size:20px; font-weight:700; letter-spacing:2px; color:#f1f5f9; margin:8px 0;"></div>
                <button type="button" class="btn btn-success btn-block" onclick="activateVoucher()">
                    <i class="glyphicon glyphicon-flash"></i> Activar Voucher
                </button>
            </div>

            <div id="qr-error" style="display:none; padding:10px; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); border-radius:10px; margin-top:10px; color:#ef4444; font-size:13px;"></div>
        </div>
    </div>

    {* ── Ad Banner (top) ── *}
    <div id="os-ad-banner" style="display:none; margin-bottom:15px;"></div>

    {* ── Ad Footer ── *}
    <div id="os-ad-footer" style="display:none; margin-top:10px;"></div>

    {* ── Ad Popup ── *}
    <div id="os-ad-popup-overlay" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.7); z-index:9999; justify-content:center; align-items:center;">
        <div id="os-ad-popup" style="background:var(--os-bg-card); border:1px solid var(--os-border); border-radius:16px; max-width:380px; width:90%; padding:20px; position:relative; backdrop-filter:blur(16px);">
            <button onclick="document.getElementById('os-ad-popup-overlay').style.display='none'" 
                style="position:absolute; top:8px; right:12px; background:none; border:none; color:var(--os-text-muted); font-size:20px; cursor:pointer;">&times;</button>
            <div id="os-ad-popup-content"></div>
        </div>
    </div>

    {* ── Powered By ── *}
    <div style="text-align:center; padding:15px 0 30px; color:rgba(148,163,184,0.4); font-size:11px;">
        Powered by <span style="color:rgba(6,182,212,0.5);">OmniSync</span>
    </div>
</div>

{* ══════════════════════════════════════════════ *}
{* ── JavaScript: Tabs + QR Scanner ── *}
{* ══════════════════════════════════════════════ *}
<script>
// ── Tab Switching ──
function switchTab(tab) {
    ['login','voucher','qr'].forEach(function(t) {
        var panel = document.getElementById('panel-' + t);
        var tabBtn = document.getElementById('tab-' + t);
        if (t === tab) {
            panel.style.display = 'block';
            tabBtn.style.background = 'rgba(6,182,212,0.15)';
            tabBtn.style.color = '#06b6d4';
        } else {
            panel.style.display = 'none';
            tabBtn.style.background = 'rgba(30,41,59,0.6)';
            tabBtn.style.color = '#94a3b8';
        }
    });
    if (tab !== 'qr') stopCamera();
}

// ── QR Scanner ──
var videoStream = null;
var scanInterval = null;

function startCamera() {
    var video = document.getElementById('qr-video');
    var container = document.getElementById('qr-video-container');
    var btnStart = document.getElementById('btn-start-camera');
    var btnStop = document.getElementById('btn-stop-camera');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showQrError('Tu navegador no soporta acceso a la cámara');
        return;
    }

    navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
    }).then(function(stream) {
        videoStream = stream;
        video.srcObject = stream;
        video.play();
        container.style.display = 'block';
        btnStart.style.display = 'none';
        btnStop.style.display = 'inline-block';
        hideQrError();
        startScanning();
    }).catch(function(err) {
        showQrError('No se pudo acceder a la cámara: ' + err.message);
    });
}

function stopCamera() {
    if (videoStream) {
        videoStream.getTracks().forEach(function(t) { t.stop(); });
        videoStream = null;
    }
    if (scanInterval) {
        clearInterval(scanInterval);
        scanInterval = null;
    }
    var container = document.getElementById('qr-video-container');
    var btnStart = document.getElementById('btn-start-camera');
    var btnStop = document.getElementById('btn-stop-camera');
    container.style.display = 'none';
    btnStart.style.display = 'inline-block';
    btnStop.style.display = 'none';
}

function startScanning() {
    var video = document.getElementById('qr-video');
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');

    scanInterval = setInterval(function() {
        if (video.readyState !== video.HAVE_ENOUGH_DATA) return;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        var code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
        if (code && code.data) {
            stopCamera();
            handleQrResult(code.data);
        }
    }, 200);
}

function scanFromFile(input) {
    if (!input.files || !input.files[0]) return;
    var reader = new FileReader();
    reader.onload = function(e) {
        var img = new Image();
        img.onload = function() {
            var canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            var code = jsQR(imageData.data, imageData.width, imageData.height);
            if (code && code.data) {
                handleQrResult(code.data);
            } else {
                showQrError('No se detectó un código QR en la imagen');
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(input.files[0]);
}

function handleQrResult(data) {
    // Extract voucher code from URL or use raw data
    var code = data;
    try {
        if (data.indexOf('http') === 0) {
            var url = new URL(data);
            code = url.searchParams.get('code') || url.searchParams.get('voucher') || url.pathname.split('/').pop() || data;
        }
    } catch(e) {}

    document.getElementById('qr-result-code').textContent = code;
    document.getElementById('qr-result').style.display = 'block';
    hideQrError();
}

function activateVoucher() {
    var code = document.getElementById('qr-result-code').textContent.trim();
    if (code) {
        window.location.href = appUrl + '/index.php?_route=voucher/activation-post&code=' + encodeURIComponent(code);
    }
}

function showQrError(msg) {
    var el = document.getElementById('qr-error');
    el.textContent = msg;
    el.style.display = 'block';
}

function hideQrError() {
    document.getElementById('qr-error').style.display = 'none';
}

// Auto-activate if code in URL
(function() {
    var params = new URLSearchParams(window.location.search);
    var code = params.get('code') || params.get('voucher');
    if (code) {
        switchTab('voucher');
        document.getElementById('voucherCode').value = code;
    }
})();
</script>

{* ── jsQR Library ── *}
<script src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js"></script>

{* ── OmniSync Ads Loader ── *}
<script>
(function() {
    // Determine API base - use same origin
    var apiBase = window.location.protocol + '//' + window.location.host + '/api/portal-ads/public/default';

    function renderAd(ad, container) {
        var html = '<a href="' + (ad.link_url || '#') + '" target="_blank" rel="noopener" '
            + 'onclick="trackAdClick(\'' + ad.id + '\')" '
            + 'style="display:block; text-decoration:none; color:inherit;">';
        if (ad.image_url) {
            html += '<img src="' + ad.image_url + '" alt="' + ad.title + '" '
                + 'style="width:100%; border-radius:12px; margin-bottom:8px;" onerror="this.style.display=\'none\'">';
        }
        html += '<div style="padding:8px 4px;">';
        html += '<div style="font-weight:600; color:#f1f5f9; font-size:14px;">' + ad.title + '</div>';
        if (ad.description) {
            html += '<div style="color:#94a3b8; font-size:12px; margin-top:4px;">' + ad.description + '</div>';
        }
        html += '<div style="color:rgba(6,182,212,0.6); font-size:11px; margin-top:4px;">' + ad.advertiser_name + '</div>';
        html += '</div></a>';
        container.innerHTML = html;
        container.style.display = 'block';
        // Track impression
        trackAdImpression(ad.id);
    }

    function trackAdImpression(adId) {
        try { navigator.sendBeacon(window.location.protocol + '//' + window.location.host + '/api/portal-ads/public/' + adId + '/impression'); } catch(e) {}
    }

    window.trackAdClick = function(adId) {
        try { navigator.sendBeacon(window.location.protocol + '//' + window.location.host + '/api/portal-ads/public/' + adId + '/click'); } catch(e) {}
    };

    // Fetch ads
    var xhr = new XMLHttpRequest();
    xhr.open('GET', apiBase);
    xhr.onload = function() {
        if (xhr.status !== 200) return;
        try {
            var resp = JSON.parse(xhr.responseText);
            if (!resp.success || !resp.data || !resp.data.length) return;
            var ads = resp.data;
            var banners = [], footers = [], popups = [];
            ads.forEach(function(ad) {
                if (ad.position === 'banner') banners.push(ad);
                else if (ad.position === 'footer') footers.push(ad);
                else if (ad.position === 'popup') popups.push(ad);
            });
            // Render first of each type
            if (banners.length) {
                renderAd(banners[0], document.getElementById('os-ad-banner'));
            }
            if (footers.length) {
                renderAd(footers[0], document.getElementById('os-ad-footer'));
            }
            if (popups.length) {
                var popup = popups[0];
                renderAd(popup, document.getElementById('os-ad-popup-content'));
                setTimeout(function() {
                    document.getElementById('os-ad-popup-overlay').style.display = 'flex';
                }, 3000);
            }
        } catch(e) {}
    };
    xhr.send();
})();
</script>

</body>
</html>
