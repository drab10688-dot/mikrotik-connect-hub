/**
 * VPS API Client - Configurable HTTP client for the self-hosted VPS backend.
 * Replaces Supabase client calls with direct API calls to the VPS.
 * 
 * Configure the API_BASE_URL via environment variable or localStorage.
 */

const normalizeApiBaseUrl = (url: string): string => {
  const trimmed = url.trim().replace(/\/$/, '');
  if (!trimmed) return '/api';

  // Si solo pasan host/base, forzamos sufijo /api
  if (/\/api$/i.test(trimmed)) return trimmed;
  return `${trimmed}/api`;
};

const getBaseUrl = (): string => {
  // Priority: 1) env var, 2) localStorage, 3) same-origin /api
  const envBase = import.meta.env.VITE_API_BASE_URL;
  if (envBase) return normalizeApiBaseUrl(envBase);

  const storedBase = localStorage.getItem('vps_api_url');
  if (storedBase) return normalizeApiBaseUrl(storedBase);

  return '/api';
};

export const setApiBaseUrl = (url: string) => {
  localStorage.setItem('vps_api_url', normalizeApiBaseUrl(url));
};

export const getApiBaseUrl = () => getBaseUrl();

// Token management
const TOKEN_KEY = 'vps_auth_token';
const USER_KEY = 'vps_auth_user';

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
};

/**
 * Añade el token a una URL del proxy web (iframe o pestaña nueva), donde el
 * navegador no puede enviar la cabecera Authorization.
 */
export const withAuthToken = (path?: string | null): string => {
  if (!path) return '';
  const token = getToken();
  if (!token) return path;
  return `${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
};


export const getStoredUser = () => {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
};

export const setStoredUser = (user: any) => {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
};

// Generic fetch wrapper
interface ApiOptions {
  method?: string;
  body?: any;
  headers?: Record<string, string>;
  noAuth?: boolean;
  timeoutMs?: number;
}

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(message: string, status: number, data?: any) {
    super(message);
    this.status = status;
    this.data = data;
    this.name = 'ApiError';
  }
}

export const api = async <T = any>(
  endpoint: string,
  options: ApiOptions = {}
): Promise<T> => {
  const { method = 'GET', body, headers = {}, noAuth = false, timeoutMs = method === 'GET' ? 15000 : 30000 } = options;
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}${endpoint}`;

  const reqHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };

  if (!noAuth) {
    const token = getToken();
    if (token) {
      reqHeaders['Authorization'] = `Bearer ${token}`;
    }
  }

  const config: RequestInit = {
    method,
    headers: reqHeaders,
  };

  if (body && method !== 'GET') {
    config.body = JSON.stringify(body);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      ...config,
      signal: controller.signal,
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new ApiError(
        `La solicitud tardó demasiado (${Math.ceil(timeoutMs / 1000)}s). Verifica la conexión del servidor.`,
        408
      );
    }
    throw new ApiError(error?.message || 'Error de conexión con la API', 0);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let errorData: any;
    try { errorData = await response.json(); } catch { errorData = null; }

    const isMissingLocalApi = response.status === 404 && baseUrl === '/api';
    const message = isMissingLocalApi
      ? 'API VPS no encontrada en este dominio. Configura la URL de tu VPS para continuar.'
      : (errorData?.error || errorData?.message || `Error ${response.status}`);

    throw new ApiError(message, response.status, errorData);
  }

  // Handle empty responses
  const text = await response.text();
  if (!text) return {} as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
};

// Convenience methods
export const apiGet = <T = any>(endpoint: string, options?: Omit<ApiOptions, 'method'>) =>
  api<T>(endpoint, { ...options, method: 'GET' });

export const apiPost = <T = any>(endpoint: string, body?: any, options?: Omit<ApiOptions, 'method' | 'body'>) =>
  api<T>(endpoint, { ...options, method: 'POST', body });

export const apiPut = <T = any>(endpoint: string, body?: any, options?: Omit<ApiOptions, 'method' | 'body'>) =>
  api<T>(endpoint, { ...options, method: 'PUT', body });

export const apiDelete = <T = any>(endpoint: string, options?: Omit<ApiOptions, 'method'>) =>
  api<T>(endpoint, { ...options, method: 'DELETE' });

// ─── Auth API ─────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    apiPost<{ token: string; user: any }>('/auth/login', { email, password }, { noAuth: true }),

  signup: (email: string, password: string, fullName: string) =>
    apiPost<{ token: string; user: any }>('/auth/register', { email, password, full_name: fullName }, { noAuth: true }),

  me: () => apiGet<{ user: any }>('/auth/me'),
};

// Helpers para normalizar respuestas del backend VPS
const unwrapData = <T = any>(payload: any): T => {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return payload.data as T;
  }
  return payload as T;
};

