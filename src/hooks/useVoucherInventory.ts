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
      // Obtener credenciales del MikroTik
      const { data: mikrotikDevice, error: deviceError } = await supabase
        .from('mikrotik_devices')
        .select('*')
        .eq('id', params.mikrotikId)
        .single();

      if (deviceError) throw deviceError;

      const vouchersToCreate = [];
      const mikrotikUsers = [];

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

        mikrotikUsers.push({
          username: code,
          password: password,
          profile: params.profile,
          validity: params.validity,
        });
      }

      // Crear usuarios en MikroTik usando la función edge
      const functionName = mikrotikDevice.version === 'v7' ? 'mikrotik-hotspot-users' : 'mikrotik-v6-api';
      
      for (const user of mikrotikUsers) {
        try {
          const userParams = {
            name: user.username,
            password: user.password,
            profile: user.profile,
            comment: `Voucher ${new Date().toISOString()}`,
            'limit-uptime': user.validity, // Configurar límite de tiempo en MikroTik
          };

          const { error: mikrotikError } = await supabase.functions.invoke(functionName, {
            body: {
              host: mikrotikDevice.host,
              username: mikrotikDevice.username,
              password: mikrotikDevice.password,
              port: mikrotikDevice.port,
              command: mikrotikDevice.version === 'v7' ? undefined : 'hotspot-user-add',
              action: mikrotikDevice.version === 'v7' ? 'add' : undefined,
              params: mikrotikDevice.version === 'v6' ? userParams : undefined,
              userData: mikrotikDevice.version === 'v7' ? userParams : undefined,
            },
          });

          if (mikrotikError) {
            console.error('Error creando usuario en MikroTik:', mikrotikError);
          }
        } catch (error) {
          console.error('Error al llamar función MikroTik:', error);
        }
      }

      // Guardar en Supabase
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
      // Primero obtener el voucher para tener el código
      const { data: voucher } = await supabase
        .from('vouchers')
        .select('*, mikrotik:mikrotik_devices(*)')
        .eq('id', voucherId)
        .single();

      if (!voucher) throw new Error('Voucher no encontrado');

      // Eliminar del MikroTik primero
      const mikrotikDevice = voucher.mikrotik;
      if (mikrotikDevice) {
        const functionName = mikrotikDevice.version === 'v7' ? 'mikrotik-hotspot-users' : 'mikrotik-v6-api';
        
        try {
          const deleteBody = {
            host: mikrotikDevice.host,
            username: mikrotikDevice.username,
            password: mikrotikDevice.password,
            port: mikrotikDevice.port,
          };

          if (mikrotikDevice.version === 'v7') {
            Object.assign(deleteBody, {
              action: 'remove',
              voucherUsername: voucher.code,
            });
          } else {
            Object.assign(deleteBody, {
              command: 'hotspot-user-remove',
              params: { name: voucher.code },
            });
          }

          await supabase.functions.invoke(functionName, { body: deleteBody });
        } catch (error) {
          console.error('Error eliminando de MikroTik:', error);
        }
      }

      // Luego eliminar de la base de datos
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

  // Sync vouchers with MikroTik mutation
  const syncVouchersMutation = useMutation({
    mutationFn: async (mikrotikId: string) => {
      const { data: mikrotikDevice } = await supabase
        .from('mikrotik_devices')
        .select('*')
        .eq('id', mikrotikId)
        .single();

      if (!mikrotikDevice) throw new Error('Dispositivo no encontrado');

      const functionName = mikrotikDevice.version === 'v7' ? 'mikrotik-hotspot-users' : 'mikrotik-v6-api';
      
      // Obtener usuarios de MikroTik
      const { data: mikrotikData } = await supabase.functions.invoke(functionName, {
        body: {
          host: mikrotikDevice.host,
          username: mikrotikDevice.username,
          password: mikrotikDevice.password,
          port: mikrotikDevice.port,
          command: mikrotikDevice.version === 'v7' ? undefined : 'hotspot-users',
          action: mikrotikDevice.version === 'v7' ? 'list' : undefined,
        },
      });

      const mikrotikUsers = mikrotikData?.data || [];
      const mikrotikUsernames = mikrotikUsers.map((u: any) => u.name);

      // Obtener vouchers de la base de datos
      const { data: dbVouchers } = await supabase
        .from('vouchers')
        .select('*')
        .eq('mikrotik_id', mikrotikId);

      // Eliminar vouchers que no existen en MikroTik
      const vouchersToDelete = dbVouchers?.filter(v => !mikrotikUsernames.includes(v.code)) || [];
      
      if (vouchersToDelete.length > 0) {
        await supabase
          .from('vouchers')
          .delete()
          .in('id', vouchersToDelete.map(v => v.id));
      }

      return { deleted: vouchersToDelete.length };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['voucher-inventory'] });
      toast.success(`Sincronización completada. ${data.deleted} vouchers eliminados.`);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al sincronizar vouchers');
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
    syncVouchers: syncVouchersMutation.mutate,
    isSyncing: syncVouchersMutation.isPending,
  };
};
