# Escritorio Linux mínimo (XFCE + KasmVNC) con Winbox nativo corriendo bajo Wine.
# Sin licencias de Windows, ~600 MB, accesible desde el panel en /winbox/
FROM lscr.io/linuxserver/webtop:ubuntu-xfce

ENV WINEDEBUG=-all \
    WINEPREFIX=/config/.wine \
    WINEARCH=win64

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      wine64 wine winbind ca-certificates curl xterm && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

COPY root/ /

RUN chmod +x /custom-cont-init.d/* /usr/local/bin/winbox 2>/dev/null || true
