# OmniACS — Panel nuevo de gestión de ONUs multi-ISP

Sistema web nuevo, dedicado únicamente a **gestión de ONUs por TR-069 + VPN L2TP**, para varios ISP. Sustituye al panel actual (facturación, hotspot, vouchers, RADIUS, NuxBill, CMS quedan fuera del menú). Objetivo: lo mismo que hace C-Data CMS pero rápido, moderno y modificable.

## Corrección inmediata (ya aplicada)
Nginx no arrancaba por la regex `^/tr069/([a-f0-9]{8,64})/?(.*)$`: nginx interpreta `{}` como bloques. Se encerró la expresión entre comillas. Con esto el stack instalado levanta.

## Qué se construye

### 1. Menú nuevo (sólo 6 secciones)
```text
Dashboard        Estado del ISP: ONUs online/offline, señal promedio, alertas
ONUs             Tabla en vivo: PPPoE, alias, modelo, RX/TX dBm, uptime, WiFi
Ficha de ONU     Resumen · WiFi · PPPoE · Red · Diagnóstico · Acciones
TR-069 y VPN     Enlace ACS del ISP + generador de script MikroTik (L2TP)
Administración   ISPs (tenants), usuarios, roles y permisos por sección
Diagnóstico      Ping, puerto 7547, estado del túnel, último Inform
```

### 2. Multi-ISP con aislamiento real
- Cada ISP (tenant) tiene su **token ACS propio** → URL `http://<vps>/tr069/<token>/`.
- Un solo GenieACS atiende a todos; Nginx inyecta `X-Tenant-Token` y el API marca cada ONU con su `tenant_id`.
- Toda consulta de ONU filtra por `tenant_id`: un ISP nunca ve equipos de otro.
- Cada ISP tiene su propia subred L2TP y sus redes de ONU declaradas.

### 3. VPN L2TP/IPsec como vía principal
- Servidor L2TP ya instalado en el VPS.
- El panel genera un **script `.rsc` completo listo para copiar/pegar** en la terminal MikroTik: túnel L2TP, PSK/usuario/clave, firewall, NAT hacia la red de ONUs, servicios API/Winbox y la URL TR-069 del ISP.
- Botones: Copiar (con fallback si el navegador bloquea el portapapeles) y Descargar `.rsc`.

### 4. Panel de ONUs (lo visual)
- Tabla con búsqueda, filtros (online/offline/señal crítica) y refresco automático.
- Medidor de señal óptica con color: verde ≥ -25, ámbar -25 a -28, rojo < -28 dBm.
- WiFi: SSID y contraseña visibles por banda (2.4 / 5 GHz), canal, estado; edición y aplicación inmediata vía Connection Request.
- Nombre de la ONU = usuario PPPoE automáticamente; campo **alias editable** aparte.
- Acciones: reiniciar, refrescar parámetros, ver historial de eventos. **Sin factory reset.**
- Marcado offline si no llega Inform en 5 minutos.

### 5. Roles y permisos
- Roles `super_admin > admin > user`, más permisos por sección (ONUs, VPN/ACS, admin, diagnóstico).
- Superadmin ve y cambia entre todos los ISP; cada ISP administra sus propios usuarios.

## Detalles técnicos
- Frontend React + Tailwind; se reemplaza `App.tsx` y el sidebar por el menú reducido, se retiran del enrutado las páginas de facturación/hotspot/vouchers/portal/RADIUS (los archivos se conservan sin enlazar, no se borran).
- Backend: se reutiliza `vps-stack/api/src/routes/isp.ts`, `onu.ts`, `genieacs.ts`, `vpn.ts` y el esquema multi-ISP ya creado; se completan los endpoints de alias, WiFi y eventos.
- Instalador: `install.sh` se recorta para no levantar PHPNuxBill, FreeRADIUS, Mikhmon ni coturn; deja Postgres, API, GenieACS+Mongo, Nginx, L2TP y frontend.
- Diseño: tema oscuro con acento cian/violeta y superficies tipo glass, coherente con la marca OmniSync.

## Orden de trabajo
1. Recortar instalador y compose (sin NuxBill/RADIUS/Mikhmon/coturn/CMS).
2. Menú y enrutado nuevos, limpieza del sidebar.
3. Dashboard + tabla de ONUs en vivo.
4. Ficha de ONU (WiFi, PPPoE, red, señal, alias, acciones).
5. Página TR-069/VPN con generador y copia del script MikroTik.
6. Administración de ISPs, usuarios y permisos.
