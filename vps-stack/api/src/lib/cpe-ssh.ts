import crypto from 'crypto';
import { Client } from 'ssh2';

/**
 * SSH a las antenas de los clientes (CPE en modo router: MikroTik RouterOS
 * v6/v7 y Ubiquiti airOS 6/8) para identificarlas, respaldar su configuración
 * y cambiar el usuario PPPoE o la clave de acceso.
 *
 * Todo texto que viaja dentro de un comando se valida antes con SAFE_* : sin
 * comillas, $, \, ; ni espacios, así nunca se interpreta en la antena.
 */

export type CpeBrand = 'mikrotik' | 'ubiquiti';
export interface CpeLogin { username: string; password: string; port: number; /** Puerto API RouterOS (MikroTik) */ apiPort?: number }

export const SAFE_PPPOE_USER = /^[A-Za-z0-9._@-]{1,64}$/;
export const SAFE_PASSWORD = /^[A-Za-z0-9!@#%^*()_+=.,:~-]{8,64}$/;
export const SAFE_USERNAME = /^[A-Za-z0-9._-]{1,32}$/;

const ALGORITHMS: any = {
  kex: ['curve25519-sha256', 'curve25519-sha256@libssh.org', 'ecdh-sha2-nistp256', 'diffie-hellman-group14-sha256', 'diffie-hellman-group14-sha1', 'diffie-hellman-group-exchange-sha1', 'diffie-hellman-group1-sha1'],
  serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa', 'ssh-dss'],
  cipher: ['aes128-gcm@openssh.com', 'aes256-gcm@openssh.com', 'aes128-ctr', 'aes192-ctr', 'aes256-ctr', 'aes128-cbc', 'aes256-cbc', '3des-cbc'],
};

export class SshAuthError extends Error {}

/** Ejecuta un comando por SSH. Rechaza con SshAuthError si la clave no sirve. */
export function sshRun(ip: string, login: CpeLogin, command: string, timeoutMs = 20_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let settled = false;
    const finish = (error?: Error, output = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      conn.end();
      error ? reject(error) : resolve(output);
    };
    const timer = setTimeout(() => finish(new Error('La antena no respondió a tiempo')), timeoutMs);
    conn
      .on('ready', () => {
        conn.exec(command, (error, stream) => {
          if (error) return finish(error);
          let out = '';
          let err = '';
          stream.on('data', (c: Buffer) => { out += c.toString(); });
          stream.stderr.on('data', (c: Buffer) => { err += c.toString(); });
          stream.on('close', (code: number) => {
            if (code && !out.trim()) return finish(new Error(err.trim() || `El comando terminó con código ${code}`));
            finish(undefined, out);
          });
        });
      })
      .on('error', (error: any) => {
        const auth = error?.level === 'client-authentication' || /authentication methods failed/i.test(error?.message || '');
        finish(auth ? new SshAuthError('Usuario o clave incorrectos') : error);
      })
      .connect({
        host: ip,
        port: login.port || 22,
        username: login.username,
        password: login.password,
        readyTimeout: 10_000,
        keepaliveInterval: 3_000,
        keepaliveCountMax: 3,
        algorithms: ALGORITHMS,
      });
  });
}

/**
 * Prueba los logins en orden hasta que uno entra. Si la antena no responde
 * (no es error de clave) se corta enseguida: probar más claves no ayuda.
 */
export async function findLogin(ip: string, candidates: CpeLogin[], probe: string): Promise<{ login: CpeLogin; output: string }> {
  let lastAuth: Error | null = null;
  for (const login of candidates) {
    try {
      return { login, output: await sshRun(ip, login, probe) };
    } catch (e: any) {
      if (e instanceof SshAuthError) { lastAuth = e; continue; }
      throw e;
    }
  }
  throw lastAuth || new Error('No hay credenciales configuradas para esta antena');
}

export const passwordHash = (password: string) => crypto.createHash('sha256').update(password).digest('hex');

// ─── Comandos por marca ─────────────────────────────────────────

/** Sonda: identifica marca, modelo y versión. Sirve también para probar el login. */
export const IDENTIFY: Record<CpeBrand, string> = {
  mikrotik: ':put ("ROS|" . [/system resource get board-name] . "|" . [/system resource get version] . "|" . [/system identity get name])',
  ubiquiti: 'echo "AIROS|$(grep -E "^board\\.(name|model)=" /etc/board.info | head -1 | cut -d= -f2)|$(cat /etc/version)|$(grep "^resolv.host.1.name=" /tmp/system.cfg | cut -d= -f2)"',
};

export function parseIdentify(output: string): { brand: CpeBrand; model: string | null; version: string | null; name: string | null } | null {
  const line = output.split(/\r?\n/).find((l) => /^(ROS|AIROS)\|/.test(l.trim()));
  if (!line) return null;
  const [tag, model, version, name] = line.trim().split('|');
  return {
    brand: tag === 'ROS' ? 'mikrotik' : 'ubiquiti',
    model: model || null,
    version: version || null,
    name: name || null,
  };
}

