import fs from 'fs';

/**
 * Cliente mínimo de Dropbox para enviar/descargar copias de seguridad.
 * Usa el flujo de "refresh token" (App key + App secret + Refresh token),
 * que no caduca, a diferencia del token corto de la consola de Dropbox.
 */

export interface DropboxConfig {
  app_key: string;
  app_secret: string;
  refresh_token: string;
  folder?: string | null;
}

const CHUNK = 8 * 1024 * 1024; // 8 MB por trozo

function normalizeFolder(folder?: string | null): string {
  const raw = (folder || '/OmniSync').trim();
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return withSlash.replace(/\/+$/, '') || '/OmniSync';
}

export function dropboxPath(cfg: DropboxConfig, filename: string): string {
  return `${normalizeFolder(cfg.folder)}/${filename}`;
}

/** Cambia el refresh token por un access token temporal. */
export async function getAccessToken(cfg: DropboxConfig): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: cfg.refresh_token,
  });
  const auth = Buffer.from(`${cfg.app_key}:${cfg.app_secret}`).toString('base64');
  const res = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error_summary || 'Credenciales de Dropbox inválidas');
  }
  return json.access_token as string;
}

/** Verifica las credenciales y devuelve el nombre de la cuenta. */
export async function testConnection(cfg: DropboxConfig): Promise<{ account: string; folder: string }> {
  const token = await getAccessToken(cfg);
  const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_summary || 'No se pudo consultar la cuenta de Dropbox');
  return {
    account: json?.name?.display_name || json?.email || 'Cuenta Dropbox',
    folder: normalizeFolder(cfg.folder),
  };
}

/** Sube un archivo local a Dropbox (usa sesión por trozos para archivos grandes). */
export async function uploadFile(cfg: DropboxConfig, filePath: string, filename: string): Promise<string> {
  const token = await getAccessToken(cfg);
  const target = dropboxPath(cfg, filename);
  const size = fs.statSync(filePath).size;

  if (size <= CHUNK) {
    const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({ path: target, mode: 'overwrite', mute: true }),
      },
      body: fs.readFileSync(filePath),
    });
    if (!res.ok) throw new Error((await res.text()).slice(0, 300));
    return target;
  }

  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(CHUNK);
    let offset = 0;
    let sessionId = '';

    while (offset < size) {
      const read = fs.readSync(fd, buf, 0, CHUNK, offset);
      const chunk = buf.subarray(0, read);
      const isFirst = offset === 0;
      const isLast = offset + read >= size;

      const url = isFirst
        ? 'https://content.dropboxapi.com/2/files/upload_session/start'
        : isLast
          ? 'https://content.dropboxapi.com/2/files/upload_session/finish'
          : 'https://content.dropboxapi.com/2/files/upload_session/append_v2';

      const arg = isFirst
        ? { close: false }
        : isLast
          ? {
              cursor: { session_id: sessionId, offset },
              commit: { path: target, mode: 'overwrite', mute: true },
            }
          : { cursor: { session_id: sessionId, offset }, close: false };

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': JSON.stringify(arg),
        },
        body: chunk,
      });
      if (!res.ok) throw new Error((await res.text()).slice(0, 300));
      if (isFirst) sessionId = ((await res.json()) as any).session_id;
      offset += read;
    }
    return target;
  } finally {
    fs.closeSync(fd);
  }
}

/** Lista las copias guardadas en la carpeta de Dropbox. */
export async function listFiles(cfg: DropboxConfig): Promise<Array<{ name: string; size: number; modified: string }>> {
  const token = await getAccessToken(cfg);
  const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: normalizeFolder(cfg.folder), limit: 200 }),
  });
  if (res.status === 409) return []; // carpeta aún no existe
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_summary || 'No se pudo listar Dropbox');
  return (json.entries || [])
    .filter((e: any) => e['.tag'] === 'file')
    .map((e: any) => ({ name: e.name, size: e.size, modified: e.server_modified }))
    .sort((a: any, b: any) => (a.modified < b.modified ? 1 : -1));
}

/** Descarga una copia de Dropbox al disco local. */
export async function downloadFile(cfg: DropboxConfig, filename: string, destPath: string): Promise<void> {
  const token = await getAccessToken(cfg);
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath(cfg, filename) }),
    },
  });
  if (!res.ok) throw new Error((await res.text()).slice(0, 300) || 'No se pudo descargar de Dropbox');
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
}

/** Borra copias antiguas dejando sólo las N más recientes. */
export async function pruneRemote(cfg: DropboxConfig, keep: number): Promise<void> {
  if (!keep || keep <= 0) return;
  const files = await listFiles(cfg);
  const extra = files.slice(keep);
  if (!extra.length) return;
  const token = await getAccessToken(cfg);
  await fetch('https://api.dropboxapi.com/2/files/delete_batch', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries: extra.map((f) => ({ path: dropboxPath(cfg, f.name) })) }),
  }).catch(() => undefined);
}
