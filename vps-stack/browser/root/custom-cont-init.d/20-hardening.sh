#!/usr/bin/with-contenv bash
# ============================================================
# Endurecimiento del navegador remoto:
#  - No guarda contraseñas ni autocompletado
#  - Sin sincronización de cuentas ni pantalla de "guardar clave"
#  - Borra cookies/credenciales del perfil en cada arranque
# ============================================================

POLICY_DIR=/etc/chromium/policies/managed
mkdir -p "$POLICY_DIR" 2>/dev/null || true
cat > "$POLICY_DIR/omnisync.json" <<'JSON'
{
  "PasswordManagerEnabled": false,
  "AutofillAddressEnabled": false,
  "AutofillCreditCardEnabled": false,
  "SyncDisabled": true,
  "BrowserSignin": 0,
  "SavingBrowserHistoryDisabled": true,
  "IncognitoModeAvailability": 0,
  "DefaultDownloadDirectory": "/tmp/downloads",
  "DownloadRestrictions": 3,
  "PrintingEnabled": false,
  "MetricsReportingEnabled": false,
  "BackgroundModeEnabled": false
}
JSON

# Perfil efímero: limpia credenciales/cookies heredadas de sesiones previas
PROFILE=/config/.config/chromium/Default
rm -f "$PROFILE/Login Data" "$PROFILE/Login Data-journal" \
      "$PROFILE/Web Data" "$PROFILE/Web Data-journal" \
      "$PROFILE/Cookies" "$PROFILE/Cookies-journal" \
      "$PROFILE/History" "$PROFILE/History-journal" 2>/dev/null || true
rm -rf "$PROFILE/Service Worker" "$PROFILE/Cache" 2>/dev/null || true
mkdir -p /tmp/downloads 2>/dev/null || true
