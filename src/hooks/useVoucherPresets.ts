import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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

  // Fetch presets
  const { data: presets, isLoading } = useQuery({
    queryKey: ['voucher-presets', mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      
      const { data, error } = await supabase
        .from('voucher_presets')
        .select('*')
        .eq('mikrotik_id', mikrotikId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as VoucherPreset[];
    },
    enabled: !!mikrotikId,
  });

  // Create preset
  const createPresetMutation = useMutation({
    mutationFn: async (params: CreatePresetParams) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuario no autenticado');

      const { data, error } = await supabase
        .from('voucher_presets')
        .insert({
          name: params.name,
          validity: params.validity,
          price: params.price,
          description: params.description || null,
          mikrotik_id: params.mikrotikId,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voucher-presets'] });
      toast.success('Preset creado exitosamente');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al crear preset');
    },
  });

  // Update preset
  const updatePresetMutation = useMutation({
    mutationFn: async (params: { id: string } & Partial<CreatePresetParams>) => {
      const { id, ...updates } = params;
      const { error } = await supabase
        .from('voucher_presets')
        .update({
          ...(updates.name && { name: updates.name }),
          ...(updates.validity && { validity: updates.validity }),
          ...(updates.price !== undefined && { price: updates.price }),
          ...(updates.description !== undefined && { description: updates.description }),
        })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voucher-presets'] });
      toast.success('Preset actualizado exitosamente');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al actualizar preset');
    },
  });

  // Delete preset
  const deletePresetMutation = useMutation({
    mutationFn: async (presetId: string) => {
      const { error } = await supabase
        .from('voucher_presets')
        .delete()
        .eq('id', presetId);

      if (error) throw error;
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
