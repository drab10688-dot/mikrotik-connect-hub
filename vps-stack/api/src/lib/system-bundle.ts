import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';

/**
 * Copia total del sistema en UN archivo .tar, para levantar el servidor
 * completo en otra máquina:
 *   postgres.sql.gz               base del panel: todos los ISP, usuarios, routers, VPN…
 *   genieacs.archive.gz           base de GenieACS (mongodump --archive --gzip)
 *   servidor-config.tar.gz.enc    .env de Omnisync + vpn.env/vpn.conf del L2TP, CIFRADO
 *   LEEME.txt / manifest.json     qué trae y cómo restaurar
 *
 * La configuración lleva las claves del servidor (sesiones, base de datos,
 * PSK de la VPN), por eso va cifrada con la "clave de copia" del super admin.
 * La clave vive solo en el servidor (archivo 600 junto a las copias): nunca
 * en la base ni en Dropbox. El cifrado es compatible con openssl:
 *   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 \
 *     -in servidor-config.tar.gz.enc -out servidor-config.tar.gz
 */

const MONGO = process.env.MONGO_CONTAINER || 'omnisync-mongo';
const GENIEACS_DB = process.env.GENIEACS_DB || 'genieacs';
const HOST_STACK_DIR = process.env.HOST_STACK_DIR || '/opt/omnisync';
const HOST_L2TP_DIR = process.env.HOST_L2TP_DIR || '/opt/omnisync-l2tp';
const HELPER_IMAGE = process.env.BACKUP_HELPER_IMAGE || 'omnisync-api:latest';
const PBKDF2_ITER = 200_000;

export const KEY_FILE = '.clave-copia';
export const OPENSSL_DECRYPT =
  'openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -in servidor-config.tar.gz.enc -out servidor-config.tar.gz';

// ─── Clave de copia ─────────────────────────────────────────
export function keyPath(dir: string): string {
  return path.join(dir, KEY_FILE);
}

export function hasBackupKey(dir: string): boolean {
  try {
    return fs.readFileSync(keyPath(dir), 'utf8').trim().length >= 12;
  } catch {
    return false;
  }
}

export function setBackupKey(dir: string, passphrase: string): void {
  fs.writeFileSync(keyPath(dir), passphrase, { mode: 0o600 });
  fs.chmodSync(keyPath(dir), 0o600);
}

function readBackupKey(dir: string): string | null {
  try {
    const k = fs.readFileSync(keyPath(dir), 'utf8').trim();
    return k.length >= 12 ? k : null;
  } catch {
    return null;
  }
}

/** Cifrado con el formato de `openssl enc -aes-256-cbc -pbkdf2 -md sha256`. */
export function opensslEncrypt(data: Buffer, passphrase: string): Buffer {
  const salt = crypto.randomBytes(8);
  const keyIv = crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITER, 48, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-cbc', keyIv.subarray(0, 32), keyIv.subarray(32, 48));
  return Buffer.concat([Buffer.from('Salted__'), salt, cipher.update(data), cipher.final()]);
}

// ─── Procesos ───────────────────────────────────────────────
/** Ejecuta un programa sin shell y vuelca su salida estándar en `outFile`. */
function runToFile(cmd: string, args: string[], outFile: string, timeoutMs = 10 * 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(outFile);
    const p = spawn(cmd, args);
    let stderr = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-2000); });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.stdout.pipe(out);
    p.on('close', (code) => {
      clearTimeout(timer);
      out.end(() => (code === 0 ? resolve() : reject(new Error(stderr.trim() || `${cmd} terminó con código ${code}`))));
    });
  });
}

/** Ejecuta un programa sin shell con `inFile` como entrada estándar. */
function runFromFile(cmd: string, args: string[], inFile: string, timeoutMs = 20 * 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let stderr = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-2000); });
    p.stdout.resume();
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(stderr.trim() || `${cmd} terminó con código ${code}`));
    });
    fs.createReadStream(inFile).pipe(p.stdin);
  });
}

// ─── Partes ─────────────────────────────────────────────────
export async function dumpGenieacs(outFile: string): Promise<void> {
  await runToFile('docker', ['exec', MONGO, 'mongodump', '--quiet', '--archive', '--gzip', `--db=${GENIEACS_DB}`], outFile);
}

export async function restoreGenieacs(inFile: string): Promise<void> {
  await runFromFile('docker', ['exec', '-i', MONGO, 'mongorestore', '--quiet', '--archive', '--gzip', '--drop', `--nsInclude=${GENIEACS_DB}.*`], inFile);
}

/**
 * Archivos de configuración del host (la API no los tiene montados): se leen
 * con un contenedor efímero de la propia imagen de la API, solo lectura.
 */
async function hostConfigTarGz(outFile: string): Promise<void> {
  await runToFile('docker', [
    'run', '--rm', '--network', 'none',
    '-v', `${HOST_STACK_DIR}/.env:/c/omnisync.env:ro`,
    '-v', `${HOST_L2TP_DIR}:/c/l2tp:ro`,
    '--entrypoint', 'sh', HELPER_IMAGE, '-c',
    'cd /c && tar -czf - omnisync.env $(cd /c && ls l2tp/vpn.env l2tp/vpn.conf 2>/dev/null)',
  ], outFile, 120_000);
}

