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

// ─── Clients API ──────────────────────────────────────────
export const clientsApi = {
  list: async (mikrotikId: string, params?: { is_potential_client?: boolean; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.is_potential_client !== undefined) query.set('is_potential_client', String(params.is_potential_client));
    if (params?.limit) query.set('limit', String(params.limit));
    const queryString = query.toString();
    const endpoint = queryString ? `/clients/${mikrotikId}?${queryString}` : `/clients/${mikrotikId}`;
    return unwrapArray(await apiGet<any>(endpoint));
  },
  get: (id: string) => apiGet<any>(`/clients/detail/${id}`),
  create: async (client: any) => {
    const mikrotikId = client?.mikrotik_id;
    if (!mikrotikId) throw new Error('mikrotik_id es requerido para crear cliente');
    return unwrapData(await apiPost(`/clients/${mikrotikId}`, client));
  },
  update: async (id: string, client: any) => {
    const mikrotikId = client?.mikrotik_id || getSelectedMikrotikId();
    if (!mikrotikId) throw new Error('mikrotik_id es requerido para actualizar cliente');
    return unwrapData(await apiPut(`/clients/${mikrotikId}/${id}`, client));
  },
  delete: async (id: string, _deleteFromMikrotik?: boolean, mikrotikId?: string) => {
    const resolvedMikrotikId = mikrotikId || getSelectedMikrotikId();
    if (!resolvedMikrotikId) throw new Error('Selecciona un MikroTik antes de eliminar el cliente');
    return apiDelete(`/clients/${resolvedMikrotikId}/${id}`);
  },
  search: async (identification: string) => {
    const data = await apiGet<any>(`/clients/search/identification/${encodeURIComponent(identification)}`);
    const rows = unwrapArray(data);
    return rows[0] || null;
  },
  register: (data: any) => apiPost('/clients/register', data),
  scan: (mikrotikId: string, scanType: string) => apiPost('/clients/scan', { mikrotik_id: mikrotikId, scan_type: scanType }),
  importClients: (mikrotikId: string, clients: any[]) => apiPost('/clients/import', { mikrotik_id: mikrotikId, clients }),
};

// ─── PPPoE API ────────────────────────────────────────────
export const pppoeApi = {
  list: async (mikrotikId: string) => unwrapArray(await apiGet<any>(`/pppoe/${mikrotikId}/secrets`)),
  active: async (mikrotikId: string) => unwrapArray(await apiGet<any>(`/pppoe/${mikrotikId}/active`)),
  add: async (mikrotikId: string, userData: any) => unwrapData(await apiPost(`/pppoe/${mikrotikId}/secrets`, userData)),
  remove: (mikrotikId: string, userId: string) => apiDelete(`/pppoe/${mikrotikId}/secrets/${userId}`),
  enable: (mikrotikId: string, userId: string) => apiPut(`/pppoe/${mikrotikId}/secrets/${userId}`, { disabled: 'false' }),
  disable: (mikrotikId: string, userId: string) => apiPut(`/pppoe/${mikrotikId}/secrets/${userId}`, { disabled: 'true' }),
  disconnect: (mikrotikId: string, connectionId: string) => apiPost(`/pppoe/${mikrotikId}/disconnect/${connectionId}`),
  profiles: async (mikrotikId: string) => unwrapArray(await apiGet<any>(`/pppoe/${mikrotikId}/profiles`)),
  addProfile: (mikrotikId: string, profileData: any) => apiPost(`/pppoe/${mikrotikId}/profiles`, profileData),
  deleteProfile: (mikrotikId: string, profileId: string) => apiDelete(`/pppoe/${mikrotikId}/profiles/${profileId}`),
};

