import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from './useAuth';

interface GenerateVouchersParams {
  count: number;
  profile: string;
  mikrotikId: string;
  validity: string;
  price?: number;
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

  // Generate vouchers mutation
  const generateVouchersMutation = useMutation({
    mutationFn: async (params: GenerateVouchersParams) => {
      const vouchersToCreate = [];

      for (let i = 0; i < params.count; i++) {
        // Generate unique code (8 chars uppercase + numbers)
        const code = Array.from({ length: 8 }, () => 
          'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]
        ).join('');

        // Generate password (8 chars)
        const password = Array.from({ length: 8 }, () => 
          'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]
        ).join('');

        // Calculate expiration based on validity
        let expiresAt = new Date();
        const validityMatch = params.validity.match(/(\d+)([hdw])/);
        if (validityMatch) {
          const [, amount, unit] = validityMatch;
          const hours = unit === 'h' ? parseInt(amount) :
                       unit === 'd' ? parseInt(amount) * 24 :
                       parseInt(amount) * 24 * 7;
          expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
        }

        vouchersToCreate.push({
          code,
          password,
          profile: params.profile,
          mikrotik_id: params.mikrotikId,
          status: 'available',
          created_by: user?.id,
          expires_at: expiresAt.toISOString(),
          price: params.price || 0,
        });
      }

      const { data, error } = await supabase
        .from('vouchers')
        .insert(vouchersToCreate)
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['voucher-inventory'] });
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
      const { error } = await supabase
        .from('vouchers')
        .delete()
        .eq('id', voucherId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voucher-inventory'] });
      toast.success('Voucher eliminado exitosamente');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al eliminar voucher');
    },
  });

  // Stats
  const stats = {
    total: vouchers?.length || 0,
    available: vouchers?.filter(v => v.status === 'available').length || 0,
    sold: vouchers?.filter(v => v.status === 'sold').length || 0,
    used: vouchers?.filter(v => v.status === 'used').length || 0,
    expired: vouchers?.filter(v => v.status === 'expired').length || 0,
  };

  return {
    vouchers,
    isLoading,
    stats,
    generateVouchers: generateVouchersMutation.mutate,
    isGenerating: generateVouchersMutation.isPending,
    sellVoucher: sellVoucherMutation.mutate,
    isSelling: sellVoucherMutation.isPending,
    markAsUsed: markAsUsedMutation.mutate,
    deleteVoucher: deleteVoucherMutation.mutate,
  };
};
