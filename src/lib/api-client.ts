/**
 * VPS API Client - Configurable HTTP client for the self-hosted VPS backend.
 * Replaces Supabase client calls with direct API calls to the VPS.
 * 
 * Configure the API_BASE_URL via environment variable or localStorage.
 */

const getBaseUrl = (): string => {
  // Priority: 1) env var, 2) localStorage, 3) same-origin /api
  return (
    import.meta.env.VITE_API_BASE_URL ||
    localStorage.getItem('vps_api_url') ||
    '/api'
  );
};

export const setApiBaseUrl = (url: string) => {
  localStorage.setItem('vps_api_url', url);
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
  const { method = 'GET', body, headers = {}, noAuth = false } = options;
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

  const response = await fetch(url, config);

  if (!response.ok) {
    let errorData: any;
    try { errorData = await response.json(); } catch { errorData = null; }

    throw new ApiError(
      errorData?.error || errorData?.message || `Error ${response.status}`,
      response.status,
      errorData
    );
  }

  // Handle empty responses
  const text = await response.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
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

// ─── Devices API ──────────────────────────────────────────
export const devicesApi = {
  list: () => apiGet<any[]>('/devices'),
  get: (id: string) => apiGet<any>(`/devices/${id}`),
  create: (device: any) => apiPost('/devices', device),
  update: (id: string, device: any) => apiPut(`/devices/${id}`, device),
  delete: (id: string) => apiDelete(`/devices/${id}`),
};

// ─── Clients API ──────────────────────────────────────────
export const clientsApi = {
  list: (mikrotikId: string, params?: { is_potential_client?: boolean; limit?: number }) => {
    const query = new URLSearchParams({ mikrotik_id: mikrotikId });
    if (params?.is_potential_client !== undefined) query.set('is_potential_client', String(params.is_potential_client));
    if (params?.limit) query.set('limit', String(params.limit));
    return apiGet<any[]>(`/clients?${query}`);
  },
  get: (id: string) => apiGet<any>(`/clients/${id}`),
  create: (client: any) => apiPost('/clients', client),
  update: (id: string, client: any) => apiPut(`/clients/${id}`, client),
  delete: (id: string, deleteFromMikrotik?: boolean) => apiDelete(`/clients/${id}?delete_mikrotik=${deleteFromMikrotik ?? false}`),
  search: (identification: string) => apiGet<any>(`/clients/search?identification=${identification}`),
  register: (data: any) => apiPost('/clients/register', data),
  scan: (mikrotikId: string, scanType: string) => apiPost('/clients/scan', { mikrotik_id: mikrotikId, scan_type: scanType }),
  importClients: (mikrotikId: string, clients: any[]) => apiPost('/clients/import', { mikrotik_id: mikrotikId, clients }),
};

// ─── PPPoE API ────────────────────────────────────────────
export const pppoeApi = {
  list: (mikrotikId: string) => apiGet<any[]>(`/pppoe?mikrotik_id=${mikrotikId}`),
  active: (mikrotikId: string) => apiGet<any[]>(`/pppoe/active?mikrotik_id=${mikrotikId}`),
  add: (mikrotikId: string, userData: any) => apiPost('/pppoe', { mikrotik_id: mikrotikId, ...userData }),
  remove: (mikrotikId: string, userId: string) => apiDelete(`/pppoe/${userId}?mikrotik_id=${mikrotikId}`),
  enable: (mikrotikId: string, userId: string) => apiPost(`/pppoe/${userId}/enable`, { mikrotik_id: mikrotikId }),
  disable: (mikrotikId: string, userId: string) => apiPost(`/pppoe/${userId}/disable`, { mikrotik_id: mikrotikId }),
  disconnect: (mikrotikId: string, connectionId: string) => apiPost(`/pppoe/${connectionId}/disconnect`, { mikrotik_id: mikrotikId }),
  profiles: (mikrotikId: string) => apiGet<any[]>(`/pppoe/profiles?mikrotik_id=${mikrotikId}`),
  addProfile: (mikrotikId: string, profileData: any) => apiPost('/pppoe/profiles', { mikrotik_id: mikrotikId, ...profileData }),
  deleteProfile: (mikrotikId: string, profileId: string) => apiDelete(`/pppoe/profiles/${profileId}?mikrotik_id=${mikrotikId}`),
};

// ─── Hotspot API ──────────────────────────────────────────
export const hotspotApi = {
  users: (mikrotikId: string) => apiGet<any[]>(`/hotspot/users?mikrotik_id=${mikrotikId}`),
  activeUsers: (mikrotikId: string) => apiGet<any[]>(`/hotspot/active?mikrotik_id=${mikrotikId}`),
  addUser: (mikrotikId: string, userData: any) => apiPost('/hotspot/users', { mikrotik_id: mikrotikId, ...userData }),
  removeUser: (mikrotikId: string, userId: string) => apiDelete(`/hotspot/users/${userId}?mikrotik_id=${mikrotikId}`),
  profiles: (mikrotikId: string) => apiGet<any[]>(`/hotspot/profiles?mikrotik_id=${mikrotikId}`),
  addProfile: (mikrotikId: string, profileData: any) => apiPost('/hotspot/profiles', { mikrotik_id: mikrotikId, ...profileData }),
  deleteProfile: (mikrotikId: string, profileId: string) => apiDelete(`/hotspot/profiles/${profileId}?mikrotik_id=${mikrotikId}`),
};

// ─── Vouchers API ─────────────────────────────────────────
export const vouchersApi = {
  list: (mikrotikId: string) => apiGet<any[]>(`/vouchers?mikrotik_id=${mikrotikId}`),
  generate: (mikrotikId: string, data: any) => apiPost('/vouchers/generate', { mikrotik_id: mikrotikId, ...data }),
  delete: (mikrotikId: string, voucherId: string) => apiDelete(`/vouchers/${voucherId}?mikrotik_id=${mikrotikId}`),
  sell: (mikrotikId: string, voucherId: string, sellData: any) => apiPost(`/vouchers/${voucherId}/sell`, { mikrotik_id: mikrotikId, ...sellData }),
  salesHistory: (mikrotikId: string) => apiGet<any[]>(`/vouchers/sales-history?mikrotik_id=${mikrotikId}`),
  presets: (mikrotikId: string) => apiGet<any[]>(`/vouchers/presets?mikrotik_id=${mikrotikId}`),
  createPreset: (data: any) => apiPost('/vouchers/presets', data),
  updatePreset: (id: string, data: any) => apiPut(`/vouchers/presets/${id}`, data),
  deletePreset: (id: string) => apiDelete(`/vouchers/presets/${id}`),
};

// ─── System API ───────────────────────────────────────────
export const systemApi = {
  resources: (mikrotikId: string) => apiGet<any>(`/system/resources?mikrotik_id=${mikrotikId}`),
  interfaces: (mikrotikId: string) => apiGet<any[]>(`/system/interfaces?mikrotik_id=${mikrotikId}`),
  testConnection: (mikrotikId: string) => apiGet<any>(`/system/test?mikrotik_id=${mikrotikId}`),
};

// ─── Queues API ───────────────────────────────────────────
export const queuesApi = {
  list: (mikrotikId: string) => apiGet<any[]>(`/queues?mikrotik_id=${mikrotikId}`),
  add: (mikrotikId: string, data: any) => apiPost('/queues', { mikrotik_id: mikrotikId, ...data }),
  update: (mikrotikId: string, id: string, data: any) => apiPut(`/queues/${id}`, { mikrotik_id: mikrotikId, ...data }),
  delete: (mikrotikId: string, id: string) => apiDelete(`/queues/${id}?mikrotik_id=${mikrotikId}`),
  enable: (mikrotikId: string, id: string) => apiPost(`/queues/${id}/enable`, { mikrotik_id: mikrotikId }),
  disable: (mikrotikId: string, id: string) => apiPost(`/queues/${id}/disable`, { mikrotik_id: mikrotikId }),
};

// ─── Address List API ─────────────────────────────────────
export const addressListApi = {
  list: (mikrotikId: string) => apiGet<any[]>(`/address-list?mikrotik_id=${mikrotikId}`),
  add: (mikrotikId: string, data: any) => apiPost('/address-list', { mikrotik_id: mikrotikId, ...data }),
  remove: (mikrotikId: string, id: string) => apiDelete(`/address-list/${id}?mikrotik_id=${mikrotikId}`),
  toggleSuspension: (mikrotikId: string, data: any) => apiPost('/address-list/toggle-suspension', { mikrotik_id: mikrotikId, ...data }),
};

// ─── Billing API ──────────────────────────────────────────
export const billingApi = {
  getConfig: (mikrotikId: string) => apiGet<any>(`/billing/config?mikrotik_id=${mikrotikId}`),
  saveConfig: (data: any) => apiPost('/billing/config', data),
  clientSettings: (clientId: string) => apiGet<any>(`/billing/client/${clientId}`),
  updateClientSettings: (clientId: string, settings: any) => apiPut(`/billing/client/${clientId}`, settings),
  listSettings: (mikrotikId: string) => apiGet<any[]>(`/billing/settings?mikrotik_id=${mikrotikId}`),
  listSuspension: (mikrotikId: string) => apiGet<any[]>(`/billing/suspension-status?mikrotik_id=${mikrotikId}`),
};

// ─── Invoices API ─────────────────────────────────────────
export const invoicesApi = {
  list: (mikrotikId: string, params?: { status?: string | string[]; start_date?: string; end_date?: string; limit?: number; with_contracts?: boolean }) => {
    const query = new URLSearchParams({ mikrotik_id: mikrotikId });
    if (params?.status) {
      const statuses = Array.isArray(params.status) ? params.status : [params.status];
      statuses.forEach(s => query.append('status', s));
    }
    if (params?.start_date) query.set('start_date', params.start_date);
    if (params?.end_date) query.set('end_date', params.end_date);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.with_contracts) query.set('with_contracts', 'true');
    return apiGet<any[]>(`/invoices?${query}`);
  },
  get: (id: string) => apiGet<any>(`/invoices/${id}`),
  create: (data: any) => apiPost('/invoices', data),
  update: (id: string, data: any) => apiPut(`/invoices/${id}`, data),
  delete: (id: string) => apiDelete(`/invoices/${id}`),
  markPaid: (id: string, paymentData: any) => apiPost(`/invoices/${id}/pay`, paymentData),
  generateBatch: (mikrotikId: string) => apiPost('/invoices/generate', { mikrotik_id: mikrotikId }),
  generateForClient: (data: any) => apiPost('/invoices/generate-single', data),
  paidHistory: (mikrotikId: string, startDate: string, endDate: string) =>
    apiGet<any[]>(`/invoices/paid-history?mikrotik_id=${mikrotikId}&start_date=${startDate}&end_date=${endDate}`),
};

