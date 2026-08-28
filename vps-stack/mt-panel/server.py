#!/usr/bin/env python3
"""
OmniSync · Panel web generador de scripts MikroTik (WireGuard)
--------------------------------------------------------------
Mini panel sin dependencias externas (solo stdlib) que:
  • Lista los peers de wg-easy
  • Crea peers nuevos con un clic
  • Descarga el .conf del peer
  • Genera el script RouterOS completo (WG + firewall + NAT OmniSync)

Variables de entorno:
  WG_API        URL interna de wg-easy          (default http://127.0.0.1:51821)
  WG_PASSWORD   contraseña del panel wg-easy
  WG_SUBNET_BASE  prefijo /24 de la VPN         (default 10.13.13)
  WG_PORT       puerto UDP del túnel            (default 51820)
  PANEL_PORT    puerto de este panel            (default 51822)
  PANEL_USER / PANEL_PASS  credenciales básicas de este panel
"""

import base64
import hmac
import json
import os
import re
import urllib.error
import urllib.request
from http.cookiejar import CookieJar
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

WG_API = os.environ.get("WG_API", "http://127.0.0.1:51821").rstrip("/")
WG_PASSWORD = os.environ.get("WG_PASSWORD", "")
SUBNET = os.environ.get("WG_SUBNET_BASE", "10.13.13")
WG_PORT = os.environ.get("WG_PORT", "51820")
PANEL_PORT = int(os.environ.get("PANEL_PORT", "51822"))
PANEL_USER = os.environ.get("PANEL_USER", "admin")
PANEL_PASS = os.environ.get("PANEL_PASS", WG_PASSWORD)
MT_IFACE = os.environ.get("MT_IFACE", "wg-omnisync")
MT_LISTEN_PORT = os.environ.get("MT_LISTEN_PORT", "13231")
CMS_VPN_IP = os.environ.get("CMS_VPN_IP", f"{SUBNET}.1")
CMS_ACS_PORT = os.environ.get("CMS_ACS_PORT", "9909")
CMS_ACS_PATH = os.environ.get("CMS_ACS_PATH", "/v1/acs")

_opener = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(CookieJar())
)


# ── cliente wg-easy ────────────────────────────────────────
def _req(path, method="GET", payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        WG_API + path, data=data, method=method,
        headers={"Content-Type": "application/json"},
    )
    with _opener.open(req, timeout=15) as r:
        body = r.read().decode() or "null"
    try:
        return json.loads(body)
    except ValueError:
        return body


def login():
    for path in ("/api/session", "/api/v1/session"):
        try:
            _req(path, "POST", {"password": WG_PASSWORD, "remember": True})
            return True
        except Exception:
            continue
    return False


def _try(paths, method="GET", payload=None):
    last = None
    for p in paths:
        try:
            return _req(p, method, payload)
        except Exception as e:  # noqa: BLE001
            last = e
    raise last if last else RuntimeError("sin rutas")


def list_clients():
    login()
    data = _try(["/api/wireguard/client", "/api/client"])
    return data if isinstance(data, list) else data.get("clients", [])


def create_client(name):
    login()
    return _try(["/api/wireguard/client", "/api/client"], "POST", {"name": name})


def client_action(cid, action):
    login()
    if action == "delete":
        return _try([f"/api/wireguard/client/{cid}", f"/api/client/{cid}"], "DELETE")
    return _try([f"/api/wireguard/client/{cid}/{action}",
                 f"/api/client/{cid}/{action}"], "POST")


def client_conf(cid):
    login()
    for p in (f"/api/wireguard/client/{cid}/configuration",
              f"/api/client/{cid}/configuration"):
        try:
            req = urllib.request.Request(WG_API + p)
            with _opener.open(req, timeout=15) as r:
                return r.read().decode()
        except Exception:  # noqa: BLE001
            continue
    raise RuntimeError("No se pudo obtener la configuración del peer")


# ── generador RouterOS ─────────────────────────────────────
def val(conf, key):
    m = re.search(rf"^\s*{key}\s*=\s*(.+)$", conf, re.I | re.M)
    return m.group(1).strip() if m else ""


