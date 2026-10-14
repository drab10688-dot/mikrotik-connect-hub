# WinBox 4 nativo (Linux) en el mismo escritorio remoto que el navegador.
# Se construye sobre la imagen del escritorio Chromium (Selkies, puerto 3000,
# usuario/clave por CUSTOM_USER/PASSWORD): Nginx la sirve igual en el 8082.
# Un contenedor por usuario, creado y destruido por la API (lib/user-winbox.ts).
ARG BASE_IMAGE=lscr.io/linuxserver/chromium:latest
FROM ${BASE_IMAGE}

ARG WINBOX_VERSION=4.4

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      unzip ca-certificates curl \
      libxkbcommon-x11-0 libxcb-cursor0 libxcb-icccm4 libxcb-image0 libxcb-keysyms1 \
      libxcb-randr0 libxcb-render-util0 libxcb-shape0 libxcb-xinerama0 libxcb-xkb1 \
      libgl1 libegl1 libfontconfig1 libfreetype6 libdbus-1-3 && \
    curl -fsSL "https://download.mikrotik.com/routeros/winbox/${WINBOX_VERSION}/WinBox_Linux.zip" -o /tmp/winbox.zip && \
    mkdir -p /opt/winbox && unzip -q /tmp/winbox.zip -d /opt/winbox && \
    chmod 755 /opt/winbox/WinBox && \
    apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/*

COPY root/ /

RUN chmod 755 /defaults/autostart /defaults/autostart_wayland /usr/local/bin/winbox-loop

LABEL omnisync.winbox.version=${WINBOX_VERSION}
