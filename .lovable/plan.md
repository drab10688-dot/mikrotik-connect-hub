# Panel de ONUs multi-ISP con permisos (base limpia)

Objetivo: un panel de gestión de ONUs (GenieACS) con calidad de producto comercial, aislado por ISP, con permisos por sección, cambios en la ONU al instante, nombrado automático por usuario PPPoE + alias editable, y un generador de script para la MikroTik que la conecta sola a la VPN del VPS.

No se borra lo que ya funciona (tenants, roles, API↔MikroTik, GenieACS). Se reemplaza **solo** la capa de ONUs, que hoy está repartida en tres paneles distintos.

## 1. VPN y conexión API ↔ MikroTik (queda cerrado primero)

- Se mantiene L2TP/IPsec como método por defecto: usuario/contraseña fijos, se puede volver a pegar el script en la MikroTik sin romper nada (a diferencia de WireGuard, que regeneraba la llave cada vez).
- Nueva sección **Conexión** dentro del panel: muestra el estado del túnel, y un botón **"Generar script MikroTik"** que descarga/copia el `.rsc` completo ya rellenado (servidor, usuario, contraseña, PSK, firewall, API 8728, NAT hacia las ONUs). Nada de buscar archivos por SSH.
- El API sigue hablando con la MikroTik por la IP del túnel (`192.168.42.10`) usando el dispositivo activo; las ONUs se alcanzan por las rutas que reaplica el cron del VPS.

## 2. Aislamiento por ISP

- Tabla `onu_devices` en Postgres: `id`, `tenant_id`, `mikrotik_id`, `acs_device_id` (serial GenieACS), `pppoe_user`, `alias`, `created_at`, `updated_at`.
- Es el puente entre GenieACS (que no conoce ISPs) y OmniSync. Toda consulta de ONUs pasa por esta tabla filtrada por `tenant_id`, así un ISP nunca ve ONUs de otro.
- Sincronización: al detectar una ONU nueva en GenieACS se registra contra el ISP dueño del MikroTik donde está su sesión PPPoE.

## 3. Roles y permisos por sección

- Nueva tabla `role_permissions`: `tenant_id`, `role`, `section`, `can_view`, `can_edit`.
- `section` es una cadena libre (`onus`, `wifi`, `pppoe`, `firmware`, `vpn`, …), así cada sección nueva que se cree después solo agrega una fila, sin migraciones.
- Middleware `requirePermission('onus', 'edit')` en el API y hook `usePermission()` en el frontend para ocultar botones.
- El admin de cada ISP administra los permisos de sus propios usuarios; el super_admin ve todo.

## 4. Panel de ONUs (reemplaza los tres actuales)

Una sola página `/onus` con:

- **Lista**: buscador, filtro por estado (en línea / offline / señal crítica), columnas: alias, usuario PPPoE, serial, modelo, RX dBm con semáforo, uptime, última señal.
- **Ficha lateral** al hacer clic, con pestañas:
  - *Resumen*: medidores ópticos RX/TX, temperatura, uptime, gráfica histórica.
  - *WiFi*: radios 2.4G y 5G — SSID, contraseña visible, canal, encendido/apagado. Guardar aplica al instante vía tarea GenieACS con confirmación.
  - *PPPoE*: usuario/clave del cliente, cambio en caliente.
  - *Red*: LAN, DHCP, VLAN.
  - *Acciones*: reiniciar, refrescar parámetros, historial de tareas. Sin factory reset.
- **Nombrado**: al detectar el usuario PPPoE, la ONU se renombra automáticamente con ese usuario, y el campo **alias** es editable en línea desde la lista y desde la ficha. Se muestra el alias cuando existe, si no el usuario PPPoE.
- Feedback inmediato: cada cambio muestra "aplicando…" y luego confirma o marca el error real que devolvió la ONU.

## 5. Archivos

- API: `vps-stack/api/src/routes/onu.ts` (reescrito sobre `onu_devices`), `middleware/permissions.ts` (nuevo), `routes/permissions.ts` (nuevo), `routes/vpn-script.ts` (nuevo, generador `.rsc`).
- DB: migración idempotente en `vps-stack/db/init.sql` + `deploy-all.sh` (`CREATE TABLE IF NOT EXISTS`).
- Frontend: `src/pages/OnuManagement.tsx` (reescrito), `src/components/onu/*` (lista, ficha, pestañas), `src/hooks/useOnus.ts`, `src/hooks/usePermission.ts`, `src/pages/Admin/Permissions.tsx`.
- Se retiran `src/components/tr069/SimpleOnuPanel.tsx` y el panel duplicado una vez migrado.

## Orden de entrega

1. VPN + generador de script MikroTik desde el panel.
2. Tabla `onu_devices` + aislamiento por ISP.
3. Permisos por sección.
4. Panel de ONUs nuevo (lista, ficha, WiFi/PPPoE al instante, alias).
