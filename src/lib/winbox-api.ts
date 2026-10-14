import { apiGet, apiPost } from '@/lib/api-client';

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
};
