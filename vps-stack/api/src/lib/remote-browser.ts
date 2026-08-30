import http from 'http';

const DOCKER_SOCK = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const BROWSER_CONTAINER = process.env.BROWSER_CONTAINER || 'omnisync-browser';

function dockerRequest(method: string, path: string, body?: any): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : undefined;
    const req = http.request(
      {
        socketPath: DOCKER_SOCK,
        method,
        path,
        timeout: 8000,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
          : {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let data: any = text;
          try {
            data = text ? JSON.parse(text) : null;
          } catch {
            /* respuesta no JSON (exec start) */
          }
          resolve({ status: res.statusCode || 0, data });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout Docker socket')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** ¿Está corriendo el contenedor de Firefox remoto? */
export async function browserStatus(): Promise<{ available: boolean; running: boolean; error?: string }> {
  try {
    const { status, data } = await dockerRequest('GET', `/containers/${BROWSER_CONTAINER}/json`);
    if (status === 404) return { available: true, running: false, error: 'Contenedor no encontrado' };
    if (status >= 400) return { available: true, running: false, error: `Docker respondió ${status}` };
    return { available: true, running: Boolean(data?.State?.Running) };
  } catch (error: any) {
    return { available: false, running: false, error: error.message };
  }
}

const SAFE_URL = /^https?:\/\/[A-Za-z0-9._~:\-\[\]]+(\/[^\s"'`$;|&<>\\]*)?$/;

/** Abre una URL en el Firefox remoto (nueva pestaña sobre la sesión activa). */
export async function openInBrowser(url: string): Promise<{ ok: boolean; error?: string }> {
  if (!SAFE_URL.test(url)) return { ok: false, error: 'URL no permitida' };

  const state = await browserStatus();
  if (!state.running) return { ok: false, error: state.error || 'Firefox remoto no está corriendo' };

  const command = `DISPLAY=:1 /usr/bin/firefox --new-tab ${JSON.stringify(url)} >/dev/null 2>&1 &`;

  const exec = await dockerRequest('POST', `/containers/${BROWSER_CONTAINER}/exec`, {
    AttachStdout: false,
    AttachStderr: false,
    Tty: false,
    User: process.env.BROWSER_EXEC_USER || 'abc',
    Env: ['DISPLAY=:1', 'HOME=/config'],
    Cmd: ['/bin/bash', '-c', command],
  });

  if (exec.status >= 400 || !exec.data?.Id) {
    return { ok: false, error: `No se pudo crear exec (${exec.status})` };
  }

  const start = await dockerRequest('POST', `/exec/${exec.data.Id}/start`, { Detach: true, Tty: false });
  if (start.status >= 400) return { ok: false, error: `No se pudo iniciar Firefox (${start.status})` };

  return { ok: true };
}
