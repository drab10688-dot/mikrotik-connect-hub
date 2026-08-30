import { useQuery } from '@tanstack/react-query';
import { tenantsApi } from '@/lib/api-client';
import { getToken } from '@/lib/api-client';

export interface TenantBranding {
  id?: string;
  slug: string;
  name: string;
  logo_url?: string | null;
  primary_color?: string | null;
  enable_onus?: boolean;
  enable_mikrotik?: boolean;
  enable_tr069?: boolean;
  enable_onu_web?: boolean;
  web_ports?: Record<string, { port: number; protocol: 'http' | 'https' }> | null;
}

const STORAGE_KEY = 'omnisync_tenant_slug';

export const getStoredTenantSlug = () => localStorage.getItem(STORAGE_KEY) || '';
export const setStoredTenantSlug = (slug: string) => localStorage.setItem(STORAGE_KEY, slug);

/** Branding público por slug (pantalla de login /isp/:slug). */
export function usePublicTenant(slug?: string) {
  const effectiveSlug = slug || getStoredTenantSlug();

  const { data, isLoading } = useQuery({
    queryKey: ['tenant-public', effectiveSlug],
    queryFn: () => tenantsApi.publicBySlug(effectiveSlug),
    enabled: !!effectiveSlug,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  return { tenant: (data as TenantBranding | null) || null, isLoading };
}

/** Branding del ISP del usuario autenticado (panel). */
export function useMyTenant() {
  const { data, isLoading } = useQuery({
    queryKey: ['tenant-me'],
    queryFn: () => tenantsApi.me(),
    enabled: !!getToken(),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  return { tenant: (data as TenantBranding | null) || null, isLoading };
}

export type TenantModule = 'onus' | 'mikrotik' | 'onu_web' | 'tr069';

/** ¿Está habilitado el módulo para el ISP del usuario? */
export function useModuleEnabled() {
  const { tenant, isLoading } = useMyTenant();

  const isEnabled = (module?: TenantModule) => {
    if (!module) return true;
    if (!tenant) return true; // instalación sin multi-ISP
    if (module === 'onus') return tenant.enable_onus !== false;
    if (module === 'onu_web') return tenant.enable_onu_web !== false;
    if (module === 'tr069') return tenant.enable_tr069 !== false;
    return tenant.enable_mikrotik !== false;
  };

  return { isEnabled, isLoading, tenant };
}
