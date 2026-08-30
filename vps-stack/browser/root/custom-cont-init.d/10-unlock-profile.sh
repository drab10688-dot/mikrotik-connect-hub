#!/usr/bin/with-contenv bash
# Elimina bloqueos de perfil de Chromium que quedan tras reinicios del
# contenedor ("profile appears to be in use by another Chromium process").
rm -f /config/.config/chromium/SingletonLock \
      /config/.config/chromium/SingletonSocket \
      /config/.config/chromium/SingletonCookie \
      /config/chromium/SingletonLock \
      /config/chromium/SingletonSocket \
      /config/chromium/SingletonCookie 2>/dev/null || true
