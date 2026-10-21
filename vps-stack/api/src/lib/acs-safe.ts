import { pool } from './db';

/**
 * Lectura y escritura TR-069 a prueba de firmwares rotos.
 *
 * Un solo parámetro que la ONU no sabe leer (p. ej. PossibleChannels en las
 * VSOL V2804DAC V3.2.01, fault 9002) corta un refreshObject entero: no llegan
 * SSID, clave ni PPPoE y la tarea se reintenta sin fin en cada Inform.
 *
 * Aquí se aprende por modelo + firmware qué parámetros fallan
 * (tabla acs_param_blocks) y el vigilante de fallos convierte cada tarea
 * trabada en una lectura de valores sin esos parámetros. Si GenieACS no dice
 * cuál falló, la lista se parte en mitades hasta aislarlo. En escrituras se
 * prueba la siguiente variante del parámetro (cada marca acepta una ruta
 * distinta para la clave WiFi) y se recuerda la que falló.
 */

const GENIEACS_NBI = process.env.GENIEACS_NBI_URL || 'http://genieacs:7557';

function nbiAuthHeader(): Record<string, string> {
  const user = process.env.GENIEACS_NBI_USER;
  const pass = process.env.GENIEACS_NBI_PASSWORD;
  if (!user || !pass) return {};
  return { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` };
}

async function nbi(path: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(`${GENIEACS_NBI}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...nbiAuthHeader(), ...(options.headers || {}) },
  });
  if (!res.ok) throw new Error(`NBI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const type = res.headers.get('content-type') || '';
  return type.includes('application/json') ? res.json() : res.text();
}

// ─── Modelo y firmware ───────────────────────────────────
export type ParamKind = 'read' | 'write';

export interface ModelKey {
  oui: string;
  productClass: string;
  firmware: string;
}

/** Proyección mínima para saber modelo y firmware de una ONU. */
export const MODEL_PROJECTION = [
  '_deviceId',
  'InternetGatewayDevice.DeviceInfo.SoftwareVersion',
  'Device.DeviceInfo.SoftwareVersion',
];

export function modelKey(device: any): ModelKey {
  const id = device?._deviceId || {};
  const fw = device?.InternetGatewayDevice?.DeviceInfo?.SoftwareVersion?._value
    ?? device?.Device?.DeviceInfo?.SoftwareVersion?._value
    ?? '';
  return { oui: String(id._OUI || ''), productClass: String(id._ProductClass || ''), firmware: String(fw) };
}

// Índices de instancia → '*': la regla vale para todas las radios/conexiones.
export function paramPattern(path: string): string {
  return path.split('.').map((p) => (/^\d+$/.test(p) ? '*' : p)).join('.');
}

// Un objeto bloqueado cubre también todo lo que cuelga de él.
function patternRegex(pattern: string): RegExp {
  const body = pattern
    .split('.')
    .map((p) => (p === '*' ? '\\d+' : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('\\.');
  return new RegExp(`^${body}(\\..*)?$`);
}

// ─── Lista negra aprendida ───────────────────────────────
interface BlockRow {
  oui: string;
  product_class: string;
  firmware: string;
  param: string;
  kind: ParamKind;
}

let blockCache: { rows: BlockRow[]; at: number } | null = null;
const BLOCK_CACHE_MS = 30_000;

async function loadBlocks(): Promise<BlockRow[]> {
  if (blockCache && Date.now() - blockCache.at < BLOCK_CACHE_MS) return blockCache.rows;
  try {
    const { rows } = await pool.query(
      `SELECT oui, product_class, firmware, param, kind FROM acs_param_blocks`
    );
    blockCache = { rows, at: Date.now() };
  } catch {
    blockCache = { rows: [], at: Date.now() };
  }
  return blockCache.rows;
}

export async function blockMatcher(device: any, kind: ParamKind): Promise<(path: string) => boolean> {
  const k = modelKey(device);
  const regexes = (await loadBlocks())
    .filter((r) => r.kind === kind && r.oui === k.oui && r.product_class === k.productClass && r.firmware === k.firmware)
    .map((r) => patternRegex(r.param));
  return (path: string) => regexes.some((re) => re.test(path));
}

export async function recordBlock(
  device: any,
  deviceId: string,
  path: string,
  kind: ParamKind,
  code: string | null,
  message: string | null,
): Promise<void> {
  const k = modelKey(device);
  // Sin BD la tarea nueva igual se encola sin el parámetro; solo no se recuerda.
  try {
    await pool.query(
      `INSERT INTO acs_param_blocks
         (oui, product_class, firmware, param, kind, fault_code, fault_message, example_device)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (oui, product_class, firmware, param, kind) DO UPDATE
         SET hits = acs_param_blocks.hits + 1, last_seen = now(),
             fault_code = EXCLUDED.fault_code, fault_message = EXCLUDED.fault_message,
             example_device = EXCLUDED.example_device`,
      [k.oui, k.productClass, k.firmware, paramPattern(path), kind, code, (message || '').slice(0, 300), deviceId],
    );
  } catch (e: any) {
    console.warn(`[ACS-SEGURO] no se pudo guardar la regla ${path}: ${e.message}`);
  }
  blockCache = null;
}

export async function listBlocks(): Promise<any[]> {
  const { rows } = await pool.query(
    `SELECT id, oui, product_class, firmware, param, kind, fault_code, fault_message,
            example_device, hits, first_seen, last_seen
       FROM acs_param_blocks ORDER BY last_seen DESC`
  );
  return rows;
}

export async function deleteBlock(id: number): Promise<void> {
  await pool.query(`DELETE FROM acs_param_blocks WHERE id = $1`, [id]);
  blockCache = null;
}

// ─── Árbol del dispositivo ───────────────────────────────
export function nodeAtPath(device: any, path: string): any {
  return path.split('.').reduce((acc: any, key: string) => (acc == null ? acc : acc[key]), device);
}

// Hoja = parámetro con valor o descubierto por GetParameterNames (_object false).
function isLeaf(node: any): boolean {
  return node && typeof node === 'object' && ('_value' in node || node._object === false);
}

export function hasParam(device: any, path: string): boolean {
  return isLeaf(nodeAtPath(device, path));
}

/** Rutas de todas las hojas conocidas bajo un objeto. */
export function knownLeaves(device: any, objectName: string): string[] {
  const out: string[] = [];
  const walk = (node: any, path: string) => {
    if (!node || typeof node !== 'object') return;
    if (isLeaf(node)) { out.push(path); return; }
    for (const key of Object.keys(node)) {
      if (key.startsWith('_')) continue;
      walk(node[key], `${path}.${key}`);
    }
  };
  walk(nodeAtPath(device, objectName), objectName);
  return out;
}

const GPV_CHUNK = 100;

export function gpvTasks(names: string[]): any[] {
  const tasks: any[] = [];
  for (let i = 0; i < names.length; i += GPV_CHUNK) {
    tasks.push({ name: 'getParameterValues', parameterNames: names.slice(i, i + GPV_CHUNK) });
  }
  return tasks;
}

/**
 * Tareas para leer un objeto. Sin problemas conocidos en ese modelo se usa
 * refreshObject (descubre también instancias nuevas, p. ej. una conexión
 * PPPoE recién creada). Si el modelo tiene parámetros bloqueados bajo el
 * objeto, se leen solo los valores conocidos que sí responde.
 */
export async function safeReadTasks(device: any, objectName: string): Promise<any[]> {
  const blocked = await blockMatcher(device, 'read');
  const all = device ? knownLeaves(device, objectName) : [];
  if (!all.length || !all.some(blocked)) return [{ name: 'refreshObject', objectName }];
  return gpvTasks(all.filter((p) => !blocked(p)));
}

// ─── Variantes de escritura ──────────────────────────────
// Cada marca acepta una ruta distinta para la clave WiFi (VSOL/Realtek
// rechazan PreSharedKey.1.PreSharedKey, Huawei rechaza KeyPassphrase).
const WRITE_VARIANTS: string[][] = [
  ['PreSharedKey.1.KeyPassphrase', 'KeyPassphrase', 'PreSharedKey.1.PreSharedKey', 'X_HW_WPAKey', 'WPAKey'],
];

function alternativeWriteParam(device: any, param: string, blocked: (p: string) => boolean): string | null {
  for (const group of WRITE_VARIANTS) {
    const suffix = group.find((s) => param.endsWith(`.${s}`));
    if (!suffix) continue;
    const base = param.slice(0, -suffix.length - 1);
    for (const s of group) {
      const cand = `${base}.${s}`;
      if (cand !== param && hasParam(device, cand) && !blocked(cand)) return cand;
    }
  }
  return null;
}

// ─── Vigilante de fallos ─────────────────────────────────
const READ_TASKS = new Set(['getParameterValues', 'refreshObject']);
const attempts = new Map<string, { n: number; at: number }>();
const MAX_ATTEMPTS = 20;
const ATTEMPT_WINDOW_MS = 60 * 60_000;

function faultParam(fault: any): string | null {
  const spv = fault?.detail?.setParameterValuesFault;
  if (Array.isArray(spv) && spv[0]?.parameterName) return String(spv[0].parameterName);
  const text = [fault?.detail?.faultString, fault?.message].filter(Boolean).join(' ');
  const m = text.match(/\b(?:InternetGatewayDevice|Device)\.[A-Za-z0-9_\-.]*[A-Za-z0-9_\-]/);
  return m ? m[0] : null;
}

function allowAttempt(key: string): boolean {
  const now = Date.now();
  const cur = attempts.get(key);
  if (!cur || now - cur.at > ATTEMPT_WINDOW_MS) {
    attempts.set(key, { n: 1, at: now });
    return true;
  }
  if (cur.n >= MAX_ATTEMPTS) return false;
  cur.n += 1;
  return true;
}

async function fetchDeviceFor(deviceId: string, paths: string[]): Promise<any> {
  const q = encodeURIComponent(JSON.stringify({ _id: deviceId }));
  const proj = encodeURIComponent([...MODEL_PROJECTION, ...paths].join(','));
  const list = await nbi(`/devices/?query=${q}&projection=${proj}`);
  return Array.isArray(list) ? list[0] : null;
}

async function queueTasks(deviceId: string, tasks: any[]): Promise<void> {
  const id = encodeURIComponent(deviceId);
  for (let i = 0; i < tasks.length; i++) {
    const trigger = i === tasks.length - 1 ? '?connection_request' : '';
    await nbi(`/devices/${id}/tasks${trigger}`, { method: 'POST', body: JSON.stringify(tasks[i]) });
  }
}

// Si la ONU está en sesión, GenieACS responde 503: se reintenta en la próxima vuelta.
async function dropTask(taskId: string, faultId: string): Promise<boolean> {
  try {
    await nbi(`/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
  } catch {
    return false;
  }
  await nbi(`/faults/${encodeURIComponent(faultId)}`, { method: 'DELETE' }).catch(() => {});
  return true;
}

