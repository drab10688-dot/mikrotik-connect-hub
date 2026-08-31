#!/usr/bin/env bash
# =============================================================================
#  OmniSync · Configuración visual de GenieACS (columnas + parámetros virtuales)
#  Uso:  bash genieacs-config.sh
#  Var:  MONGO_CONTAINER (por defecto omnisync-mongo)
#        GENIEACS_CONTAINER (por defecto omnisync-genieacs)
#        NBI_URL (por defecto http://localhost:7557)
# =============================================================================
set -euo pipefail

MONGO_CONTAINER="${MONGO_CONTAINER:-omnisync-mongo}"
GENIEACS_CONTAINER="${GENIEACS_CONTAINER:-omnisync-genieacs}"
NBI_URL="${NBI_URL:-http://localhost:7557}"
DB="${DB:-genieacs}"
ACS_HOST="${ACS_HOST:-10.13.13.1}"
ACS_PORT="${ACS_PORT:-7547}"
ACS_INFORM_INTERVAL="${ACS_INFORM_INTERVAL:-60}"
# Credenciales de Connection Request (el ACS las escribe en la ONU y las usa
# para despertarla al instante). Sin esto, cada orden espera al próximo Inform.
ACS_CR_USER="${ACS_CR_USER:-omnisync}"
ACS_CR_PASS="${ACS_CR_PASS:-OmniSync2026}"

c_ok(){ echo -e "\033[0;32m✓\033[0m $*"; }
c_inf(){ echo -e "\033[0;36m•\033[0m $*"; }
c_err(){ echo -e "\033[0;31m✗\033[0m $*"; }

if ! docker ps --format '{{.Names}}' | grep -q "^${MONGO_CONTAINER}$"; then
  # autodetectar contenedor de mongo
  MONGO_CONTAINER="$(docker ps --format '{{.Names}}' | grep -iE 'mongo' | head -n1 || true)"
fi
[ -z "$MONGO_CONTAINER" ] && { c_err "No encuentro el contenedor de MongoDB"; exit 1; }
c_inf "MongoDB: $MONGO_CONTAINER"

MONGO_BIN=mongosh
docker exec "$MONGO_CONTAINER" which mongosh >/dev/null 2>&1 || MONGO_BIN=mongo
c_inf "Cliente Mongo: $MONGO_BIN"

read -r -d '' JS <<'EOJS' || true
function put(id, value) {
  db.config.replaceOne({_id: id}, {_id: id, value: value}, {upsert: true});
}

// ---------- Columnas de la lista de dispositivos ----------
put('ui.index.0.label', '"Serial"');
put('ui.index.0.parameter', 'DeviceID.SerialNumber');

put('ui.index.1.label', '"Modelo"');
put('ui.index.1.parameter', 'DeviceID.ProductClass');

put('ui.index.2.label', '"Fabricante"');
put('ui.index.2.parameter', 'DeviceID.Manufacturer');

put('ui.index.3.label', '"Firmware"');
put('ui.index.3.parameter', 'InternetGatewayDevice.DeviceInfo.SoftwareVersion');

put('ui.index.4.label', '"IP"');
put('ui.index.4.parameter', 'InternetGatewayDevice.ManagementServer.ConnectionRequestURL');
put('ui.index.4.type', '"ping"');

