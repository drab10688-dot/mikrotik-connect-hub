# Navegador real integrado para equipos de red

## Objetivo
Sustituir el visor proxy como acceso principal por Firefox remoto integrado, capaz de manejar captchas, JavaScript antiguo y sesiones propias de ONUs como V-SOL.

## Cambios
- Abrir clientes PPPoE, ONUs, antenas y WebFig en un visor de Firefox real dentro del panel.
- Mostrar la URL/IP del equipo en una barra superior, copiarla al abrir y mantener el proxy actual únicamente como respaldo.
- Permitir ampliar el navegador integrado a pantalla completa.
- Ajustar Nginx para que Firefox pueda mostrarse dentro del panel sin bloqueos de iframe.
- Corregir las rutas/NAT del VPS para que el contenedor de Firefox llegue a las redes ONU por el túnel.
- Actualizar instalación y actualización para descargar, iniciar y comprobar siempre `remote-browser`, conservando una clave configurable y segura.

## Verificación
- Validar compilación del frontend.
- Revisar la configuración de Docker/Nginx y los scripts de instalación/actualización.
- Entregar un único comando de actualización y comandos de diagnóstico del navegador.