async function handleReadFault(fault: any, task: any, deviceId: string): Promise<boolean> {
  const objectName = task.name === 'refreshObject' ? String(task.objectName || '') : '';
  const device = await fetchDeviceFor(deviceId, objectName ? [objectName] : []);
  if (!device) return false;

  let names: string[] = task.name === 'getParameterValues'
    ? (Array.isArray(task.parameterNames) ? task.parameterNames.map(String) : [])
    : knownLeaves(device, objectName);
  const param = faultParam(fault);
  const code = String(fault.code || '');
  const blocks: string[] = [];
  let next: any[] = [];

  if (param) {
    blocks.push(param);
    // El mismo dato falla en todas las radios/conexiones: se quitan todas.
    const same = patternRegex(paramPattern(param));
    const blocked = await blockMatcher(device, 'read');
    next = gpvTasks(names.filter((n) => !same.test(n) && !blocked(n)));
  } else if (names.length > 1) {
    // GenieACS no dijo cuál: se parte la lista hasta aislar el parámetro.
    const half = Math.ceil(names.length / 2);
    next = [
      { name: 'getParameterValues', parameterNames: names.slice(0, half) },
      { name: 'getParameterValues', parameterNames: names.slice(half) },
    ];
  } else if (names.length === 1) {
    blocks.push(names[0]);
  } else {
    return false; // refreshObject sin nombres conocidos: no hay con qué reintentar
  }

  if (!(await dropTask(String(task._id), String(fault._id)))) return false;
  for (const b of blocks) await recordBlock(device, deviceId, b, 'read', code, fault.message);
  if (next.length) await queueTasks(deviceId, next);
  console.log(
    `[ACS-SEGURO] ${deviceId}: lectura ${task.name} ${objectName || ''} falló (${code}` +
    `${blocks.length ? ` en ${blocks.join(', ')}` : ', sin parámetro'}); ${next.length} tarea(s) nuevas`
  );
  return true;
}

