# Multi-ISP (multi-tenant) con marca propia

Objetivo: vender acceso a la gestión de MikroTik y ONUs a varios ISP en el mismo servidor, con aislamiento total entre ellos y con logo/nombre propio en la pantalla de inicio, **sin romper lo que hoy funciona** (ONUs, dispositivos, VPN).

## Principio de seguridad del cambio (para no repetir el daño anterior)

El aislamiento se agrega **encima** del modelo actual, nunca reemplazándolo:

- Se crea una tabla `tenants` (ISP) y una columna `tenant_id` **opcional** en `users` y `mikrotik_devices`.
- Todos los datos existentes se migran a un ISP inicial ("OmniSync") en la misma migración, así nada queda huérfano.
- El filtro por ISP solo se aplica cuando el usuario tiene `tenant_id`. Si es `NULL` (instalación vieja, super_admin global), el comportamiento es **exactamente el de hoy**.
- No se toca la lógica de ONUs: las ONUs ya están ligadas a `mikrotik_id`, así que al aislar los MikroTik quedan aisladas automáticamente. No se agregan filtros nuevos dentro de `onu.ts`.
- Migración idempotente en `deploy-all.sh` (`ADD COLUMN IF NOT EXISTS`), sin borrar ni recrear tablas.

## Qué se construye

### 1. Tabla de ISP (tenants)

`tenants`: `id`, `slug` (único, para el link), `name`, `logo_url`, `primary_color`, `is_active`, `created_at`.
Se inserta el ISP por defecto y se hace backfill: todos los usuarios y dispositivos actuales quedan en él.

### 2. Aislamiento en el API

- `authMiddleware` carga `req.tenantId` desde el usuario.
- Listado de dispositivos: se agrega `AND (md.tenant_id = $tenant OR md.tenant_id IS NULL)` cuando el usuario tiene tenant. El super_admin global (sin tenant) sigue viendo todo.
- Al crear un MikroTik se hereda el `tenant_id` del creador.
- Los módulos que reciben `mikrotik_id` (ONU, clientes, facturación, vouchers, hotspot) quedan protegidos por la misma comprobación de acceso al dispositivo que ya existe; se refuerza el helper de verificación de acceso para que también valide tenant.
- Un nuevo rol de "dueño de ISP" no es necesario: el `admin` de cada ISP administra su propio tenant; el `super_admin` global crea los ISP.

### 3. Marca propia y link por ISP

- Ruta pública `/isp/:slug` que muestra la pantalla de inicio con el logo y nombre del ISP (endpoint público `GET /tenants/public/:slug`, solo devuelve nombre, logo y color).
- Al iniciar sesión desde ese link, se recuerda el ISP y el sidebar/dashboard muestran ese logo y nombre en lugar de OmniSync.
- Si se entra por `/login` normal, se mantiene la marca OmniSync actual.
- Subida de logo: endpoint `POST /tenants/:id/logo` (multer, igual patrón que backup) guardando en `/opt/omnisync/uploads/logos`, servido estático por el API.

### 4. Panel de administración de ISP (solo super_admin)

Nueva página `Admin > ISPs`: crear ISP (nombre, slug, logo), activar/desactivar, ver cuántos usuarios y MikroTik tiene, y asignar el usuario administrador de ese ISP. El registro de usuarios desde un admin de ISP crea el usuario dentro de su propio tenant.

## Archivos que se tocan

- `vps-stack/db/init.sql` — tabla `tenants` + columnas `tenant_id` (instalaciones nuevas).
- `vps-stack/deploy-all.sh` — migración idempotente + backfill (instalaciones existentes).
- `vps-stack/api/src/middleware/auth.ts` — carga de `req.tenantId`.
- `vps-stack/api/src/routes/devices.ts` — filtro por tenant en listado/creación/acceso.
- `vps-stack/api/src/routes/auth.ts`, `users.ts` — tenant en login/registro.
- `vps-stack/api/src/routes/tenants.ts` (nuevo) + montaje en `server.ts`.
- Frontend: `src/pages/Auth/Login.tsx` (marca por slug), `src/components/dashboard/Sidebar.tsx` (logo/nombre del ISP), `src/pages/Admin/Tenants.tsx` (nuevo), `src/App.tsx` (rutas), `src/hooks/useTenant.ts` (nuevo).

## Verificación antes de dar por terminado

1. Con la base actual: los MikroTik y las **ONUs se siguen viendo igual** (mismo conteo que hoy).
2. Crear un ISP nuevo con su admin: ese admin no ve ningún MikroTik ni ONU del ISP original, y viceversa.
3. `/isp/<slug>` muestra logo y nombre del ISP; `/login` sigue mostrando OmniSync.
4. La migración corre dos veces seguidas sin error.