def routeros_script(conf, extra_nets=""):
    priv = val(conf, "PrivateKey")
    addr = val(conf, "Address").split(",")[0].strip()
    pub = val(conf, "PublicKey")
    psk = val(conf, "PresharedKey")
    endpoint = val(conf, "Endpoint")
    client_ip = addr.split("/")[0]
    server_ip = endpoint.split(":")[0]
    port = endpoint.split(":")[-1] if ":" in endpoint else WG_PORT
    if not (priv and client_ip and pub and server_ip):
        raise RuntimeError("Configuración de peer incompleta")

    psk_line = f'  preshared-key="{psk}" \\\n' if psk else ""
    nets = [f"{SUBNET}.0/24"] + [n.strip() for n in extra_nets.split(",") if n.strip()]
    allowed = ",".join(nets)

    return f"""# ============================================
# OmniSync WireGuard - RouterOS v7
# Peer: {client_ip}   |   Servidor: {server_ip}:{port}
# ============================================

# 1) Limpiar configuracion anterior
:do {{ /ip address remove [find where interface={MT_IFACE}] }} on-error={{}}
:do {{ /interface wireguard peers remove [find where interface={MT_IFACE}] }} on-error={{}}
:do {{ /interface wireguard remove [find where name={MT_IFACE}] }} on-error={{}}

# 2) Interfaz WireGuard
/interface wireguard add name={MT_IFACE} listen-port={MT_LISTEN_PORT} private-key="{priv}"

# 3) Peer del servidor VPS
/interface wireguard peers add \\
  interface={MT_IFACE} \\
  public-key="{pub}" \\
{psk_line}  endpoint-address={server_ip} \\
  endpoint-port={port} \\
  allowed-address={allowed} \\
  persistent-keepalive=25

# 4) IP del tunel
/ip address add address={client_ip}/24 interface={MT_IFACE}

# 5) Firewall: API/Winbox desde el VPS
:do {{ /ip firewall filter remove [find where comment="omnisync-vpn-api"] }} on-error={{}}
:do {{ /ip firewall filter remove [find where comment="omnisync-vpn-forward"] }} on-error={{}}
/ip firewall filter add chain=input src-address={SUBNET}.0/24 protocol=tcp \\
  dst-port=8728,8729,8738,8291,80,443 action=accept comment="omnisync-vpn-api" place-before=0

# 6) Forward del tunel hacia ONUs/PPPoE
/ip firewall filter add chain=forward in-interface={MT_IFACE} action=accept \\
  comment="omnisync-vpn-forward" place-before=0
/ip firewall filter add chain=forward out-interface={MT_IFACE} action=accept \\
  comment="omnisync-vpn-forward" place-before=0

# 6.1) NAT del tunel hacia la LAN/ONUs
:do {{ /ip firewall nat remove [find where comment="omnisync-vpn-masq"] }} on-error={{}}
/ip firewall nat add chain=srcnat src-address={SUBNET}.0/24 action=masquerade \\
  comment="omnisync-vpn-masq"

# 7) NAT de salida de las ONUs hacia servicios por el tunel
:do {{ /ip firewall nat remove [find where comment="omnisync-vpn-services"] }} on-error={{}}
/ip firewall nat add chain=srcnat out-interface={MT_IFACE} action=masquerade \\
  comment="omnisync-vpn-services"

# 8) Verificar
:delay 5s
:do {{ /ping {SUBNET}.1 count=3 }} on-error={{ :log warning "WireGuard: sin respuesta del VPS" }}
:log info "WireGuard OmniSync configurado ({client_ip})"
"""


