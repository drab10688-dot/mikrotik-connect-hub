import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from './useAuth';
import { getSelectedDeviceId } from '@/lib/mikrotik';

interface GenerateVouchersParams {
  count: number;
  profile: string;
  mikrotikId: string;
  validity: string;
  price?: number;
}

// Helper to parse uptime string to milliseconds
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

// Helper to parse validity string to milliseconds
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

  // Fetch vouchers
  const { data: vouchers, isLoading } = useQuery({
    queryKey: ['voucher-inventory', mikrotikId],
    queryFn: async () => {
      let query = supabase
        .from('vouchers')
        .select('*')
        .order('created_at', { ascending: false });

      if (mikrotikId) {
        query = query.eq('mikrotik_id', mikrotikId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!mikrotikId,
  });

  // Fetch hotspot users from MikroTik to detect used vouchers
  const { data: hotspotUsers } = useQuery({
    queryKey: ['hotspot-users-status', mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      
      const { data, error } = await supabase.functions.invoke('mikrotik-v6-api', {
        body: {
          mikrotikId,
          command: 'hotspot-users',
        },
      });

      if (error) {
        console.error('Error fetching hotspot users:', error);
        return [];
      }
      
      return data?.data || [];
    },
    enabled: !!mikrotikId,
    refetchInterval: 10000, // Refresh every 10 seconds for more accurate time tracking
  });

  // Compute vouchers with updated status based on MikroTik data
  // Also check for expired vouchers and archive them
  const vouchersWithStatus = vouchers?.map(voucher => {
    // Find the corresponding hotspot user in MikroTik
    const mikrotikUser = hotspotUsers?.find((u: any) => u.name === voucher.code);
    
    if (mikrotikUser) {
      const uptime = mikrotikUser.uptime || '0s';
      const hasBeenUsed = uptime !== '0s' && uptime !== '';
      const uptimeMs = parseUptimeToMs(uptime);
      const validityMs = parseValidityToMs(voucher.validity || '1h');
      
      // Check if voucher has expired (uptime >= validity)
      const isExpired = validityMs > 0 && uptimeMs >= validityMs;
      
      if (isExpired) {
        return { ...voucher, status: 'expired', uptime: mikrotikUser.uptime, shouldArchive: true };
      }
      
      if (hasBeenUsed && voucher.status !== 'used') {
        return { ...voucher, status: 'used', uptime: mikrotikUser.uptime };
      }
      
      return { ...voucher, uptime: mikrotikUser.uptime || null };
    }
    
    return voucher;
  });

  // Archive expired vouchers mutation
  const archiveExpiredVoucherMutation = useMutation({
    mutationFn: async (voucher: any) => {
      // First, save to history
      const { error: historyError } = await supabase
        .from('voucher_sales_history')
        .insert({
          voucher_code: voucher.code,
          voucher_password: voucher.password,
          profile: voucher.profile,
          validity: voucher.validity || '1h',
          price: voucher.price || 0,
          mikrotik_id: voucher.mikrotik_id,
          created_by: voucher.created_by,
          sold_by: voucher.sold_by,
          sold_at: voucher.sold_at,
          activated_at: voucher.activated_at,
          total_uptime: voucher.uptime,
          expired_at: new Date().toISOString(),
        });

      if (historyError) throw historyError;

      // Delete from MikroTik
      try {
        const { data: usersData } = await supabase.functions.invoke('mikrotik-v6-api', {
          body: {
            mikrotikId: voucher.mikrotik_id,
            command: 'hotspot-users',
          },
        });

        if (usersData?.data) {
          const mikrotikUser = usersData.data.find((u: any) => u.name === voucher.code);
          if (mikrotikUser && mikrotikUser['.id']) {
            await supabase.functions.invoke('mikrotik-v6-api', {
              body: {
                mikrotikId: voucher.mikrotik_id,
                command: 'hotspot-user-remove',
                params: { '.id': mikrotikUser['.id'] },
              },
            });
          }
        }
      } catch (error) {
        console.error('Error eliminando de MikroTik:', error);
      }

      // Delete from vouchers table
      const { error: deleteError } = await supabase
        .from('vouchers')
        .delete()
        .eq('id', voucher.id);

      if (deleteError) throw deleteError;

      return voucher;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voucher-inventory'] });
      queryClient.invalidateQueries({ queryKey: ['voucher-sales-history'] });
      queryClient.invalidateQueries({ queryKey: ['hotspot-users-status'] });
    },
  });

  // Auto-archive expired vouchers
  const expiredVouchers = vouchersWithStatus?.filter((v: any) => v.shouldArchive) || [];
  if (expiredVouchers.length > 0 && !archiveExpiredVoucherMutation.isPending) {
    expiredVouchers.forEach((voucher: any) => {
      archiveExpiredVoucherMutation.mutate(voucher);
    });
  }

  // Filter out expired vouchers from the displayed list
  const activeVouchers = vouchersWithStatus?.filter((v: any) => !v.shouldArchive);

  // Generate vouchers mutation
  const generateVouchersMutation = useMutation({
    mutationFn: async (params: GenerateVouchersParams) => {
      const vouchersToCreate = [];
      const mikrotikUsers = [];

      for (let i = 0; i < params.count; i++) {
        const code = Array.from({ length: 8 }, () => 
          'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]
        ).join('');

        const password = Array.from({ length: 8 }, () => 
          'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]
        ).join('');

        vouchersToCreate.push({
          code,
          password,
          profile: params.profile,
          mikrotik_id: params.mikrotikId,
          status: 'available',
          created_by: user?.id,
          expires_at: null,
          price: params.price || 0,
          validity: params.validity,
        });

        mikrotikUsers.push({
          username: code,
          password: password,
          profile: params.profile,
          validity: params.validity,
        });
      }

      // Create users in MikroTik using mikrotikId
      for (const mikrotikUser of mikrotikUsers) {
        try {
          const userParams = {
            name: mikrotikUser.username,
            password: mikrotikUser.password,
            profile: mikrotikUser.profile,
            comment: `Voucher ${new Date().toISOString()}`,
            'limit-uptime': mikrotikUser.validity,
          };

          const { error: mikrotikError } = await supabase.functions.invoke('mikrotik-v6-api', {
            body: {
              mikrotikId: params.mikrotikId,
              command: 'hotspot-user-add',
              params: userParams,
            },
          });

          if (mikrotikError) {
            console.error('Error creando usuario en MikroTik:', mikrotikError);
          }
        } catch (error) {
          console.error('Error al llamar función MikroTik:', error);
        }
      }

      // Save to Supabase
      const { data, error } = await supabase
        .from('vouchers')
        .insert(vouchersToCreate)
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['voucher-inventory'] });
      queryClient.invalidateQueries({ queryKey: ['hotspot-users-status'] });
      toast.success(`${data.length} vouchers generados exitosamente`);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al generar vouchers');
    },
  });

  // Sell voucher mutation
  const sellVoucherMutation = useMutation({
    mutationFn: async (params: SellVoucherParams) => {
      const { error } = await supabase
        .from('vouchers')
        .update({
          status: 'sold',
          sold_by: user?.id,
          sold_at: new Date().toISOString(),
          price: params.price,
        })
        .eq('id', params.voucherId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voucher-inventory'] });
      toast.success('Voucher vendido exitosamente');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al vender voucher');
    },
  });

  // Mark as used mutation
  const markAsUsedMutation = useMutation({
    mutationFn: async (voucherId: string) => {
      const { error } = await supabase
        .from('vouchers')
        .update({ status: 'used' })
        .eq('id', voucherId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voucher-inventory'] });
      toast.success('Voucher marcado como usado');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al actualizar voucher');
    },
  });

  // Delete voucher mutation
  const deleteVoucherMutation = useMutation({
    mutationFn: async (voucherId: string) => {
      // First get the voucher to have the code
      const { data: voucher } = await supabase
        .from('vouchers')
        .select('*')
        .eq('id', voucherId)
        .single();

      if (!voucher) throw new Error('Voucher no encontrado');

      // Delete from MikroTik first
      try {
        // Get users list to find the .id
        const { data: usersData } = await supabase.functions.invoke('mikrotik-v6-api', {
          body: {
            mikrotikId: voucher.mikrotik_id,
            command: 'hotspot-users',
          },
        });

        if (usersData?.data) {
          const mikrotikUser = usersData.data.find((u: any) => u.name === voucher.code);
          if (mikrotikUser && mikrotikUser['.id']) {
            await supabase.functions.invoke('mikrotik-v6-api', {
              body: {
                mikrotikId: voucher.mikrotik_id,
                command: 'hotspot-user-remove',
                params: { '.id': mikrotikUser['.id'] },
              },
            });
          }
        }
      } catch (error) {
        console.error('Error eliminando de MikroTik:', error);
      }

      // Then delete from database
      const { error } = await supabase
        .from('vouchers')
        .delete()
        .eq('id', voucherId);

      if (error) throw error;
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

  // Sync vouchers with MikroTik - delete from MikroTik vouchers not in DB
  const syncVouchersMutation = useMutation({
    mutationFn: async (mikrotikId: string) => {
      // Get users from MikroTik
      const { data: mikrotikData } = await supabase.functions.invoke('mikrotik-v6-api', {
        body: {
          mikrotikId,
          command: 'hotspot-users',
        },
      });

      const mikrotikUsers = mikrotikData?.data || [];

      // Get vouchers from database
      const { data: dbVouchers } = await supabase
        .from('vouchers')
        .select('*')
        .eq('mikrotik_id', mikrotikId);

      const dbVoucherCodes = dbVouchers?.map(v => v.code) || [];

      // Delete from MikroTik users that:
      // 1. Are NOT in the database
      // 2. Have "Voucher" in comment (are vouchers generated by the system)
      const usersToDeleteFromMikrotik = mikrotikUsers.filter(
        (u: any) => !dbVoucherCodes.includes(u.name) && 
                    u.comment && 
                    u.comment.includes('Voucher')
      );
      
      let deletedCount = 0;
      
      for (const user of usersToDeleteFromMikrotik) {
        try {
          await supabase.functions.invoke('mikrotik-v6-api', {
            body: {
              mikrotikId,
              command: 'hotspot-user-remove',
              params: { '.id': user['.id'] },
            },
          });
          deletedCount++;
        } catch (error) {
          console.error(`Error eliminando usuario ${user.name} de MikroTik:`, error);
        }
      }

      // Update vouchers that have been used (uptime > 0)
      const updatedVouchers = [];
      for (const voucher of dbVouchers || []) {
        const mikrotikUser = mikrotikUsers.find((u: any) => u.name === voucher.code);
        if (mikrotikUser) {
          const uptime = mikrotikUser.uptime || '0s';
          const hasBeenUsed = uptime !== '0s' && uptime !== '';
          
          if (hasBeenUsed && voucher.status !== 'used') {
            await supabase
              .from('vouchers')
              .update({ status: 'used' })
              .eq('id', voucher.id);
            updatedVouchers.push(voucher.code);
          }
        }
      }

      return { deleted: deletedCount, updated: updatedVouchers.length };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['voucher-inventory'] });
      queryClient.invalidateQueries({ queryKey: ['hotspot-users-status'] });
      toast.success(`Sincronización completada. ${data.deleted} usuarios eliminados, ${data.updated} vouchers actualizados.`);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al sincronizar vouchers');
    },
  });

  // Stats based on vouchers with updated status
  const stats = {
    total: vouchersWithStatus?.length || 0,
    available: vouchersWithStatus?.filter(v => v.status === 'available').length || 0,
    sold: vouchersWithStatus?.filter(v => v.status === 'sold').length || 0,
    used: vouchersWithStatus?.filter(v => v.status === 'used').length || 0,
    expired: vouchersWithStatus?.filter(v => v.status === 'expired').length || 0,
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
