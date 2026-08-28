# Panel WireGuard independiente

## Objetivo
Separar completamente la VPN del instalador CMS para que WireGuard y el panel MikroTik funcionen aunque CMS falle o todavía no esté instalado.

## Cambios
- Crear un instalador autónomo para WireGuard y el panel web OmniSync.
- Permitir desde el panel crear peers, descargar su configuración y generar/copiar el script completo para RouterOS v7.
- Mantener reglas de acceso remoto, reenvío hacia ONUs y NAT necesarias para conectar posteriormente el CMS.
- Eliminar del flujo autónomo cualquier descarga, arranque o comprobación del CMS.
- Hacer la instalación repetible: conservar peers existentes, reutilizar credenciales guardadas y validar contenedores, panel y puertos.
- Mostrar al finalizar las URL, credenciales y el dato que se usará después para enlazar CMS por la VPN.

## Detalles técnicos
- WireGuard conservará la red `10.13.13.0/24`, UDP `51820` y persistencia bajo `/opt/omnisync-wg`.
- El panel unificado se expondrá en `51822`; el panel técnico de WireGuard seguirá disponible en `51821`.
- Se añadirá una opción de configuración del CMS en el generador para definir IP/puertos cuando el CMS ya esté instalado, sin instalarlo ni administrarlo.
- El instalador abrirá únicamente los puertos públicos de administración y VPN; TR-069/MQTT se limitarán al tráfico de la red VPN.

## Verificación
- Validar sintaxis de scripts y Python.
- Comprobar instalación limpia y actualización sin borrar peers.
- Confirmar que el panel responde, crea peers y genera un script RouterOS válido sin depender de contenedores CMS.