// ─── Users/Admin API ──────────────────────────────────────
export const usersApi = {
  list: () => apiGet<any[]>('/auth/users'),
  updateRole: (userId: string, role: string) => apiPut(`/auth/users/${userId}/role`, { role }),
  delete: (userId: string) => apiDelete(`/auth/users/${userId}`),
  createUser: (data: any) => apiPost('/auth/users', data),
};

// ─── Resellers API ────────────────────────────────────────
export const resellersApi = {
  assignments: (mikrotikId: string) => apiGet<any[]>(`/devices/${mikrotikId}/resellers`),
  assign: (mikrotikId: string, data: any) => apiPost(`/devices/${mikrotikId}/resellers`, data),
  updateCommission: (assignmentId: string, commission: number) => apiPut(`/devices/resellers/${assignmentId}`, { commission_percentage: commission }),
  remove: (assignmentId: string) => apiDelete(`/devices/resellers/${assignmentId}`),
};

// ─── Secretary API ────────────────────────────────────────
export const secretariesApi = {
  myAssignments: () => apiGet<any[]>('/devices/my-secretary-assignments'),
  assignments: (mikrotikId: string) => apiGet<any[]>(`/devices/${mikrotikId}/secretaries`),
  assign: (mikrotikId: string, data: any) => apiPost(`/devices/${mikrotikId}/secretaries`, data),
  update: (assignmentId: string, permissions: any) => apiPut(`/devices/secretaries/${assignmentId}`, permissions),
  remove: (assignmentId: string) => apiDelete(`/devices/secretaries/${assignmentId}`),
};

