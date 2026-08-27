# Restaurar el último acceso estable

## Objetivo
Recuperar el funcionamiento de autenticación, dispositivos y GenieACS sin reinstalar ni borrar bases de datos, VPN, peers o configuraciones.

## Cambios
1. Restaurar el middleware de autenticación a la versión estable anterior a los cambios de “Asistente global”.
2. Mantener la migración compatible que agrega `users.is_active`, para instalaciones antiguas.
3. Restaurar la carga de dispositivos del asistente al flujo estable basado en asignaciones explícitas.
4. Evitar la doble ejecución del middleware en GenieACS, dejando la protección central de la API como única validación.
5. Conservar los nombres “Asistente” y los permisos nuevos del menú; no revertir funciones ajenas al fallo.

## Validación
- Verificar que el API compile.
- Confirmar que `/api/auth/me`, `/api/devices` y `/api/genieacs/overview` usan el mismo token y una sola cadena de autenticación.
- Entregar comandos de actualización sin eliminar volúmenes ni datos.

## Punto identificado
La última base estable está en el commit `7d2ace9` (27 de agosto, 16:48 UTC). Los cambios de acceso global y los intentos posteriores de corregir el 401 comenzaron después de ese punto.