# ── UI ─────────────────────────────────────────────────────
PAGE = """<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OmniSync · Scripts MikroTik WireGuard</title>
<style>
 :root{color-scheme:dark}
 *{box-sizing:border-box}
 body{margin:0;font-family:ui-sans-serif,system-ui,Segoe UI,sans-serif;
      background:radial-gradient(1200px 600px at 20% -10%,#1b2a4a,#0b1120);color:#e6edf7}
 header{padding:28px 24px 8px;max-width:1000px;margin:0 auto}
 h1{margin:0;font-size:22px;letter-spacing:.3px}
 h1 span{background:linear-gradient(90deg,#22d3ee,#a78bfa);-webkit-background-clip:text;color:transparent}
 p.sub{margin:6px 0 0;color:#93a3bd;font-size:14px}
 main{max-width:1000px;margin:0 auto;padding:16px 24px 60px}
 .card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);
       border-radius:16px;padding:18px;margin-bottom:18px;backdrop-filter:blur(8px)}
 .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
 input{flex:1;min-width:180px;padding:10px 12px;border-radius:10px;
       border:1px solid rgba(255,255,255,.15);background:rgba(0,0,0,.25);color:#e6edf7}
 button{padding:10px 16px;border:0;border-radius:10px;cursor:pointer;font-weight:600;
        background:linear-gradient(90deg,#22d3ee,#7c3aed);color:#06121f}
 button.sec{background:rgba(255,255,255,.1);color:#e6edf7}
 table{width:100%;border-collapse:collapse;font-size:14px}
 th,td{text-align:left;padding:10px 8px;border-bottom:1px solid rgba(255,255,255,.08)}
 th{color:#93a3bd;font-weight:500}
 .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
 pre{white-space:pre-wrap;word-break:break-word;background:#060b16;border-radius:12px;
     padding:14px;max-height:420px;overflow:auto;font-size:12.5px;line-height:1.45}
 .muted{color:#93a3bd;font-size:13px}
</style></head><body>
<header>
 <h1><span>OmniSync</span> · Generador WireGuard para MikroTik</h1>
  <p class="sub">Crea peers y copia el script RouterOS completo para acceso remoto por VPN.</p>
</header>
<main>
 <div class="card">
  <div class="row">
   <input id="name" placeholder="Nombre del peer (ej. mikrotik-torre1)">
   <button onclick="crear()">Crear peer</button>
   <button class="sec" onclick="cargar()">Actualizar</button>
  </div>
 </div>
 <div class="card">
  <table><thead><tr><th>Peer</th><th>IP VPN</th><th>Estado</th><th></th></tr></thead>
  <tbody id="tb"><tr><td colspan="4" class="muted">Cargando…</td></tr></tbody></table>
 </div>
  <div class="card">
   <strong>Enlace posterior con CMS</strong>
   <p class="muted">Cuando instales el CMS, configura las ONUs con esta URL TR-069:</p>
   <pre>http://CMS_VPN_IP:CMS_ACS_PORTCMS_ACS_PATH</pre>
  </div>
  <div class="card" id="out" style="display:none">
  <div class="row" style="justify-content:space-between">
   <strong id="outTitle">Script RouterOS</strong>
   <div class="row">
    <input id="nets" placeholder="Redes extra: 10.82.0.0/21,192.168.20.0/24" style="min-width:260px">
    <button class="sec" onclick="regen()">Regenerar</button>
    <button onclick="copiar()">Copiar</button>
   </div>
  </div>
  <pre id="script"></pre>
   <p class="muted">Pégalo completo en Winbox → New Terminal.</p>
 </div>
</main>
<script>
let actual=null;
async function cargar(){
 const tb=document.getElementById('tb');
 try{
   const r=await fetch('/api/peers'); if(!r.ok) throw new Error(await r.text()); const d=await r.json();
  if(!d.length){tb.innerHTML='<tr><td colspan="4" class="muted">Sin peers todavía.</td></tr>';return}
   tb.innerHTML=d.map(c=>`<tr>
    <td>${esc(c.name)}</td><td>${esc(c.address||'')}</td>
   <td><span class="dot" style="background:${c.enabled===false?'#f87171':'#34d399'}"></span>${c.enabled===false?'Deshabilitado':'Activo'}</td>
   <td style="text-align:right">
      <button class="sec" onclick='gen(${JSON.stringify(c.id)},${JSON.stringify(c.name)})'>Script MikroTik</button>
     <button class="sec" onclick="location.href='/api/conf?id=${c.id}'">.conf</button>
      <button class="sec" onclick='estado(${JSON.stringify(c.id)},${c.enabled===false?'"enable"':'"disable"'})'>${c.enabled===false?'Activar':'Pausar'}</button>
      <button class="sec" onclick='borrar(${JSON.stringify(c.id)},${JSON.stringify(c.name)})'>Eliminar</button>
   </td></tr>`).join('');
 }catch(e){tb.innerHTML='<tr><td colspan="4" class="muted">Error: '+e+'</td></tr>'}
}
async function crear(){
 const n=document.getElementById('name').value.trim(); if(!n)return;
  const r=await fetch('/api/peers',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({name:n})});
  if(!r.ok){alert(await r.text());return}
 document.getElementById('name').value=''; cargar();
}
function esc(v){const d=document.createElement('div');d.textContent=String(v??'');return d.innerHTML}
async function estado(id,action){const r=await fetch('/api/peers?id='+encodeURIComponent(id)+'&action='+action,{method:'PATCH'});if(!r.ok)alert(await r.text());cargar()}
async function borrar(id,name){if(!confirm('¿Eliminar el peer '+name+'?'))return;const r=await fetch('/api/peers?id='+encodeURIComponent(id),{method:'DELETE'});if(!r.ok)alert(await r.text());cargar()}
async function gen(id,name){
 actual={id,name};
 const nets=document.getElementById('nets').value.trim();
 const r=await fetch('/api/script?id='+encodeURIComponent(id)+'&nets='+encodeURIComponent(nets));
 const t=await r.text();
 document.getElementById('out').style.display='block';
 document.getElementById('outTitle').textContent='Script RouterOS · '+name;
 document.getElementById('script').textContent=t;
 window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'});
}
function regen(){ if(actual) gen(actual.id,actual.name) }
function copiar(){ navigator.clipboard.writeText(document.getElementById('script').textContent);}
cargar();
</script></body></html>"""