// ─── Hotspot API ──────────────────────────────────────────
export const hotspotApi = {
  users: async (mikrotikId: string) => unwrapArray(await apiGet<any>(`/hotspot/${mikrotikId}/users`)),
  activeUsers: async (mikrotikId: string) => unwrapArray(await apiGet<any>(`/hotspot/${mikrotikId}/active`)),
  addUser: async (mikrotikId: string, userData: any) => unwrapData(await apiPost(`/hotspot/${mikrotikId}/users`, userData)),
  removeUser: (mikrotikId: string, userId: string) => apiDelete(`/hotspot/${mikrotikId}/users/${userId}`),
  profiles: async (mikrotikId: string) => unwrapArray(await apiGet<any>(`/hotspot/${mikrotikId}/profiles`)),
  addProfile: (mikrotikId: string, profileData: any) => apiPost(`/hotspot/${mikrotikId}/profiles`, profileData),
  deleteProfile: (mikrotikId: string, profileId: string) => apiDelete(`/hotspot/${mikrotikId}/profiles/${profileId}`),
};

// ─── Vouchers API ─────────────────────────────────────────
export const vouchersApi = {
  list: async (mikrotikId: string) => unwrapArray(await apiGet<any>(`/vouchers/${mikrotikId}`)),
  generate: async (mikrotikId: string, data: any) => unwrapArray(await apiPost(`/vouchers/${mikrotikId}/generate`, data)),
  delete: (mikrotikId: string, voucherId: string) => apiDelete(`/vouchers/${mikrotikId}/${voucherId}`),
  sell: (mikrotikId: string, voucherId: string, sellData: any) => apiPost(`/vouchers/${mikrotikId}/sell/${voucherId}`, sellData),
  salesHistory: async (mikrotikId: string) => unwrapArray(await apiGet<any>(`/vouchers/${mikrotikId}/sales-history`)),
  presets: async (mikrotikId: string) => unwrapArray(await apiGet<any>(`/vouchers/${mikrotikId}/presets`)),
  createPreset: (data: any) => apiPost('/vouchers/presets', data),
  updatePreset: (id: string, data: any) => apiPut(`/vouchers/presets/${id}`, data),
  deletePreset: (id: string) => apiDelete(`/vouchers/presets/${id}`),
};

// ─── System API ───────────────────────────────────────────
export const systemApi = {
  resources: async (mikrotikId: string) => unwrapData(await apiGet<any>(`/system/${mikrotikId}/resource`)),
  interfaces: async (mikrotikId: string) => unwrapArray(await apiGet<any>(`/system/${mikrotikId}/interfaces`)),
  testConnection: (mikrotikId: string) => apiPost<any>(`/devices/${mikrotikId}/connect`),
};

// ─── Queues API ───────────────────────────────────────────
export const queuesApi = {
  list: async (mikrotikId: string) => unwrapArray(await apiGet<any>(`/queues/${mikrotikId}`)),
  add: (mikrotikId: string, data: any) => apiPost(`/queues/${mikrotikId}`, data),
  update: (mikrotikId: string, id: string, data: any) => apiPut(`/queues/${mikrotikId}/${id}`, data),
  delete: (mikrotikId: string, id: string) => apiDelete(`/queues/${mikrotikId}/${id}`),
  enable: (mikrotikId: string, id: string) => apiPost(`/queues/${mikrotikId}/${id}/toggle`, { disabled: false }),
  disable: (mikrotikId: string, id: string) => apiPost(`/queues/${mikrotikId}/${id}/toggle`, { disabled: true }),
};

// ─── Address List API ─────────────────────────────────────
export const addressListApi = {
  list: async (mikrotikId: string) => unwrapArray(await apiGet<any>(`/address-list/${mikrotikId}`)),
  add: (mikrotikId: string, data: any) => apiPost(`/address-list/${mikrotikId}`, data),
  remove: (mikrotikId: string, id: string) => apiDelete(`/address-list/${mikrotikId}/${id}`),
  toggleSuspension: (mikrotikId: string, data: any) => apiPost('/address-list/toggle-suspension', { mikrotik_id: mikrotikId, ...data }),
};