const unwrapArray = <T = any>(payload: any): T[] => {
  const data = unwrapData<any>(payload);
  return Array.isArray(data) ? data : [];
};

const getSelectedMikrotikId = () => localStorage.getItem('mikrotik_device_id');

// ─── Devices API ──────────────────────────────────────────
export const devicesApi = {
  list: async () => unwrapArray(await apiGet<any>('/devices')),
  get: async (id: string) => unwrapData(await apiGet<any>(`/devices/${id}`)),
  create: async (device: any) => unwrapData(await apiPost('/devices', device)),
  update: async (id: string, device: any) => unwrapData(await apiPut(`/devices/${id}`, device)),
  delete: (id: string) => apiDelete(`/devices/${id}`),
  testConnection: (id: string) => apiPost<any>(`/devices/${id}/connect`),
  diagnoseConnection: (id: string) => apiPost<any>(`/devices/${id}/connect/diagnose`),
};

// ─── System API ───────────────────────────────────────────
export const systemApi = {
  resources: async (mikrotikId: string) => unwrapData(await apiGet<any>(`/system/${mikrotikId}/resource`)),
  interfaces: async (mikrotikId: string) => unwrapArray(await apiGet<any>(`/system/${mikrotikId}/interfaces`)),
  testConnection: (mikrotikId: string) => apiPost<any>(`/devices/${mikrotikId}/connect`),
};

// ─── Users/Admin API ──────────────────────────────────────
export const usersApi = {
  list: async () => unwrapArray(await apiGet<any>('/auth/users')),
  updateRole: (userId: string, role: string) => apiPut(`/auth/users/${userId}/role`, { role }),
  delete: (userId: string) => apiDelete(`/auth/users/${userId}`),
  createUser: async (data: any) => apiPost('/auth/users', data),
};

// ─── Secretary API ────────────────────────────────────────
export const secretariesApi = {
  myAssignments: async () => unwrapArray(await apiGet<any>('/devices/my-secretary-assignments')),
  assignments: async (mikrotikId: string) => unwrapArray(await apiGet<any>(`/devices/${mikrotikId}/secretaries`)),
  assign: (mikrotikId: string, data: any) => apiPost(`/devices/${mikrotikId}/secretaries`, data),
  update: (assignmentId: string, permissions: any) => apiPut(`/devices/secretaries/${assignmentId}`, permissions),
  remove: (assignmentId: string) => apiDelete(`/devices/secretaries/${assignmentId}`),
};

// ─── Cloudflare Tunnel API (estilo Stream Player Pro) ─────
export const vpsApi = {
  tunnelStatus: () => apiGet<any>('/system/tunnel/status'),
  tunnelInstall: () => apiPost<any>('/system/tunnel/install'),
  tunnelStart: (port?: number) => apiPost<any>('/system/tunnel/start', { port: port || 80 }),
  tunnelStop: () => apiPost<any>('/system/tunnel/stop'),

  // Compatibilidad con componentes que esperan cloudflare_config de DB
  getCloudflareConfig: async (_mikrotikId: string) => {
    const status = await apiGet<any>('/system/tunnel/status');
    return {
      id: 'quick-tunnel',
      mode: 'free',
      is_active: status?.status === 'running',
      tunnel_url: status?.url || null,
      tunnel_name: null,
      domain: null,
      api_token: null,
      status: status?.status || 'stopped',
      installed: status?.installed || false,
      error: status?.error || null,
    };
  },
  updateCloudflareConfig: async (_config: any) => {
    throw new Error('El modo Pro de Cloudflare aún no está disponible en esta instalación VPS');
  },
  tunnelAgent: (mikrotikId: string, action: string, params?: any) => apiPost('/system/tunnel/agent', { mikrotik_id: mikrotikId, action, ...params }),
  status: async (mikrotikId: string) => unwrapData(await apiGet<any>(`/system/vps/status?mikrotik_id=${mikrotikId}`)),
  docker: (mikrotikId: string, action: string, service?: string) => apiPost('/system/vps/docker', { mikrotik_id: mikrotikId, action, service }),
};

// ─── MikroTik Command API (generic) ──────────────────────
export const mikrotikCommandApi = {
  exec: (mikrotikId: string, command: string, params?: any) =>
    apiPost<any>('/mikrotik/command', { mikrotik_id: mikrotikId, command, params }),
};

// ─── Diagnostics API ─────────────────────────────────────
export const diagnosticsApi = {
  run: (host: string, port: number) =>
    apiPost<any>('/system/diagnostics', { host, port, action: 'full-diagnostic' }),
};

