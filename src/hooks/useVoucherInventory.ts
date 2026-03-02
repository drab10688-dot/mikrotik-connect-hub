import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vouchersApi, hotspotApi, apiPost, apiGet, apiDelete } from '@/lib/api-client';
import { toast } from 'sonner';
import { useAuth } from './useAuth';

interface GenerateVouchersParams {
  count: number;
  profile: string;
  mikrotikId: string;
  validity: string;
  price?: number;
}

function parseUptimeToMs(uptime: string): number {
  if (!uptime || uptime === '0s') return 0;
  let totalMs = 0;
  const weekMatch = uptime.match(/(\d+)w/);
  const dayMatch = uptime.match(/(\d+)d/);
  const hourMatch = uptime.match(/(\d+)h/);
  const minMatch = uptime.match(/(\d+)m(?!s)/);
  const secMatch = uptime.match(/(\d+)s/);
  if (weekMatch) totalMs += parseInt(weekMatch[1]) * 7 * 24 * 60 * 60 * 1000;
  if (dayMatch) totalMs += parseInt(dayMatch[1]) * 24 * 60 * 60 * 1000;
  if (hourMatch) totalMs += parseInt(hourMatch[1]) * 60 * 60 * 1000;
  if (minMatch) totalMs += parseInt(minMatch[1]) * 60 * 1000;
  if (secMatch) totalMs += parseInt(secMatch[1]) * 1000;
  return totalMs;
}

function parseValidityToMs(validity: string): number {
  if (!validity) return 0;
  const hourMatch = validity.match(/^(\d+)h$/);
  const dayMatch = validity.match(/^(\d+)d$/);
  const weekMatch = validity.match(/^(\d+)w$/);
  const monthMatch = validity.match(/^(\d+)m$/);
  if (hourMatch) return parseInt(hourMatch[1]) * 60 * 60 * 1000;
  if (dayMatch) return parseInt(dayMatch[1]) * 24 * 60 * 60 * 1000;
  if (weekMatch) return parseInt(weekMatch[1]) * 7 * 24 * 60 * 60 * 1000;
  if (monthMatch) return parseInt(monthMatch[1]) * 30 * 24 * 60 * 60 * 1000;
  return 0;
}

interface SellVoucherParams {
  voucherId: string;
  price: number;
}

export const useVoucherInventory = (mikrotikId?: string) => {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: vouchers, isLoading } = useQuery({
    queryKey: ['voucher-inventory', mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      return await apiGet(`/vouchers/inventory?mikrotik_id=${mikrotikId}`);
    },
    enabled: !!mikrotikId,
  });

  const { data: hotspotUsers } = useQuery({
    queryKey: ['hotspot-users-status', mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      try {
        return await hotspotApi.users(mikrotikId);
      } catch {
        return [];
      }
    },
    enabled: !!mikrotikId,
    refetchInterval: 10000,
  });

  const vouchersWithStatus = vouchers?.map((voucher: any) => {
    const mikrotikUser = hotspotUsers?.find((u: any) => u.name === voucher.code);
    if (mikrotikUser) {
      const uptime = mikrotikUser.uptime || '0s';
      const hasBeenUsed = uptime !== '0s' && uptime !== '';
      const uptimeMs = parseUptimeToMs(uptime);
      const validityMs = parseValidityToMs(voucher.validity || '1h');
      const isExpired = validityMs > 0 && uptimeMs >= validityMs;
      
      if (isExpired) return { ...voucher, status: 'expired', uptime: mikrotikUser.uptime, shouldArchive: true };
      if (hasBeenUsed && voucher.status !== 'used') return { ...voucher, status: 'used', uptime: mikrotikUser.uptime };
      return { ...voucher, uptime: mikrotikUser.uptime || null };
    }
    return voucher;
  });

  const archiveExpiredVoucherMutation = useMutation({
    mutationFn: async (voucher: any) => {
      return await apiPost(`/vouchers/${voucher.id}/archive`, {
        mikrotik_id: voucher.mikrotik_id,
        uptime: voucher.uptime,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voucher-inventory'] });
      queryClient.invalidateQueries({ queryKey: ['voucher-sales-history'] });
      queryClient.invalidateQueries({ queryKey: ['hotspot-users-status'] });
    },
  });

  const expiredVouchers = vouchersWithStatus?.filter((v: any) => v.shouldArchive) || [];
  if (expiredVouchers.length > 0 && !archiveExpiredVoucherMutation.isPending) {
    expiredVouchers.forEach((voucher: any) => {
      archiveExpiredVoucherMutation.mutate(voucher);
    });
  }

  const activeVouchers = vouchersWithStatus?.filter((v: any) => !v.shouldArchive);

  const generateVouchersMutation = useMutation({
    mutationFn: async (params: GenerateVouchersParams) => {
      return await vouchersApi.generate(params.mikrotikId, {
        count: params.count,
        profile: params.profile,
        validity: params.validity,
        price: params.price || 0,
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['voucher-inventory'] });
      queryClient.invalidateQueries({ queryKey: ['hotspot-users-status'] });
      const count = Array.isArray(data) ? data.length : data?.count || 0;
      toast.success(`${count} vouchers generados exitosamente`);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al generar vouchers');
    },
  });

  const sellVoucherMutation = useMutation({
    mutationFn: async (params: SellVoucherParams) => {
      return await vouchersApi.sell(mikrotikId!, params.voucherId, { price: params.price });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voucher-inventory'] });
      toast.success('Voucher vendido exitosamente');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al vender voucher');
    },
  });

  const markAsUsedMutation = useMutation({
    mutationFn: async (voucherId: string) => {
      const { apiPut } = await import('@/lib/api-client');
      return await apiPut(`/vouchers/${voucherId}`, { status: 'used' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voucher-inventory'] });
      toast.success('Voucher marcado como usado');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al actualizar voucher');
    },
  });

  const deleteVoucherMutation = useMutation({
    mutationFn: async (voucherId: string) => {
      return await vouchersApi.delete(mikrotikId!, voucherId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voucher-inventory'] });
      queryClient.invalidateQueries({ queryKey: ['hotspot-users-status'] });
      toast.success('Voucher eliminado exitosamente');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al eliminar voucher');
    },
  });

  const syncVouchersMutation = useMutation({
    mutationFn: async (mkId: string) => {
      return await apiPost('/vouchers/sync', { mikrotik_id: mkId });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['voucher-inventory'] });
      queryClient.invalidateQueries({ queryKey: ['hotspot-users-status'] });
      toast.success(`Sincronización completada. ${data?.deleted || 0} eliminados, ${data?.updated || 0} actualizados.`);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al sincronizar vouchers');
    },
  });

  const stats = {
    total: vouchersWithStatus?.length || 0,
    available: vouchersWithStatus?.filter((v: any) => v.status === 'available').length || 0,
    sold: vouchersWithStatus?.filter((v: any) => v.status === 'sold').length || 0,
    used: vouchersWithStatus?.filter((v: any) => v.status === 'used').length || 0,
    expired: vouchersWithStatus?.filter((v: any) => v.status === 'expired').length || 0,
  };

  return {
    vouchers: activeVouchers,
    isLoading,
    stats,
    generateVouchers: generateVouchersMutation.mutate,
    isGenerating: generateVouchersMutation.isPending,
    sellVoucher: sellVoucherMutation.mutate,
    isSelling: sellVoucherMutation.isPending,
    markAsUsed: markAsUsedMutation.mutate,
    deleteVoucher: deleteVoucherMutation.mutate,
    syncVouchers: syncVouchersMutation.mutate,
    isSyncing: syncVouchersMutation.isPending,
  };
};