// ─── Billing API ──────────────────────────────────────────
export const billingApi = {
  getConfig: async (mikrotikId: string) => unwrapData(await apiGet<any>(`/billing/${mikrotikId}/config`)),
  saveConfig: async (data: any) => {
    const mikrotikId = data?.mikrotik_id;
    if (!mikrotikId) throw new Error('mikrotik_id es requerido para guardar la configuración');
    return unwrapData(await apiPost(`/billing/${mikrotikId}/config`, data));
  },
  clientSettings: async (clientId: string) => unwrapData(await apiGet<any>(`/billing/client/${clientId}`)),
  updateClientSettings: (clientId: string, settings: any) => apiPut(`/billing/client/${clientId}`, settings),
  listSettings: async (mikrotikId: string) => unwrapArray(await apiGet<any>(`/billing/settings?mikrotik_id=${mikrotikId}`)),
  listSuspension: async (mikrotikId: string) => unwrapArray(await apiGet<any>(`/billing/suspension-status?mikrotik_id=${mikrotikId}`)),
};

// ─── Invoices API ─────────────────────────────────────────
export const invoicesApi = {
  list: async (mikrotikId: string, params?: { status?: string | string[]; start_date?: string; end_date?: string; limit?: number; with_contracts?: boolean }) => {
    const query = new URLSearchParams();
    if (params?.status) {
      const statuses = Array.isArray(params.status) ? params.status : [params.status];
      if (statuses[0]) query.set('status', statuses[0]);
    }
    const queryString = query.toString();
    const endpoint = queryString ? `/invoices/${mikrotikId}?${queryString}` : `/invoices/${mikrotikId}`;
    return unwrapArray(await apiGet<any>(endpoint));
  },
  get: (id: string) => apiGet<any>(`/invoices/detail/${id}`),
  create: async (data: any) => {
    const mikrotikId = data?.mikrotik_id || getSelectedMikrotikId();
    if (!mikrotikId) throw new Error('mikrotik_id es requerido para crear factura');
    return unwrapData(await apiPost(`/invoices/${mikrotikId}`, data));
  },
  update: (id: string, data: any) => apiPut(`/invoices/detail/${id}`, data),
  delete: async (id: string, mikrotikId?: string) => {
    const resolvedMikrotikId = mikrotikId || getSelectedMikrotikId();
    if (!resolvedMikrotikId) throw new Error('Selecciona un MikroTik antes de eliminar factura');
    return apiDelete(`/invoices/${resolvedMikrotikId}/${id}`);
  },
  markPaid: async (id: string, paymentData: any) => {
    const mikrotikId = paymentData?.mikrotik_id || getSelectedMikrotikId();
    if (!mikrotikId) throw new Error('Selecciona un MikroTik antes de registrar pago');
    return unwrapData(await apiPost(`/invoices/${mikrotikId}/pay/${id}`, paymentData));
  },
  generateBatch: (mikrotikId: string) => apiPost('/invoices/generate', { mikrotik_id: mikrotikId }),
  generateForClient: (data: any) => apiPost('/invoices/generate-single', data),
  paidHistory: async (mikrotikId: string, startDate: string, endDate: string) =>
    unwrapArray(await apiGet<any>(`/invoices/paid-history?mikrotik_id=${mikrotikId}&start_date=${startDate}&end_date=${endDate}`)),
};

// ─── Users/Admin API ──────────────────────────────────────
export const usersApi = {
  list: async () => unwrapArray(await apiGet<any>('/auth/users')),
  updateRole: (userId: string, role: string) => apiPut(`/auth/users/${userId}/role`, { role }),
  delete: (userId: string) => apiDelete(`/auth/users/${userId}`),
  createUser: async (data: any) => apiPost('/auth/users', data),
};

// ─── Resellers API ────────────────────────────────────────
export const resellersApi = {
  assignments: async (mikrotikId: string) => unwrapArray(await apiGet<any>(`/devices/${mikrotikId}/resellers`)),
  assign: (mikrotikId: string, data: any) => apiPost(`/devices/${mikrotikId}/resellers`, data),
  updateCommission: (assignmentId: string, commission: number) => apiPut(`/devices/resellers/${assignmentId}`, { commission_percentage: commission }),
  remove: (assignmentId: string) => apiDelete(`/devices/resellers/${assignmentId}`),
};