async function handleWriteFault(fault: any, task: any, deviceId: string): Promise<boolean> {
  const pvs: any[] = Array.isArray(task.parameterValues) ? task.parameterValues : [];
  if (!pvs.length) return false;
  const code = String(fault.code || '');
  let param = faultParam(fault);
  if (!param && pvs.length === 1) param = String(pvs[0][0]);

  if (!param) {
    // Sin parámetro identificado: cada valor va en su propia tarea para aislarlo.
    if (pvs.length < 2 || !(await dropTask(String(task._id), String(fault._id)))) return false;
    await queueTasks(deviceId, pvs.map((pv) => ({ name: 'setParameterValues', parameterValues: [pv] })));
    console.log(`[ACS-SEGURO] ${deviceId}: escritura con ${pvs.length} valores separada (${code})`);
    return true;
  }

  const idx = pvs.findIndex((pv) => String(pv[0]) === param);
  if (idx < 0) return false;
  const base = param.split('.').slice(0, -1).join('.');
  const device = await fetchDeviceFor(deviceId, base ? [base] : []);
  if (!device) return false;

  const rest = pvs.filter((_, i) => i !== idx);
  const [, value, type] = pvs[idx];
  let replacement: any[];
  let learned = false;

  if (code === 'cwmp.9006' && type && type !== 'xsd:string') {
    // Tipo rechazado: algunas ONUs solo aceptan el valor como texto.
    replacement = [param, String(value), 'xsd:string'];
  } else {
    // Solo se cambia de ruta si hay variante conocida (clave WiFi). Un valor
    // rechazado sin variante (SSID inválido, etc.) queda visible en el panel.
    const blocked = await blockMatcher(device, 'write');
    const alt = alternativeWriteParam(device, param, (p) => p === param || blocked(p));
    if (!alt) return false;
    replacement = [alt, value, type || 'xsd:string'];
    learned = true;
  }

  if (!(await dropTask(String(task._id), String(fault._id)))) return false;
  if (learned) await recordBlock(device, deviceId, param, 'write', code, fault.message);
  await queueTasks(deviceId, [{ name: 'setParameterValues', parameterValues: [...rest, replacement] }]);
  console.log(`[ACS-SEGURO] ${deviceId}: escritura de ${param} falló (${code}); reintento con ${replacement[0]}`);
  return true;
}

