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

/**
 * URL de los escritorios remotos (KasmVNC). Van en puerto dedicado porque
 * KasmVNC usa rutas absolutas y no funciona bajo un subpath (/browser/).
 */
export const remoteDesktopUrl = (
  port: number | 'browser' | 'winbox',
  creds?: { user?: string; password?: string } | null,
): string => {
  const p = typeof port === 'number' ? port : port === 'winbox' ? 8082 : 8081;
  const host = window.location.hostname;
  // KasmVNC sólo funciona en contexto seguro: los escritorios se sirven por HTTPS
  // (certificado autofirmado; la primera vez hay que aceptar el aviso del navegador).
  // Cada usuario tiene su propio escritorio con credenciales temporales.
  const auth =
    creds?.user && creds?.password
      ? `${encodeURIComponent(creds.user)}:${encodeURIComponent(creds.password)}@`
      : '';
  // Barra de control y gestos táctiles activos: en celular permite pellizcar
  // para zoom, arrastrar para desplazar y abrir el teclado en pantalla.
  const base =
    `https://${auth}${host}:${p}/?autoconnect=true&reconnect=true&reconnect_delay=1000` +
    `&resize=scale&quality=4&compression=9&show_control_bar=true&show_dot=true` +
    `&toolbar=true&clipboard_up=true&clipboard_down=true&enable_perf_stats=false`;
  return auth ? base : withAuthToken(base);

};

/** ¿El visor se está abriendo desde un celular/tablet táctil? */
export const isMobileDevice = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua) ||
    (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches && window.innerWidth < 1024);
};

/**
 * Variante MÓVIL del escritorio remoto (Android/iPhone). No toca la versión de
 * escritorio: usa el mismo KasmVNC pero con la resolución adaptada al celular,
 * gestos táctiles, barra de control siempre visible y teclado en pantalla.
 */
export const remoteDesktopMobileUrl = (
  port: number | 'browser' | 'winbox' = 'browser',
): string => {
  const p = typeof port === 'number' ? port : port === 'winbox' ? 8082 : 8081;
  const host = window.location.hostname;
  const base =
    `https://${host}:${p}/?autoconnect=true&reconnect=true&reconnect_delay=1000` +
    // resize=scale: el escritorio (que arranca en resolución de celular) se
    // ajusta a la pantalla y permite pellizcar para acercar/alejar.
    `&resize=scale&quality=3&compression=9&video_quality=1` +
    // Barra de control, puntito de gestos y teclado en pantalla siempre a mano.
    `&show_control_bar=true&show_dot=true&toolbar=true&keyboard=true` +
    // Cursor y gestos táctiles nativos de KasmVNC (arrastrar = desplazar,
    // pellizcar = zoom, doble toque = clic).
    `&cursor_alphacrop=false&local_cursor=true&idle_disconnect=false` +
    `&clipboard_up=true&clipboard_down=true&enable_perf_stats=false`;
  return withAuthToken(base);
};