// ─── Secretary API ────────────────────────────────────────
export const secretariesApi = {
  myAssignments: async () => unwrapArray(await apiGet<any>('/devices/my-secretary-assignments')),
  assignments: async (mikrotikId: string) => unwrapArray(await apiGet<any>(`/devices/${mikrotikId}/secretaries`)),
  assign: (mikrotikId: string, data: any) => apiPost(`/devices/${mikrotikId}/secretaries`, data),
  update: (assignmentId: string, permissions: any) => apiPut(`/devices/secretaries/${assignmentId}`, permissions),
  remove: (assignmentId: string) => apiDelete(`/devices/secretaries/${assignmentId}`),
};

// ─── Contracts API ────────────────────────────────────────
export const contractsApi = {
  list: async (mikrotikId: string) => unwrapArray(await apiGet<any>(`/clients/contracts?mikrotik_id=${mikrotikId}`)),
  get: (id: string) => apiGet<any>(`/clients/contracts/${id}`),
  create: (data: any) => apiPost('/clients/contracts', data),
  update: (id: string, data: any) => apiPut(`/clients/contracts/${id}`, data),
  delete: (id: string) => apiDelete(`/clients/contracts/${id}`),
  verify: (contractNumber: string) => apiGet<any>(`/clients/contracts/verify/${contractNumber}`, { noAuth: true }),
};

// ─── Messaging API ────────────────────────────────────────
export const messagingApi = {
  // Telegram
  getTelegramConfig: (mikrotikId: string) => apiGet<any>(`/messaging/telegram/config?mikrotik_id=${mikrotikId}`),
  updateTelegramConfig: (mikrotikId: string, config: any) => apiPut('/messaging/telegram/config', { mikrotik_id: mikrotikId, ...config }),
  sendTelegram: (data: any) => apiPost('/messaging/telegram/send', data),
  // WhatsApp
  getWhatsappConfig: (mikrotikId: string) => apiGet<any>(`/messaging/whatsapp/config?mikrotik_id=${mikrotikId}`),
  updateWhatsappConfig: (mikrotikId: string, config: any) => apiPut('/messaging/whatsapp/config', { mikrotik_id: mikrotikId, ...config }),
  sendWhatsapp: (data: any) => apiPost('/messaging/whatsapp/send', data),
};

// ─── Service Options API ──────────────────────────────────
const serviceOptionsPrimaryBase = '/service-options';
const serviceOptionsLegacyBase = '/clients/service-options';

const callServiceOptions = async <T = any>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: any
): Promise<T> => {
  const call = async (base: string) => {
    const endpoint = `${base}${path}`;
    if (method === 'GET') return apiGet<T>(endpoint);
    if (method === 'POST') return apiPost<T>(endpoint, body);
    if (method === 'PUT') return apiPut<T>(endpoint, body);
    return apiDelete<T>(endpoint);
  };

  try {
    return await call(serviceOptionsPrimaryBase);
  } catch (error: any) {
    if (error instanceof ApiError && error.status === 404) {
      return await call(serviceOptionsLegacyBase);
    }
    throw error;
  }
};

