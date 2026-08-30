// Caché en memoria con "stale-while-revalidate":
// devuelve al instante el último valor conocido y refresca en segundo plano.
// Evita que el panel quede en blanco mientras la VPN responde lento.

interface Entry<T> {
  value: T;
  at: number;
  refreshing: boolean;
}

const store = new Map<string, Entry<any>>();
const inflight = new Map<string, Promise<any>>();

export interface SwrOptions {
  /** Tiempo tras el cual el valor se considera viejo y se refresca en segundo plano (ms) */
  ttlMs?: number;
  /** Tiempo máximo que se puede servir un valor viejo antes de esperar al origen (ms) */
  maxAgeMs?: number;
}

export async function swr<T>(
  key: string,
  loader: () => Promise<T>,
  { ttlMs = 15000, maxAgeMs = 5 * 60 * 1000 }: SwrOptions = {}
): Promise<T> {
  const entry = store.get(key) as Entry<T> | undefined;
  const age = entry ? Date.now() - entry.at : Infinity;

  const load = (): Promise<T> => {
    const existing = inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const p = loader()
      .then((value) => {
        store.set(key, { value, at: Date.now(), refreshing: false });
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };

  // Sin datos o demasiado viejos: hay que esperar
  if (!entry || age > maxAgeMs) return load();

  // Datos frescos
  if (age <= ttlMs) return entry.value;

  // Datos utilizables pero viejos: refrescar en segundo plano
  if (!entry.refreshing) {
    entry.refreshing = true;
    load()
      .catch(() => {
        // Mantener el valor anterior si el origen falla (VPN caída, timeout, etc.)
        const cur = store.get(key);
        if (cur) cur.refreshing = false;
      });
  }
  return entry.value;
}

export function invalidate(prefix: string) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/**
 * Mantiene "calientes" las claves más consultadas: las refresca en segundo
 * plano cada pocos segundos para que el panel las reciba SIEMPRE al instante
 * (nunca espera a la VPN/MikroTik).
 */
const warm = new Map<string, { loader: () => Promise<any>; everyMs: number; lastUse: number }>();

export function keepWarm(key: string, loader: () => Promise<any>, everyMs = 15000) {
  const cur = warm.get(key);
  if (cur) {
    cur.lastUse = Date.now();
    cur.loader = loader;
    return;
  }
  warm.set(key, { loader, everyMs, lastUse: Date.now() });
}

setInterval(() => {
  const now = Date.now();
  for (const [key, w] of warm) {
    // Deja de refrescar lo que nadie mira hace 10 minutos.
    if (now - w.lastUse > 10 * 60_000) {
      warm.delete(key);
      continue;
    }
    const entry = store.get(key);
    if (entry && now - entry.at < w.everyMs) continue;
    w.loader()
      .then((value) => store.set(key, { value, at: Date.now(), refreshing: false }))
      .catch(() => undefined);
  }
}, 5000).unref?.();