/** Configuración completa para respaldo antes de cualquier cambio. */
export const BACKUP: Record<CpeBrand, string> = {
  mikrotik: '/export compact',
  ubiquiti: 'cat /tmp/system.cfg',
};

/** Cambia el usuario del cliente PPPoE de la antena (la clave PPPoE no se toca). */
export function setPppoeUserCmd(brand: CpeBrand, user: string): string {
  if (!SAFE_PPPOE_USER.test(user)) throw new Error('Usuario PPPoE con caracteres no permitidos');
  if (brand === 'mikrotik') {
    return `:if ([:len [/interface pppoe-client find]] = 0) do={ :put "SIN-PPPOE" } else={ /interface pppoe-client set [find] user="${user}"; :put "OK" }`;
  }
  // airOS: ppp.1.name es el usuario. Se guarda en flash y se aplica en
  // segundo plano (la conexión se corta unos segundos).
  return `if grep -q '^ppp\\.1\\.name=' /tmp/system.cfg; then ` +
    `if sed -i 's|^ppp\\.1\\.name=.*|ppp.1.name=${user}|' /tmp/system.cfg && cfgmtd -w -p /etc/ >/dev/null 2>&1; ` +
    `then echo OK; ${APPLY_AIROS} else echo FALLO; fi; else echo SIN-PPPOE; fi`;
}

/**
 * airOS: aplica la configuración guardada unos segundos después, ya con la
 * sesión SSH liberada (salidas a /dev/null), para recibir el "OK" antes del corte.
 */
const APPLY_AIROS = '( sleep 2; /usr/etc/rc.d/rc.softrestart save ) >/dev/null 2>&1 </dev/null &';

/** Cambia la clave del usuario de acceso. airOS necesita la clave cifrada (MD5-crypt). */
export function setPasswordCmd(brand: CpeBrand, username: string, password: string, currentCfg?: string): string {
  if (!SAFE_PASSWORD.test(password)) throw new Error('La clave nueva tiene caracteres no permitidos');
  if (!SAFE_USERNAME.test(username)) throw new Error('Usuario de acceso no válido');
  if (brand === 'mikrotik') {
    return `:if ([:len [/user find name="${username}"]] = 0) do={ :put "SIN-USUARIO" } else={ /user set [find name="${username}"] password="${password}"; :put "OK" }`;
  }
  // airOS guarda users.1.password como hash. Solo se cambia si el actual es
  // MD5-crypt ($1$), el formato que se sabe generar; si no, se aborta.
  const current = (currentCfg || '').match(/^users\.1\.password=(.*)$/m)?.[1] || '';
  const userLine = (currentCfg || '').match(/^users\.1\.name=(.*)$/m)?.[1]?.trim();
  if (userLine && userLine !== username) throw new Error(`El usuario de la antena es "${userLine}", no "${username}"`);
  if (!current.startsWith('$1$')) throw new Error('Formato de clave de airOS no soportado (no es MD5-crypt): cámbiala a mano');
  const hash = md5crypt(password, crypto.randomBytes(6).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'omnisync');
  return `if sed -i 's|^users\\.1\\.password=.*|users.1.password=${hash}|' /tmp/system.cfg && cfgmtd -w -p /etc/ >/dev/null 2>&1; ` +
    `then echo OK; ${APPLY_AIROS} else echo FALLO; fi`;
}

// ─── MD5-crypt ($1$), el formato de /etc/passwd que usa airOS ────

const ITOA64 = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function to64(v: number, n: number): string {
  let s = '';
  while (n-- > 0) { s += ITOA64[v & 0x3f]; v >>>= 6; }
  return s;
}

export function md5crypt(password: string, salt: string): string {
  const pw = Buffer.from(password, 'utf8');
  const sl = Buffer.from(salt.slice(0, 8), 'utf8');
  const magic = Buffer.from('$1$');
  const md5 = () => crypto.createHash('md5');

  const ctx = md5().update(pw).update(magic).update(sl);
  let fin = md5().update(pw).update(sl).update(pw).digest();
  for (let pl = pw.length; pl > 0; pl -= 16) ctx.update(fin.subarray(0, Math.min(pl, 16)));
  for (let i = pw.length; i; i >>= 1) ctx.update(i & 1 ? Buffer.from([0]) : pw.subarray(0, 1));
  fin = ctx.digest();

  for (let i = 0; i < 1000; i++) {
    const c = md5();
    c.update(i & 1 ? pw : fin);
    if (i % 3) c.update(sl);
    if (i % 7) c.update(pw);
    c.update(i & 1 ? fin : pw);
    fin = c.digest();
  }

  const f = fin;
  const out =
    to64((f[0] << 16) | (f[6] << 8) | f[12], 4) +
    to64((f[1] << 16) | (f[7] << 8) | f[13], 4) +
    to64((f[2] << 16) | (f[8] << 8) | f[14], 4) +
    to64((f[3] << 16) | (f[9] << 8) | f[15], 4) +
    to64((f[4] << 16) | (f[10] << 8) | f[5], 4) +
    to64(f[11], 2);
  return `$1$${salt.slice(0, 8)}$${out}`;
}