export const serviceOptionsApi = {
  list: async (mikrotikId: string) => unwrapArray(await callServiceOptions<any>('GET', `?mikrotik_id=${mikrotikId}`)),
  create: async (data: any) => unwrapData(await callServiceOptions('POST', '', data)),
  update: async (id: string, data: any) => unwrapData(await callServiceOptions('PUT', `/${id}`, data)),
  delete: (id: string) => callServiceOptions('DELETE', `/${id}`),
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

// ─── Backup API ───────────────────────────────────────────
export const backupApi = {
  list: () => apiGet<any>('/backups'),
  create: (type: string) => apiPost('/backups/create', { type }),
  restore: (filename: string) => apiPost('/backups/restore', { filename }),
  delete: (filename: string) => apiDelete(`/backups/${encodeURIComponent(filename)}`),
  downloadUrl: (filename: string) => `${getBaseUrl()}/backups/download/${encodeURIComponent(filename)}`,
  upload: async (file: File): Promise<any> => {
    const token = getToken();
    const formData = new FormData();
    formData.append('backup', file);
    const res = await fetch(`${getBaseUrl()}/backups/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al subir backup');
    return data;
  },
};

// ─── Payment Platforms API ────────────────────────────────
export const paymentPlatformsApi = {
  list: (mikrotikId: string) => apiGet<any[]>(`/billing/platforms?mikrotik_id=${mikrotikId}`),
  update: (platform: any) => apiPost('/billing/platforms', platform),
  delete: (id: string) => apiDelete(`/billing/platforms/${id}`),
};

// ─── Transactions API ─────────────────────────────────────
export const transactionsApi = {
  list: (mikrotikId: string, params?: { status?: string; start_date?: string; end_date?: string }) => {
    const query = new URLSearchParams({ mikrotik_id: mikrotikId });
    if (params?.status) query.set('status', params.status);
    if (params?.start_date) query.set('start_date', params.start_date);
    if (params?.end_date) query.set('end_date', params.end_date);
    return apiGet<any[]>(`/billing/transactions?${query}`);
  },
};

// ─── MikroTik Command API (generic) ──────────────────────
export const mikrotikCommandApi = {
  exec: (mikrotikId: string, command: string, params?: any) =>
    apiPost<any>('/mikrotik/command', { mikrotik_id: mikrotikId, command, params }),
};

// ─── Accounting API ──────────────────────────────────────
export const accountingApi = {
  summary: (mikrotikId: string, startDate: string, endDate: string) =>
    apiGet<any>(`/accounting/summary?mikrotik_id=${mikrotikId}&start_date=${startDate}&end_date=${endDate}`),
};

// ─── Diagnostics API ─────────────────────────────────────
export const diagnosticsApi = {
  run: (host: string, port: number) =>
    apiPost<any>('/system/diagnostics', { host, port, action: 'full-diagnostic' }),
};

// ─── Hotspot Login API (public) ──────────────────────────
export const hotspotLoginApi = {
  login: (mikrotikId: string, username: string, password: string) =>
    apiPost<any>('/hotspot/login', { mikrotik_id: mikrotikId, username, password }, { noAuth: true }),
  nuxbillLogin: (params: { mikrotik_id: string; code?: string; username?: string; password?: string; mode?: 'voucher' | 'customer' }) =>
    apiPost<any>('/hotspot/nuxbill-login', params, { noAuth: true }),
};

// ─── Portal Ads API ──────────────────────────────────────
export const portalAdsApi = {
  list: async (mikrotikId: string) => unwrapArray(await apiGet<any>(`/portal-ads/${mikrotikId}`)),
  create: (mikrotikId: string, data: any) => apiPost(`/portal-ads/${mikrotikId}`, data),
  update: (mikrotikId: string, adId: string, data: any) => apiPut(`/portal-ads/${mikrotikId}/${adId}`, data),
  delete: (mikrotikId: string, adId: string) => apiDelete(`/portal-ads/${mikrotikId}/${adId}`),
  stats: async (mikrotikId: string) => unwrapData(await apiGet<any>(`/portal-ads/${mikrotikId}/stats/summary`)),
  // Public (no auth)
  publicList: async (mikrotikId: string, position?: string) => {
    const q = position ? `?position=${position}` : '';
    return unwrapArray(await apiGet<any>(`/portal-ads/public/${mikrotikId}${q}`, { noAuth: true }));
  },
  trackImpression: (adId: string) => apiPost(`/portal-ads/public/${adId}/impression`, {}, { noAuth: true }),
  trackClick: (adId: string) => apiPost(`/portal-ads/public/${adId}/click`, {}, { noAuth: true }),
};