// ─── Tenants (Multi-ISP) API ──────────────────────────────
export const tenantsApi = {
  publicBySlug: async (slug: string) => {
    const res = await apiGet<any>(`/tenants/public/${slug}`, { noAuth: true });
    return res?.data ?? res ?? null;
  },
  me: async () => {
    const res = await apiGet<any>('/tenants/me');
    return res?.data ?? null;
  },
  updateMine: async (data: any) => {
    const res = await apiPut<any>('/tenants/me', data);
    return res?.data ?? null;
  },
  list: async () => unwrapArray(await apiGet<any>('/tenants')),
  create: (data: any) => apiPost('/tenants', data),
  update: (id: string, data: any) => apiPut(`/tenants/${id}`, data),
  remove: (id: string) => apiDelete(`/tenants/${id}`),
};

// ─── Acceso a red: PPPoE, equipos y web embebida (WebFig / antenas) ───
export const netAccessApi = {
  pppoe: async (mikrotikId: string) =>
    unwrapData<any>(await apiGet<any>(`/netaccess/${mikrotikId}/pppoe`)),
  setPppoePassword: async (mikrotikId: string, secretId: string, password: string, kick = true) =>
    unwrapData<any>(
      await apiPut<any>(`/netaccess/${mikrotikId}/pppoe/${encodeURIComponent(secretId)}/password`, { password, kick })
    ),
  devices: async (mikrotikId: string) =>
    unwrapData<any>(await apiGet<any>(`/netaccess/${mikrotikId}/devices`)),
  webfig: async (mikrotikId: string, port?: number) =>
    unwrapData<any>(await apiGet<any>(`/netaccess/${mikrotikId}/webfig${port ? `?port=${port}` : ''}`)),
  getWebPorts: async () => unwrapData<any>(await apiGet<any>('/netaccess/web-ports')),
  setWebPorts: async (web_ports: any) =>
    unwrapData<any>(await apiPut<any>('/netaccess/web-ports', { web_ports })),
  wireless: async (mikrotikId: string) =>
    unwrapData<any>(await apiGet<any>(`/netaccess/${mikrotikId}/wireless`)),
  ethernet: async (mikrotikId: string) =>
    unwrapData<any>(await apiGet<any>(`/netaccess/${mikrotikId}/ethernet`)),
  pppoeEvents: async (mikrotikId: string, days = 7) =>
    unwrapData<any>(await apiGet<any>(`/netaccess/${mikrotikId}/pppoe-events?days=${days}`)),
  topology: async (mikrotikId: string) =>
    unwrapData<any>(await apiGet<any>(`/netaccess/${mikrotikId}/topology`)),
  lanAlerts: async (mikrotikId: string) =>
    unwrapData<any>(await apiGet<any>(`/netaccess/${mikrotikId}/lan-alerts`)),
  apClients: async (mikrotikId: string, ip: string, brand?: string) =>
    unwrapData<any>(
      await apiGet<any>(`/netaccess/${mikrotikId}/ap/${ip}/clients${brand ? `?brand=${brand}` : ''}`)
    ),
  listApCredentials: async () => unwrapData<any>(await apiGet<any>('/netaccess/ap-credentials')),
  saveApCredentials: async (payload: any) =>
    unwrapData<any>(await apiPut<any>('/netaccess/ap-credentials', payload)),
  deleteApCredentials: async (id: string) =>
    unwrapData<any>(await apiDelete<any>(`/netaccess/ap-credentials/${id}`)),
};

// ─── Acceso web directo a la ONU (sin TR-069) con perfiles aprendidos ───
export const onuWebApi = {
  listCredentials: async () => unwrapData<any>(await apiGet<any>('/onu-web/credentials')),
  saveCredentials: async (payload: any) =>
    unwrapData<any>(await apiPut<any>('/onu-web/credentials', payload)),
  deleteCredentials: async (id: string) =>
    unwrapData<any>(await apiDelete<any>(`/onu-web/credentials/${id}`)),
  listProfiles: async () => unwrapData<any>(await apiGet<any>('/onu-web/profiles')),
  createProfile: async (payload: any) => unwrapData<any>(await apiPost<any>('/onu-web/profiles', payload)),
  updateProfile: async (id: string, payload: any) =>
    unwrapData<any>(await apiPut<any>(`/onu-web/profiles/${id}`, payload)),
  deleteProfile: async (id: string) => unwrapData<any>(await apiDelete<any>(`/onu-web/profiles/${id}`)),
  probe: async (payload: any) => unwrapData<any>(await apiPost<any>('/onu-web/probe', payload)),
  browse: async (ip: string, path = '/') =>
    unwrapData<any>(await apiGet<any>(`/onu-web/browse?ip=${encodeURIComponent(ip)}&path=${encodeURIComponent(path)}`)),
  apply: async (payload: any) => unwrapData<any>(await apiPost<any>('/onu-web/apply', payload)),
  events: async () => unwrapData<any>(await apiGet<any>('/onu-web/events')),
};