put('ui.index.5.label', '"SSID 2.4G"');
put('ui.index.5.parameter', 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID');
put('ui.index.5.writable', 'true');

put('ui.index.6.label', '"SSID 5G"');
put('ui.index.6.parameter', 'VirtualParameters.SSID5G');

put('ui.index.7.label', '"PON Rx (dBm)"');
put('ui.index.7.parameter', 'VirtualParameters.PonRx');

put('ui.index.8.label', '"PON Tx (dBm)"');
put('ui.index.8.parameter', 'VirtualParameters.PonTx');

put('ui.index.9.label', '"IP WAN"');
put('ui.index.9.parameter', 'VirtualParameters.WanIP');

put('ui.index.9.label', '"Clave 2.4G"');
put('ui.index.9.parameter', 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase');
put('ui.index.9.writable', 'true');

put('ui.index.10.label', '"Clave 5G"');
put('ui.index.10.parameter', 'VirtualParameters.Key5G');

put('ui.index.11.label', '"Usuario PPPoE"');
put('ui.index.11.parameter', 'VirtualParameters.PppoeUser');

put('ui.index.12.label', '"Estado PPPoE"');
put('ui.index.12.parameter', 'VirtualParameters.PppoeStatus');

put('ui.index.13.label', '"Uptime"');
put('ui.index.13.parameter', 'VirtualParameters.Uptime');

put('ui.index.14.label', '"Último inform"');
put('ui.index.14.parameter', 'Events.Inform');
put('ui.index.14.type', '"timestamp"');

put('ui.index.15.label', '"Etiquetas"');
put('ui.index.15.parameter', 'Tags');
put('ui.index.15.type', '"tags"');


// ---------- Página de detalle: resumen superior ----------
put('ui.device.0.type', '"parameter-list"');
put('ui.device.0.label', '"\'Identificación\'"');
put('ui.device.0.parameters.0.label', '"Serial"');
put('ui.device.0.parameters.0.parameter', 'DeviceID.SerialNumber');
put('ui.device.0.parameters.1.label', '"Fabricante"');
put('ui.device.0.parameters.1.parameter', 'DeviceID.Manufacturer');
put('ui.device.0.parameters.2.label', '"Modelo"');
put('ui.device.0.parameters.2.parameter', 'DeviceID.ProductClass');
put('ui.device.0.parameters.3.label', '"Firmware"');
put('ui.device.0.parameters.3.parameter', 'InternetGatewayDevice.DeviceInfo.SoftwareVersion');
put('ui.device.0.parameters.4.label', '"Uptime"');
put('ui.device.0.parameters.4.parameter', 'VirtualParameters.Uptime');

put('ui.device.1.type', '"parameter-list"');
put('ui.device.1.label', '"\'Óptica / WAN\'"');
put('ui.device.1.parameters.0.label', '"PON Rx (dBm)"');
put('ui.device.1.parameters.0.parameter', 'VirtualParameters.PonRx');
put('ui.device.1.parameters.1.label', '"PON Tx (dBm)"');
put('ui.device.1.parameters.1.parameter', 'VirtualParameters.PonTx');
put('ui.device.1.parameters.2.label', '"IP WAN"');
put('ui.device.1.parameters.2.parameter', 'VirtualParameters.WanIP');
put('ui.device.1.parameters.3.label', '"Usuario PPPoE"');
put('ui.device.1.parameters.3.parameter', 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username');
put('ui.device.1.parameters.3.writable', 'true');
put('ui.device.1.parameters.4.label', '"Clave PPPoE"');
put('ui.device.1.parameters.4.parameter', 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Password');
put('ui.device.1.parameters.4.writable', 'true');
put('ui.device.1.parameters.5.label', '"Estado PPPoE"');
put('ui.device.1.parameters.5.parameter', 'VirtualParameters.PppoeStatus');


put('ui.device.2.type', '"parameter-list"');
put('ui.device.2.label', '"\'WiFi 2.4 GHz\'"');
put('ui.device.2.parameters.0.label', '"SSID"');
put('ui.device.2.parameters.0.parameter', 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID');
put('ui.device.2.parameters.0.writable', 'true');
put('ui.device.2.parameters.1.label', '"Clave"');
put('ui.device.2.parameters.1.parameter', 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase');
put('ui.device.2.parameters.1.writable', 'true');
put('ui.device.2.parameters.2.label', '"Habilitado"');
put('ui.device.2.parameters.2.parameter', 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Enable');
put('ui.device.2.parameters.2.writable', 'true');

put('ui.device.3.type', '"parameter-list"');
put('ui.device.3.label', '"\'WiFi 5 GHz\'"');
put('ui.device.3.parameters.0.label', '"SSID"');
put('ui.device.3.parameters.0.parameter', 'VirtualParameters.SSID5G');
put('ui.device.3.parameters.1.label', '"Clave"');
put('ui.device.3.parameters.1.parameter', 'VirtualParameters.Key5G');

put('ui.device.4.type', '"device-actions"');
put('ui.device.5.type', '"tags"');
put('ui.device.6.type', '"all-parameters"');

// ---------- Filtros rápidos ----------
put('ui.filters.0.label', '"Serial"');
put('ui.filters.0.parameter', 'DeviceID.SerialNumber');
put('ui.filters.0.type', '"string"');
put('ui.filters.1.label', '"Modelo"');
put('ui.filters.1.parameter', 'DeviceID.ProductClass');
put('ui.filters.1.type', '"string"');
put('ui.filters.2.label', '"Etiqueta"');
put('ui.filters.2.parameter', 'Tags');
put('ui.filters.2.type', '"string"');

print('CONFIG_OK');
EOJS

echo "$JS" | docker exec -i "$MONGO_CONTAINER" $MONGO_BIN "$DB" --quiet >/tmp/genieacs-cfg.log 2>&1 || {
  c_err "Error escribiendo config en Mongo"; cat /tmp/genieacs-cfg.log; exit 1; }
grep -q CONFIG_OK /tmp/genieacs-cfg.log && c_ok "Columnas y vistas configuradas"

# ---------------- Parámetros virtuales (vía NBI) ----------------
vparam () {
  local name="$1"; local script="$2"
  if curl -sf -X PUT "$NBI_URL/virtual_parameters/$name" \
      -H 'Content-Type: text/plain' --data-binary "$script" >/dev/null; then
    c_ok "VirtualParameter $name"
  else
    c_err "No se pudo crear $name (NBI: $NBI_URL)"
  fi
}

read -r -d '' VP_PONRX <<'EOF' || true
const paths = [
  "InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.RXPower",
  "InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.RXPower",
  "InternetGatewayDevice.WANDevice.1.X_CU_PonInterfaceConfig.RXPower",
  "InternetGatewayDevice.WANDevice.1.X_GponInterfaceConfig.RXPower",
  "InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.RXPower",
  "InternetGatewayDevice.WANDevice.1.X_HW_PonInterface.RxPower",
  "InternetGatewayDevice.WANDevice.1.WANPONInterfaceConfig.RXPower"
];
let v = null;
for (const p of paths) { const d = declare(p, {value: Date.now() - 300000}); if (d.value) { v = d.value[0]; break; } }
if (v === null) return {writable: false, value: ["", "string"]};
let n = parseFloat(v);
if (!isNaN(n) && Math.abs(n) > 100) n = n / 10;
return {writable: false, value: [isNaN(n) ? String(v) : n.toFixed(2), "string"]};
EOF

read -r -d '' VP_PONTX <<'EOF' || true
const paths = [
  "InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.TXPower",
  "InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.TXPower",
  "InternetGatewayDevice.WANDevice.1.X_CU_PonInterfaceConfig.TXPower",
  "InternetGatewayDevice.WANDevice.1.X_GponInterfaceConfig.TXPower",
  "InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.TXPower",
  "InternetGatewayDevice.WANDevice.1.X_HW_PonInterface.TxPower",
  "InternetGatewayDevice.WANDevice.1.WANPONInterfaceConfig.TXPower"
];
let v = null;
for (const p of paths) { const d = declare(p, {value: Date.now() - 300000}); if (d.value) { v = d.value[0]; break; } }
if (v === null) return {writable: false, value: ["", "string"]};
let n = parseFloat(v);
if (!isNaN(n) && Math.abs(n) > 100) n = n / 10;
return {writable: false, value: [isNaN(n) ? String(v) : n.toFixed(2), "string"]};
EOF

read -r -d '' VP_UPTIME <<'EOF' || true
const d = declare("InternetGatewayDevice.DeviceInfo.UpTime", {value: Date.now() - 300000});
if (!d.value) return {writable: false, value: ["", "string"]};
const s = parseInt(d.value[0]) || 0;
const dd = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), mm = Math.floor((s % 3600) / 60);
return {writable: false, value: [dd + "d " + hh + "h " + mm + "m", "string"]};
EOF

read -r -d '' VP_WANIP <<'EOF' || true
const d = declare("InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANPPPConnection.*.ExternalIPAddress", {value: Date.now() - 300000});
let ip = "";
for (const x of d) { if (x.value && x.value[0]) { ip = x.value[0]; break; } }
if (!ip) {
  const d2 = declare("InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANIPConnection.*.ExternalIPAddress", {value: Date.now() - 300000});
  for (const x of d2) { if (x.value && x.value[0]) { ip = x.value[0]; break; } }
}
return {writable: false, value: [ip, "string"]};
EOF

read -r -d '' VP_SSID5G <<'EOF' || true
const idx = [5, 9, 2, 6];
for (const i of idx) {
  const d = declare("InternetGatewayDevice.LANDevice.1.WLANConfiguration." + i + ".SSID", {value: Date.now() - 300000});
  if (d.value && d.value[0]) return {writable: false, value: [d.value[0], "string"]};
}
return {writable: false, value: ["", "string"]};
EOF

read -r -d '' VP_KEY5G <<'EOF' || true
const idx = [5, 9, 2, 6];
for (const i of idx) {
  const d = declare("InternetGatewayDevice.LANDevice.1.WLANConfiguration." + i + ".PreSharedKey.1.KeyPassphrase", {value: Date.now() - 300000});
  if (d.value && d.value[0]) return {writable: false, value: [d.value[0], "string"]};
}
return {writable: false, value: ["", "string"]};
EOF

vparam PonRx   "$VP_PONRX"
vparam PonTx   "$VP_PONTX"
vparam Uptime  "$VP_UPTIME"
vparam WanIP   "$VP_WANIP"
vparam SSID5G  "$VP_SSID5G"
vparam Key5G   "$VP_KEY5G"

read -r -d '' VP_PPPOEUSER <<'EOF' || true
const d = declare("InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANPPPConnection.*.Username", {value: Date.now() - 300000});
for (const x of d) { if (x.value && x.value[0]) return {writable: false, value: [x.value[0], "string"]}; }
return {writable: false, value: ["", "string"]};
EOF

read -r -d '' VP_PPPOESTATUS <<'EOF' || true
const d = declare("InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANPPPConnection.*.ConnectionStatus", {value: Date.now() - 300000});
for (const x of d) { if (x.value && x.value[0]) return {writable: false, value: [x.value[0], "string"]}; }
return {writable: false, value: ["", "string"]};
EOF

vparam PppoeUser   "$VP_PPPOEUSER"
vparam PppoeStatus "$VP_PPPOESTATUS"


# ---------------- Preset periódico liviano (único) ----------------
# No refrescar árboles completos en cada Inform: ocupa la sesión CWMP y retrasa
# las órdenes interactivas (WiFi/PPPoE). La API pide refreshObject bajo demanda.
#
# IMPORTANTE: solo se declara el modelo de datos que la ONU realmente expone.
# Declarar InternetGatewayDevice.* y Device.* a la vez provoca fault 9005
# (parámetro inexistente) y aborta la sesión completa -> la ONU deja de reportar.
#
# La URL y credenciales NO se fuerzan: son distintas por ISP y deben conservar
# el token /tr069/<token>/. Sobrescribirlas rompe el aislamiento multi-ISP.
PROV=$(cat <<EOF
const igd = declare("InternetGatewayDevice.ManagementServer.PeriodicInformEnable", {value: 1});
const root = (igd.size > 0) ? "InternetGatewayDevice" : "Device";

// La URL con /tr069/<token>/ es la fuente de verdad del aislamiento multi-ISP:
// hay que LEERLA en cada Inform (sin escribirla) o el dispositivo queda sin dueño.
declare(root + ".ManagementServer.URL", {value: Date.now()});

declare(root + ".ManagementServer.PeriodicInformEnable", {value: Date.now()}, {value: true});
declare(root + ".ManagementServer.PeriodicInformInterval", {value: Date.now()}, {value: ${ACS_INFORM_INTERVAL}});

// Sin NAT dentro del túnel VPN: STUN no es necesario (y añade latencia)
try {
  declare(root + ".ManagementServer.STUNEnable", {value: Date.now()}, {value: false});
} catch (e) {}
EOF
)

curl -sf -X PUT "$NBI_URL/provisions/omnisync-refresh" -H 'Content-Type: text/plain' \
  --data-binary "$PROV" >/dev/null && c_ok "Provision omnisync-refresh" || c_err "Provision falló"

curl -sf -X PUT "$NBI_URL/presets/omnisync-refresh" -H 'Content-Type: application/json' \
  --data '{"weight":0,"precondition":"{}","configurations":[{"type":"provision","name":"omnisync-refresh"}]}' \
  >/dev/null && c_ok "Preset omnisync-refresh" || c_err "Preset falló"

# Eliminar el preset/provision duplicado de versiones anteriores que competía
# por los mismos parámetros y declaraba ambos modelos de datos.
curl -sf -X DELETE "$NBI_URL/presets/omnisync-acs-wg" >/dev/null 2>&1 || true
curl -sf -X DELETE "$NBI_URL/provisions/omnisync-acs-wg" >/dev/null 2>&1 || true
c_ok "Preset duplicado omnisync-acs-wg eliminado"


docker restart "$GENIEACS_CONTAINER" >/dev/null 2>&1 && c_ok "GenieACS reiniciado" || true

echo
c_ok "Listo. Abre GenieACS, pulsa Ctrl+Shift+R y presiona 'Summon' en la ONU para poblar las columnas."
c_ok "TR-069 escuchando por WireGuard: http://${ACS_HOST}:${ACS_PORT}/ (inform cada ${ACS_INFORM_INTERVAL}s)"