/** Visor interno con controles táctiles (zoom, teclado, pantalla completa). */
export const remoteDesktopViewerUrl = (
  port: number | 'browser' | 'winbox',
  title?: string,
  creds?: { user?: string; password?: string } | null,
): string => {
  const p = typeof port === 'number' ? port : port === 'winbox' ? 8082 : 8081;
  const q = new URLSearchParams({ port: String(p) });
  if (title) q.set('title', title);
  if (creds?.user) q.set('u', creds.user);
  if (creds?.password) q.set('p', creds.password);
  return `/vnc?${q.toString()}`;
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

  /** Envía el correo con el enlace para crear una nueva contraseña. */
  forgotPassword: (email: string) =>
    apiPost<{ success: boolean; message?: string }>(
      '/auth/forgot-password',
      { email, origin: window.location.origin },
      { noAuth: true },
    ),

  /** Guarda la nueva contraseña usando el token del correo. */
  resetPassword: (token: string, password: string) =>
    apiPost<{ success: boolean }>('/auth/reset-password', { token, password }, { noAuth: true }),

  /** Cambio de contraseña del usuario con sesión activa. */
  changePassword: (currentPassword: string, newPassword: string) =>
    apiPost<{ success: boolean }>('/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    }),
};

// ─── Correo (SMTP) por ISP o global del sistema ───────────
export const mailApi = {
  getSettings: async (scope: 'tenant' | 'global' = 'tenant') =>
    unwrapData<any>(await apiGet<any>(`/mail/settings${scope === 'global' ? '?scope=global' : ''}`)),
  saveSettings: async (payload: any, scope: 'tenant' | 'global' = 'tenant') =>
    unwrapData<any>(await apiPut<any>(`/mail/settings${scope === 'global' ? '?scope=global' : ''}`, payload)),
  test: (to: string, scope: 'tenant' | 'global' = 'tenant') =>
    apiPost<any>(`/mail/test${scope === 'global' ? '?scope=global' : ''}`, { to }),
};

// ─── Copias de seguridad (ISP y sistema completo) ─────────
export const backupApi = {
  list: async () => unwrapArray<any>(await apiGet<any>('/backup')),
  runTenant: async (tenantId?: string) =>
    unwrapData<any>(await apiPost<any>('/backup/tenant', tenantId ? { tenant_id: tenantId } : {})),
  runSystem: async () => unwrapData<any>(await apiPost<any>('/backup/system', {})),
  remove: (filename: string) => apiDelete(`/backup/${encodeURIComponent(filename)}`),
  downloadUrl: (filename: string) =>
    `${getApiBaseUrl()}/backup/download/${encodeURIComponent(filename)}?token=${encodeURIComponent(getToken() || '')}`,
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

// ─── PPPoE: usuarios y contraseña global por ISP ──────────
export const pppoeApi = {
  secrets: async (mikrotikId: string) => unwrapArray(await apiGet<any>(`/pppoe/${mikrotikId}/secrets`)),
  active: async (mikrotikId: string) => unwrapArray(await apiGet<any>(`/pppoe/${mikrotikId}/active`)),
  profiles: async (mikrotikId: string) => unwrapArray(await apiGet<any>(`/pppoe/${mikrotikId}/profiles`)),
  getSettings: async (mikrotikId: string) => unwrapData<any>(await apiGet<any>(`/pppoe/${mikrotikId}/settings`)),
  saveSettings: async (mikrotikId: string, payload: any) =>
    unwrapData<any>(await apiPut<any>(`/pppoe/${mikrotikId}/settings`, payload)),
  createUsers: async (mikrotikId: string, users: any[]) =>
    unwrapData<any>(await apiPost<any>(`/pppoe/${mikrotikId}/users`, { users })),
  deleteSecret: (mikrotikId: string, secretId: string) =>
    apiDelete(`/pppoe/${mikrotikId}/secrets/${encodeURIComponent(secretId)}`),
  audit: async (mikrotikId: string) => unwrapArray(await apiGet<any>(`/pppoe/${mikrotikId}/audit`)),
  logShare: (mikrotikId: string, usernames: string[], via: string) =>
    apiPost<any>(`/pppoe/${mikrotikId}/audit/share`, { usernames, via }).catch(() => null),
};


// ─── Permisos por usuario dentro del ISP ──────────────────
export const permissionsApi = {
  forUser: async (userId: string) => unwrapData<any>(await apiGet<any>(`/isp/user-permissions/${userId}`)),
  saveForUser: async (userId: string, permissions: any[]) =>
    unwrapData<any>(await apiPut<any>(`/isp/user-permissions/${userId}`, { permissions })),
  resetForUser: async (userId: string) => apiDelete<any>(`/isp/user-permissions/${userId}`),
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
  updatePppoeSecret: async (mikrotikId: string, secretId: string, data: { comment?: string; profile?: string }) =>
    unwrapData<any>(
      await apiPut<any>(`/netaccess/${mikrotikId}/pppoe/${encodeURIComponent(secretId)}`, data)
    ),
  devices: async (mikrotikId: string) =>
    unwrapData<any>(await apiGet<any>(`/netaccess/${mikrotikId}/devices`)),
  webfig: async (mikrotikId: string, port?: number) =>
    unwrapData<any>(await apiGet<any>(`/netaccess/${mikrotikId}/webfig${port ? `?port=${port}` : ''}`)),
  webCheck: async (mikrotikId: string, ip: string, port: number) =>
    unwrapData<any>(await apiGet<any>(`/netaccess/${mikrotikId}/web-check/${ip}/${port}`)),
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
  /** Lectura automática de todos los APs detectados (sin registrar credenciales). */
  apsAuto: async (mikrotikId: string) =>
    unwrapData<any>(await apiGet<any>(`/netaccess/${mikrotikId}/aps-auto`)),

  listApCredentials: async () => unwrapData<any>(await apiGet<any>('/netaccess/ap-credentials')),
  saveApCredentials: async (payload: any) =>
    unwrapData<any>(await apiPut<any>('/netaccess/ap-credentials', payload)),
  deleteApCredentials: async (id: string) =>
    unwrapData<any>(await apiDelete<any>(`/netaccess/ap-credentials/${id}`)),
};

// ─── Navegador remoto (Firefox real en el VPS) ───
export const browserApi = {
  /** Escritorio privado del usuario (se crea bajo demanda en el VPS). */
  status: async () => unwrapData<any>(await apiGet<any>('/browser/status')),
  /** Crea/reutiliza el escritorio propio y devuelve puerto y credenciales. */
  session: async () => unwrapData<any>(await apiPost<any>('/browser/session', {})),
  open: async (url: string, mikrotikId?: string, mobile?: boolean) =>
    unwrapData<any>(await apiPost<any>('/browser/open', { url, mikrotikId, mobile: !!mobile })),
  /** Latido del visor: evita que se cierren las pestañas mientras se usa. */
  ping: async () => unwrapData<any>(await apiPost<any>('/browser/ping', {})),
  /** Cierra todas las pestañas y borra cookies/historial del escritorio. */
  close: async () => unwrapData<any>(await apiPost<any>('/browser/close', {})),
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

