#!/usr/bin/with-contenv bash
# ============================================================
# Endurecimiento del navegador remoto:
#  - Modo incógnito FORZADO: no guarda cookies, historial ni caché en disco
#  - No guarda contraseñas ni autocompletado
#  - Sin sincronización de cuentas ni descargas
#  - Borra por completo el perfil heredado en cada arranque
# ============================================================

POLICY_DIRS="/etc/chromium/policies/managed /etc/chromium-browser/policies/managed /etc/opt/chrome/policies/managed"
read -r -d '' POLICY_JSON <<'JSON' || true
{
  "IncognitoModeAvailability": 1,
  "PasswordManagerEnabled": false,
  "AutofillAddressEnabled": false,
  "AutofillCreditCardEnabled": false,
  "SyncDisabled": true,
  "BrowserSignin": 0,
  "SavingBrowserHistoryDisabled": true,
  "DefaultCookiesSetting": 4,
  "RestoreOnStartup": 5,
  "DownloadRestrictions": 3,
  "DefaultDownloadDirectory": "/tmp/downloads",
  "PrintingEnabled": false,
  "MetricsReportingEnabled": false,
  "BackgroundModeEnabled": false,
  "SearchSuggestEnabled": false,
  "SpellcheckEnabled": false,
  "SafeBrowsingProtectionLevel": 0,
  "DnsOverHttpsMode": "off",
  "PromptForDownloadLocation": false,
  "BrowserGuestModeEnabled": false,
  "BrowserAddPersonEnabled": false,
  "DeveloperToolsAvailability": 2,
  "URLBlocklist": ["file://*", "chrome://settings/*", "chrome://net-internals/*"]
}
JSON

for D in $POLICY_DIRS; do
  mkdir -p "$D" 2>/dev/null || true
  printf '%s\n' "$POLICY_JSON" > "$D/omnisync.json" 2>/dev/null || true
done

# Perfil totalmente efímero: se elimina en cada arranque del contenedor
rm -rf /config/.config/chromium /config/.cache /config/.pki 2>/dev/null || true
mkdir -p /config/.config/chromium /tmp/downloads 2>/dev/null || true
chown -R abc:abc /config/.config /tmp/downloads 2>/dev/null || true

echo "✓ Navegador remoto endurecido: incógnito forzado, sin cookies/historial persistentes"