/**
 * Revisa los fallos de tareas en GenieACS y los resuelve solo. Corre cada
 * minuto desde server.ts. Los fallos que no son de parámetros (sin conexión,
 * timeouts, provisiones) se dejan como están.
 */
export async function runAcsFaultWatcher(): Promise<{ handled: number }> {
  const faults: any[] = (await nbi('/faults/')) || [];
  const taskFaults = faults.filter((f) => /:task_/.test(String(f?._id)) && /^cwmp\.9\d{3}$/.test(String(f?.code)));
  if (!taskFaults.length) return { handled: 0 };

  const tasks: any[] = (await nbi('/tasks/')) || [];
  const byId = new Map(tasks.map((t) => [String(t._id), t]));
  let handled = 0;

  for (const fault of taskFaults) {
    const taskId = String(fault._id).split(':task_')[1];
    const task = byId.get(taskId);
    const deviceId = String(fault.device || String(fault._id).split(':task_')[0]);
    if (!task) continue;
    const isRead = READ_TASKS.has(task.name);
    if (!isRead && task.name !== 'setParameterValues') continue;
    if (!allowAttempt(`${deviceId}|${task.name}|${task.objectName || ''}`)) continue;
    try {
      const ok = isRead
        ? await handleReadFault(fault, task, deviceId)
        : await handleWriteFault(fault, task, deviceId);
      if (ok) handled++;
    } catch (e: any) {
      console.warn(`[ACS-SEGURO] ${deviceId}: ${e.message}`);
    }
  }
  return { handled };
}

/** Fallos de tareas que siguen sin resolver (para el aviso del panel). */
export async function pendingTaskFaults(): Promise<any[]> {
  const faults: any[] = (await nbi('/faults/')) || [];
  return faults
    .filter((f) => /:task_/.test(String(f?._id)))
    .map((f) => ({
      deviceId: String(f.device || String(f._id).split(':task_')[0]),
      code: f.code || null,
      message: String(f.message || '').slice(0, 300),
      param: faultParam(f),
      retries: f.retries ?? null,
      timestamp: f.timestamp || null,
    }));
}