const LEEME = (parts: string[], warnings: string[]) => `Copia total de Omnisync — ${new Date().toISOString()}

Contenido: ${parts.join(', ')}
${warnings.length ? `Avisos:\n- ${warnings.join('\n- ')}\n` : ''}
Restaurar en el mismo servidor: Copias de seguridad → Restaurar (sube este .tar).
Se restauran la base del panel y la de GenieACS.

Servidor nuevo:
1. Descifra la configuración (pide la clave de copia):
   ${OPENSSL_DECRYPT}
   tar -xzf servidor-config.tar.gz
2. Copia omnisync.env a /opt/omnisync/.env y l2tp/vpn.env + l2tp/vpn.conf a
   /opt/omnisync-l2tp/ ANTES de instalar: así se conservan las claves de la VPN
   (las MikroTik reconectan sin tocarlas) y las sesiones.
3. Instala Omnisync y restaura este .tar desde el panel.
`;

export interface BundleResult { parts: string[]; warnings: string[] }

/**
 * Arma el .tar. `pgDump` escribe el volcado de PostgreSQL (lo aporta
 * backup.ts). GenieACS y la configuración son opcionales: si fallan, la copia
 * sigue con un aviso.
 */
export async function createSystemBundle(
  dir: string,
  outTar: string,
  pgDump: (outFile: string) => Promise<void>,
): Promise<BundleResult> {
  const work = fs.mkdtempSync(path.join(dir, '.tmp-sistema-'));
  const parts: string[] = [];
  const warnings: string[] = [];
  try {
    await pgDump(path.join(work, 'postgres.sql.gz'));
    parts.push('postgres.sql.gz');

    try {
      await dumpGenieacs(path.join(work, 'genieacs.archive.gz'));
      parts.push('genieacs.archive.gz');
    } catch (e: any) {
      fs.rmSync(path.join(work, 'genieacs.archive.gz'), { force: true });
      warnings.push(`Sin GenieACS: ${String(e.message).slice(0, 200)}`);
    }

    const key = readBackupKey(dir);
    if (!key) {
      warnings.push('Sin configuración del servidor: define la "clave de copia" para incluirla cifrada');
    } else {
      const plain = path.join(work, 'config.tar.gz');
      try {
        await hostConfigTarGz(plain);
        fs.writeFileSync(path.join(work, 'servidor-config.tar.gz.enc'), opensslEncrypt(fs.readFileSync(plain), key));
        parts.push('servidor-config.tar.gz.enc');
      } catch (e: any) {
        warnings.push(`Sin configuración del servidor: ${String(e.message).slice(0, 200)}`);
      } finally {
        fs.rmSync(plain, { force: true });
      }
    }

    fs.writeFileSync(path.join(work, 'manifest.json'), JSON.stringify({ format: 'omnisync-system-1', created_at: new Date().toISOString(), parts, warnings }, null, 2));
    fs.writeFileSync(path.join(work, 'LEEME.txt'), LEEME(parts, warnings));
    await runToFile('tar', ['-cf', '-', '-C', work, 'manifest.json', 'LEEME.txt', ...parts], outTar);
    return { parts, warnings };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

const BUNDLE_MEMBERS = ['manifest.json', 'LEEME.txt', 'postgres.sql.gz', 'genieacs.archive.gz', 'servidor-config.tar.gz.enc'];

/**
 * Extrae el .tar y entrega la ruta de cada parte (el llamador restaura).
 * Solo se extraen los nombres conocidos: nada de rutas con "../" ni absolutas.
 */
export async function extractSystemBundle(tarFile: string, dir: string): Promise<{ work: string; manifest: any; file: (name: string) => string | null }> {
  const work = fs.mkdtempSync(path.join(dir, '.tmp-restaurar-'));
  const listFile = path.join(work, '.lista');
  await runToFile('tar', ['-tf', tarFile], listFile, 120_000);
  const members = fs.readFileSync(listFile, 'utf8').split('\n').map((s) => s.trim().replace(/^\.\//, ''))
    .filter((m) => BUNDLE_MEMBERS.includes(m));
  fs.rmSync(listFile, { force: true });
  if (!members.includes('postgres.sql.gz')) {
    fs.rmSync(work, { recursive: true, force: true });
    throw new Error('El archivo no es una copia total de Omnisync (falta postgres.sql.gz)');
  }
  await runFromFile('tar', ['-xf', '-', '-C', work, ...members], tarFile);
  let manifest: any = {};
  try { manifest = JSON.parse(fs.readFileSync(path.join(work, 'manifest.json'), 'utf8')); } catch { /* copia sin manifiesto */ }
  const file = (name: string) => {
    const p = path.join(work, path.basename(name));
    return fs.existsSync(p) ? p : null;
  };
  return { work, manifest, file };
}
