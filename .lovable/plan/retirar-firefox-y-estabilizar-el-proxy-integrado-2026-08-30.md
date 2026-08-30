# Retirar Firefox y estabilizar el proxy integrado

## Objetivo
Volver a un único método de acceso avanzado: el proxy web integrado. Firefox remoto dejará de instalarse, iniciarse y mostrarse en el panel para que no interfiera con la VPN L2TP.

## Cambios
- Eliminar el servicio `remote-browser`, su volumen, ruta Nginx, endpoints backend y controles del frontend.
- Simplificar **Abrir / Sistema avanzado** para abrir siempre el proxy integrado, conservando modal amplio, pantalla completa, recarga y nueva pestaña.
- Mantener el enrutamiento/NAT necesario para que el contenedor API alcance las redes ONU por L2TP, pero retirar toda referencia a Firefox.
- Corregir el proxy para formularios de login, cookies y captcha: aceptar `urlencoded`, aislar cookies por equipo, preservar sesión, reescribir redirecciones/recursos/formularios y evitar caché del captcha.
- Evitar enviar al equipo remoto el token o cookies del panel y validar estrictamente IP/puerto para impedir destinos no autorizados.
- Ajustar instalación y actualización para eliminar un contenedor Firefox antiguo sin reiniciar ni recrear L2TP.

## Verificación
- Validar TypeScript del panel y sintaxis de scripts/Compose/Nginx.
- Confirmar que no queden referencias activas a Firefox o `/browser/`.
- Verificar el flujo: diagnóstico de puerto → carga de login/captcha → envío del formulario → navegación interna por el mismo proxy.
- La prueba final contra `10.82.3.60` deberá ejecutarse en el VPS, porque esa red privada solo es accesible desde su túnel L2TP.
