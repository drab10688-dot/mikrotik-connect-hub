import { apiGet, apiPost, getToken, remoteDesktopUrl } from '@/lib/api-client';

export interface WinboxRouter {
  id: string;
  name: string;
  /** IP por la que el VPS alcanza el router (IP del túnel L2TP). */
  address: string;
}

export interface WinboxStatus {
  running: boolean;
  installed: boolean;
  idleMinutes: number;
  routers: WinboxRouter[];
}

const data = <T,>(payload: any): T =>
  payload && typeof payload === 'object' && 'data' in payload ? (payload.data as T) : (payload as T);

/** WinBox remoto por usuario (permiso "winbox"). */
export const winboxApi = {
  status: async () => data<WinboxStatus>(await apiGet<any>('/winbox/status')),
  /** Crea el WinBox propio y le aplica el aislamiento antes de abrir el visor. */
  session: async () => data<any>(await apiPost<any>('/winbox/session', {})),
  /** Cierra el WinBox: se borran direcciones y claves guardadas en él. */
  close: async () => data<any>(await apiPost<any>('/winbox/close', {})),
  /**
   * Prepara una antena de cliente: ruta por el túnel de su sede y permiso en el
   * firewall del WinBox. Devuelve "IP:puerto" (puerto WinBox del ISP).
   */
  target: async (mikrotikId: string, ip: string, plain = false) =>
    data<{ address: string; inWinbox: boolean }>(await apiPost<any>('/winbox/target', { mikrotikId, ip, plain })),
};

/**
 * Abre un equipo en el WinBox propio: la pestaña se abre dentro del clic (si
 * no, el navegador la bloquea) y la API prepara la ruta y deja "IP:puerto" en
 * el portapapeles DEL WinBox (Ctrl+V en "Connect to"); también se copia en el
 * del PC. plain = el router mismo (sin el puerto WinBox de las antenas).
 */
export async function openWinboxTo(
  mikrotikId: string,
  ip: string,
  plain = false,
): Promise<{ address: string; copied: boolean; inWinbox: boolean }> {
  const tab = window.open('', '_blank');
  try {
    const { address, inWinbox } = await winboxApi.target(mikrotikId, ip, plain);
    const copied = await navigator.clipboard.writeText(address).then(() => true, () => false);
    const token = getToken();
    if (token) {
      document.cookie = `omnisync_web_token=${encodeURIComponent(token)}; Path=/; SameSite=Lax; Max-Age=43200`;
    }
    const url = remoteDesktopUrl('winbox');
    if (tab) tab.location.href = url;
    else window.location.href = url;
    return { address, copied, inWinbox };
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/**
 * Abre el WinBox propio en una pestaña nueva. Debe llamarse dentro del clic:
 * la pestaña se abre de inmediato (si no, el navegador la bloquea) y se dirige
 * al visor cuando el WinBox está listo y aislado. Si se indica `address`, se
 * copia al portapapeles para pegarla en "Connect to".
 * Devuelve true si se copió la dirección.
 */
export async function openWinbox(address?: string): Promise<boolean> {
  let copied = false;
  if (address) {
    copied = await navigator.clipboard.writeText(address).then(() => true, () => false);
  }
  const tab = window.open('', '_blank');
  try {
    await winboxApi.session();
    const token = getToken();
    if (token) {
      document.cookie = `omnisync_web_token=${encodeURIComponent(token)}; Path=/; SameSite=Lax; Max-Age=43200`;
    }
    const url = remoteDesktopUrl('winbox');
    if (tab) tab.location.href = url;
    else window.location.href = url;
    return copied;
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/** Aviso tras abrir un equipo en WinBox: dónde quedó la dirección. */
export function winboxReadyText(r: { address: string; copied: boolean; inWinbox: boolean }): string {
  if (r.inWinbox) return `${r.address} listo: en tu WinBox haz clic en "Connect to" y pulsa Ctrl+V`;
  if (r.copied) return `${r.address} copiado en tu PC: escríbelo o pégalo en "Connect to" del WinBox`;
  return `Escribe ${r.address} en "Connect to" del WinBox`;
}
