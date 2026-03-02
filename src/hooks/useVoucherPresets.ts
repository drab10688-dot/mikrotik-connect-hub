import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vouchersApi, hotspotApi } from '@/lib/api-client';
import { toast } from 'sonner';
import { useAuth } from './useAuth';

interface VoucherPreset {
  id: string;
  name: string;
  validity: string;
  price: number;
  description: string | null;
  mikrotik_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface CreatePresetParams {
  name: string;
  validity: string;
  price: number;
  description?: string;
  mikrotikId: string;
}

export const useVoucherPresets = (mikrotikId?: string) => {
  const queryClient = useQueryClient();

  const { data: presets, isLoading } = useQuery({
    queryKey: ['voucher-presets', mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      return await vouchersApi.presets(mikrotikId) as VoucherPreset[];
    },
    enabled: !!mikrotikId,
  });

  const createPresetMutation = useMutation({
    mutationFn: async (params: CreatePresetParams) => {
      // Create hotspot profile in MikroTik via VPS API
      try {
        await hotspotApi.addProfile(params.mikrotikId, {
          name: params.name,
          'shared-users': '1',
          'rate-limit': params.description || '',
        });
      } catch (error) {
        console.error('Error al crear perfil en MikroTik:', error);
      }

      // Create preset in database
      return await vouchersApi.createPreset({
        name: params.name,
        validity: params.validity,
        price: params.price,
        description: params.description || null,
        mikrotik_id: params.mikrotikId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voucher-presets'] });
      toast.success('Preset y perfil MikroTik creados exitosamente');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al crear preset');
    },
  });

  const updatePresetMutation = useMutation({
    mutationFn: async (params: { id: string } & Partial<CreatePresetParams>) => {
      const { id, ...updates } = params;
      return await vouchersApi.updatePreset(id, {
        ...(updates.name && { name: updates.name }),
        ...(updates.validity && { validity: updates.validity }),
        ...(updates.price !== undefined && { price: updates.price }),
        ...(updates.description !== undefined && { description: updates.description }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voucher-presets'] });
      toast.success('Preset actualizado exitosamente');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al actualizar preset');
    },
  });

  const deletePresetMutation = useMutation({
    mutationFn: async (presetId: string) => {
      return await vouchersApi.deletePreset(presetId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voucher-presets'] });
      toast.success('Preset eliminado exitosamente');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al eliminar preset');
    },
  });

  return {
    presets,
    isLoading,
    createPreset: createPresetMutation.mutate,
    isCreating: createPresetMutation.isPending,
    updatePreset: updatePresetMutation.mutate,
    isUpdating: updatePresetMutation.isPending,
    deletePreset: deletePresetMutation.mutate,
    isDeleting: deletePresetMutation.isPending,
  };
};