// ─── Contracts API ────────────────────────────────────────
export const contractsApi = {
  list: (mikrotikId: string) => apiGet<any[]>(`/clients/contracts?mikrotik_id=${mikrotikId}`),
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
export const serviceOptionsApi = {
  list: (mikrotikId: string) => apiGet<any[]>(`/clients/service-options?mikrotik_id=${mikrotikId}`),
  create: (data: any) => apiPost('/clients/service-options', data),
  update: (id: string, data: any) => apiPut(`/clients/service-options/${id}`, data),
  delete: (id: string) => apiDelete(`/clients/service-options/${id}`),
};

// ─── Cloudflare/VPS API ───────────────────────────────────
export const vpsApi = {
  getCloudflareConfig: (mikrotikId: string) => apiGet<any>(`/system/cloudflare/config?mikrotik_id=${mikrotikId}`),
  updateCloudflareConfig: (config: any) => apiPost('/system/cloudflare/config', config),
  tunnelAgent: (mikrotikId: string, action: string, params?: any) => apiPost('/system/tunnel/agent', { mikrotik_id: mikrotikId, action, ...params }),
  status: (mikrotikId: string) => apiGet<any>(`/system/vps/status?mikrotik_id=${mikrotikId}`),
  docker: (mikrotikId: string, action: string, service?: string) => apiPost('/system/vps/docker', { mikrotik_id: mikrotikId, action, service }),
};

// ─── Backup API ───────────────────────────────────────────
export const backupApi = {
  list: () => apiGet<any>('/backups'),
  create: (type: string) => apiPost('/backups/create', { type }),
  restore: (filename: string) => apiPost('/backups/restore', { filename }),
  delete: (filename: string) => apiDelete(`/backups/${encodeURIComponent(filename)}`),
  downloadUrl: (filename: string) => `${getBaseUrl()}/backups/download/${encodeURIComponent(filename)}`,
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
};