class Handler(BaseHTTPRequestHandler):
    server_version = "OmniSyncMT/1.0"

    def log_message(self, *a):  # silencio
        pass

    def _auth_ok(self):
        if not PANEL_PASS:
            return True
        h = self.headers.get("Authorization", "")
        if not h.startswith("Basic "):
            return False
        try:
            user, _, pw = base64.b64decode(h[6:]).decode().partition(":")
        except Exception:  # noqa: BLE001
            return False
        return hmac.compare_digest(user, PANEL_USER) and hmac.compare_digest(pw, PANEL_PASS)

    def _deny(self):
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="OmniSync"')
        self.end_headers()

    def _send(self, code, body, ctype="text/plain; charset=utf-8", extra=None):
        data = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _query(self):
        from urllib.parse import parse_qs, urlparse
        return {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}

    def do_GET(self):  # noqa: N802
        if not self._auth_ok():
            return self._deny()
        path = self.path.split("?")[0]
        try:
            if path == "/":
                page = (PAGE.replace("CMS_VPN_IP", CMS_VPN_IP)
                        .replace("CMS_ACS_PORT", CMS_ACS_PORT)
                        .replace("CMS_ACS_PATH", CMS_ACS_PATH))
                return self._send(200, page,
                                  "text/html; charset=utf-8")
            if path == "/api/peers":
                out = [{"id": c.get("id"), "name": c.get("name"),
                        "address": c.get("address"), "enabled": c.get("enabled", True)}
                       for c in list_clients()]
                return self._send(200, json.dumps(out), "application/json")
            if path == "/api/conf":
                cid = self._query().get("id", "")
                conf = client_conf(cid)
                return self._send(200, conf, "text/plain; charset=utf-8",
                                  {"Content-Disposition": f'attachment; filename="{cid}.conf"'})
            if path == "/api/script":
                q = self._query()
                conf = client_conf(q.get("id", ""))
                return self._send(200, routeros_script(conf, q.get("nets", "")))
            self._send(404, "no encontrado")
        except Exception as e:  # noqa: BLE001
            self._send(500, f"Error: {e}")

    def do_POST(self):  # noqa: N802
        if not self._auth_ok():
            return self._deny()
        if self.path.split("?")[0] != "/api/peers":
            return self._send(404, "no encontrado")
        try:
            n = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(n) or b"{}")
            create_client((body.get("name") or "peer").strip())
            self._send(200, json.dumps({"ok": True}), "application/json")
        except Exception as e:  # noqa: BLE001
            self._send(500, f"Error: {e}")

    def do_PATCH(self):  # noqa: N802
        if not self._auth_ok():
            return self._deny()
        if self.path.split("?")[0] != "/api/peers":
            return self._send(404, "no encontrado")
        try:
            q = self._query()
            action = q.get("action", "")
            if action not in ("enable", "disable"):
                return self._send(400, "acción inválida")
            client_action(q.get("id", ""), action)
            self._send(200, json.dumps({"ok": True}), "application/json")
        except Exception as e:  # noqa: BLE001
            self._send(500, f"Error: {e}")

    def do_DELETE(self):  # noqa: N802
        if not self._auth_ok():
            return self._deny()
        if self.path.split("?")[0] != "/api/peers":
            return self._send(404, "no encontrado")
        try:
            client_action(self._query().get("id", ""), "delete")
            self._send(200, json.dumps({"ok": True}), "application/json")
        except Exception as e:  # noqa: BLE001
            self._send(500, f"Error: {e}")


if __name__ == "__main__":
    print(f"OmniSync MT panel en :{PANEL_PORT} (wg-easy: {WG_API})", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PANEL_PORT), Handler).serve_forever()
