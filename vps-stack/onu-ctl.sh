#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# onu-ctl.sh — Control de ONUs por comando contra GenieACS (NBI)
#
# Uso:
#   ./onu-ctl.sh list
#   ./onu-ctl.sh info      <deviceId>
#   ./onu-ctl.sh radios    <deviceId>
#   ./onu-ctl.sh wifi      <deviceId> <index> <SSID> <PASSWORD> [canal]
#   ./onu-ctl.sh wifi-off  <deviceId> <index>
#   ./onu-ctl.sh wifi-on   <deviceId> <index>
#   ./onu-ctl.sh catv      <deviceId> on|off
#   ./onu-ctl.sh power     <deviceId>
#   ./onu-ctl.sh uptime    <deviceId>
#   ./onu-ctl.sh refresh   <deviceId>
#   ./onu-ctl.sh reboot    <deviceId>
#
# Variables:
#   NBI=http://localhost:7557   (URL del NBI de GenieACS)
# ─────────────────────────────────────────────────────────────
set -euo pipefail

NBI="${NBI:-http://localhost:7557}"
WLAN="InternetGatewayDevice.LANDevice.1.WLANConfiguration"
DI="InternetGatewayDevice.DeviceInfo"

need() { [ -n "${1:-}" ] || { echo "Falta argumento. Ver: $0 (sin args)"; exit 1; }; }
enc()  { printf '%s' "$1" | jq -sRr @uri; }

task() { # task <deviceId> <json>
  curl -sS -X POST "$NBI/devices/$(enc "$1")/tasks?connection_request" \
    -H 'Content-Type: application/json' -d "$2"
  echo
}

case "${1:-help}" in
  list)
    curl -sS "$NBI/devices/?projection=_id,$DI.Manufacturer,$DI.ModelName,$DI.SerialNumber,_lastInform" | jq -r \
      '.[] | [._id, (.InternetGatewayDevice.DeviceInfo.Manufacturer._value // "-"),
              (.InternetGatewayDevice.DeviceInfo.ModelName._value // "-"),
              (.InternetGatewayDevice.DeviceInfo.SerialNumber._value // "-"),
              (._lastInform // "-")] | @tsv'
    ;;

  info)
    need "${2:-}"; curl -sS "$NBI/devices/$(enc "$2")" | jq .
    ;;

  radios) # lista todas las radios con SSID, estado, canal (detecta dual band)
    need "${2:-}"
    curl -sS "$NBI/devices/$(enc "$2")" | jq -r '
      .InternetGatewayDevice.LANDevice["1"].WLANConfiguration
      | to_entries[] | select(.key|startswith("_")|not)
      | [ .key,
          (.value.SSID._value // "-"),
          (.value.Enable._value|tostring),
          (.value.Channel._value|tostring),
          (if ((.value.Channel._value // 0) > 14) then "5GHz" else "2.4GHz" end),
          (.value.KeyPassphrase._value // .value.PreSharedKey["1"].KeyPassphrase._value // "-")
        ] | @tsv'
    ;;

  wifi) # wifi <id> <index> <ssid> <pass> [canal]
    need "${2:-}"; need "${3:-}"; need "${4:-}"; need "${5:-}"
    P="$WLAN.$3"
    PV="[[\"$P.SSID\",\"$4\",\"xsd:string\"],
         [\"$P.PreSharedKey.1.PreSharedKey\",\"$5\",\"xsd:string\"],
         [\"$P.PreSharedKey.1.KeyPassphrase\",\"$5\",\"xsd:string\"],
         [\"$P.KeyPassphrase\",\"$5\",\"xsd:string\"]"
    if [ -n "${6:-}" ]; then
      PV="$PV,[\"$P.AutoChannelEnable\",false,\"xsd:boolean\"],[\"$P.Channel\",$6,\"xsd:unsignedInt\"]"
    fi
    PV="$PV]"
    task "$2" "{\"name\":\"setParameterValues\",\"parameterValues\":$PV}"
    ;;

  wifi-on|wifi-off)
    need "${2:-}"; need "${3:-}"
    EN=$([ "$1" = "wifi-on" ] && echo true || echo false)
    task "$2" "{\"name\":\"setParameterValues\",\"parameterValues\":[[\"$WLAN.$3.Enable\",$EN,\"xsd:boolean\"]]}"
    ;;

  catv) # catv <id> on|off  — prueba las rutas CATV más comunes
    need "${2:-}"; need "${3:-}"
    EN=$([ "$3" = "on" ] && echo true || echo false)
    for P in \
      "InternetGatewayDevice.X_CATV.Enable" \
      "InternetGatewayDevice.Services.X_CATV.Enable" \
      "InternetGatewayDevice.X_HW_CATV.Enable" \
      "InternetGatewayDevice.WANDevice.1.X_CATV_Config.Enable" \
      "InternetGatewayDevice.X_ZTE-COM_CATV.Enable" \
      "InternetGatewayDevice.X_CT-COM_CATV.Enable" \
      "InternetGatewayDevice.X_ZYXEL_CATV.Enable"; do
      echo "-> $P"
      task "$2" "{\"name\":\"setParameterValues\",\"parameterValues\":[[\"$P\",$EN,\"xsd:boolean\"]]}" || true
    done
    ;;

  power) # potencia óptica Rx/Tx (multi-marca)
    need "${2:-}"
    curl -sS "$NBI/devices/$(enc "$2")" | jq -r '
      def find(k): [paths(objects) as $p | select(($p|last|tostring)==k) | getpath($p)._value] | map(select(.!=null)) | first;
      "RxPower: \(find("RXPower") // find("RxPower") // "N/A")\nTxPower: \(find("TXPower") // find("TxPower") // "N/A")"'
    ;;

  uptime)
    need "${2:-}"
    curl -sS "$NBI/devices/$(enc "$2")" | jq -r '
      (.InternetGatewayDevice.DeviceInfo.UpTime._value // 0) as $u
      | "Uptime: \(($u/86400|floor))d \((($u%86400)/3600)|floor)h \((($u%3600)/60)|floor)m"'
    ;;

  refresh) # pide a la ONU releer WiFi / DeviceInfo / WAN (potencia)
    need "${2:-}"
    for O in "$WLAN" "$DI" "InternetGatewayDevice.WANDevice.1"; do
      task "$2" "{\"name\":\"refreshObject\",\"objectName\":\"$O\"}" || true
    done
    ;;

  reboot)
    need "${2:-}"; task "$2" '{"name":"reboot"}'
    ;;

  *)
    sed -n '2,25p' "$0"
    ;;
esac
