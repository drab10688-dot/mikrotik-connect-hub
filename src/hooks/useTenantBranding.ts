import { useQuery } from '@tanstack/react-query';
import { tenantsApi } from '@/lib/api-client';
import { getToken } from '@/lib/api-client';

export interface TenantBranding {
  id?: string;
  slug: string;
  name: string;
  logo_url?: string | null;
  primary_color?: string | null;
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
