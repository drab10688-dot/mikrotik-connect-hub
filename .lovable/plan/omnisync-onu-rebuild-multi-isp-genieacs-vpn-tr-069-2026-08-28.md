# OmniSync ONU — Rebuild multi-ISP (GenieACS + VPN + TR-069)

Borramos todo el panel actual y dejamos una sola aplicación enfocada en gestión de ONUs para varios ISP, con aislamiento total entre ellos.

## 1. Cómo aísla CMS a cada ISP y cómo lo haría yo

CMS genera una URL TR-069 distinta por ISP. Se replica igual, sin montar un ACS por ISP:

```text
ISP A  ->  http://acs.tudominio.com/tr069/a1b2c3d4/    (token del ISP)
ISP B  ->  http://acs.tudominio.com/tr069/9f8e7d6c/
             |
             v  Nginx reescribe y añade cabecera X-Tenant
        GenieACS único (:7547)
             |
             v  preset de provisión guarda tenant_id en el device
```

- Cada ISP (tenant) recibe al crearse un `acs_token` aleatorio y su URL propia.
- Nginx enruta `/tr069/<token>/` al mismo GenieACS añadiendo la cabecera del tenant.
- Un preset de GenieACS escribe `tenant_id` como parámetro virtual en cada ONU en el primer Inform.
- Toda consulta del API filtra por `tenant_id`. Un ISP nunca ve las ONUs de otro, ni por API ni por UI.
- Ventaja frente a un ACS por ISP: un solo proceso, una sola Mongo, mismo rendimiento, alta escala.

## 2. VPN por ISP

- Cada ISP genera desde el panel su script RouterOS listo para pegar (botón "Generar script MikroTik").
- Un solo servidor VPN, un peer/usuario por MikroTik, subred fija por ISP (`10.13.<isp>.0/24`).
- El script incluye: túnel, IP, rutas hacia el VPS, acceso API MikroTik y ruta de la red de ONUs.
- Las credenciales se guardan en base de datos, así que reinstalar el contenedor no rompe el túnel (fue el fallo anterior).
- El VPS mantiene rutas y NAT hacia las redes de ONUs de forma persistente (servicio watchdog).

## 3. Estructura de datos

- `tenants` (ISP): nombre, `acs_token`, `acs_url`, subred VPN, estado.
- `users`: pertenecen a un tenant; `super_admin` global ve todos.
- `roles` + `role_permissions`: permiso `ver`/`editar` por sección (onus, wifi, pppoe, red, firmware, vpn, usuarios).
- `onus`: `tenant_id`, `acs_device_id`, serial, modelo, `pppoe_user`, `alias`, última señal, último Inform.
- `vpn_peers`: `tenant_id`, credenciales, subredes, estado del túnel.
- `onu_events`: historial de cambios y de señal.

## 4. Panel (una sola app, estilo producto comercial)

- **Login** -> selección de ISP (solo super admin) -> Dashboard.
- **Dashboard**: totales online/offline, señal crítica, últimos eventos.
- **ONUs**: tabla con buscador (serial, PPPoE, alias), estado, RX/TX en dBm con semáforo, modelo.
- **Ficha de ONU** (panel lateral, sin recargar): Resumen · WiFi 2.4/5 · PPPoE · Red · Acciones.
- Cambios aplicados al instante: se envía la tarea a GenieACS con Connection Request y se muestra el resultado real (aplicado / esperando ONU), con relectura automática del parámetro.
- Nombre de la ONU = usuario PPPoE automáticamente, más campo **alias** editable.
- Sin factory reset (riesgo de dejar la ONU inaccesible).
- **VPN**: estado del túnel del ISP y generador de script MikroTik.
- **Usuarios y permisos**: administración por ISP.

## 5. Velocidad

- Inform periódico a 60 s, pero cada acción usa Connection Request para aplicar en segundos.
- Lectura de parámetros desde caché en base de datos; la ONU solo se consulta al abrir su ficha o al pulsar refrescar.
- Tráfico por el túnel VPN, no por Internet público.

## 6. Orden de trabajo

1. Limpiar el panel actual (rutas, páginas y componentes ajenos a ONU/ACS/VPN).
2. Esquema de base de datos: tenants, roles/permisos, onus, vpn_peers.
3. Autenticación + selector de ISP + middleware de permisos.
4. Enrutado TR-069 por token en Nginx + preset de GenieACS que marca el tenant.
5. Panel de ONUs con ficha y acciones en vivo.
6. VPN: generador de script y watchdog de rutas.

## Notas técnicas

- Backend: API existente en `vps-stack/api` (se conserva la conexión a GenieACS y a MikroTik, se reescriben las rutas de ONU).
- Frontend: se conservan React/Tailwind y el diseño OmniSync; se eliminan las páginas de facturación, hotspot, vouchers, CMS, PHPNuxBill del menú principal.
- Nada de CMS C-Data en el stack.
