import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from './useAuth';

interface AssignSecretaryParams {
  secretaryId: string;
  mikrotikId: string;
  canManagePppoe: boolean;
  canManageQueues: boolean;
}

export const useSecretaries = (mikrotikId?: string) => {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Fetch secretary assignments
  const { data: assignments, isLoading } = useQuery({
    queryKey: ['secretary-assignments', mikrotikId],
    queryFn: async () => {
      let query = supabase
        .from('secretary_assignments')
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

  // Assign secretary mutation
  const assignSecretaryMutation = useMutation({
    mutationFn: async (params: AssignSecretaryParams) => {
      const { error } = await supabase
        .from('secretary_assignments')
        .insert({
          secretary_id: params.secretaryId,
          mikrotik_id: params.mikrotikId,
          assigned_by: user?.id,
          can_manage_pppoe: params.canManagePppoe,
          can_manage_queues: params.canManageQueues,
        });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['secretary-assignments'] });
      toast.success('Secretaria asignada exitosamente');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al asignar secretaria');
    },
  });

  // Remove secretary mutation
  const removeSecretaryMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      const { error } = await supabase
        .from('secretary_assignments')
        .delete()
        .eq('id', assignmentId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['secretary-assignments'] });
      toast.success('Secretaria removida exitosamente');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al remover secretaria');
    },
  });

  // Update secretary permissions mutation
  const updateSecretaryMutation = useMutation({
    mutationFn: async ({ assignmentId, canManagePppoe, canManageQueues }: { 
      assignmentId: string;
      canManagePppoe: boolean;
      canManageQueues: boolean;
    }) => {
      const { error } = await supabase
        .from('secretary_assignments')
        .update({
          can_manage_pppoe: canManagePppoe,
          can_manage_queues: canManageQueues,
        })
        .eq('id', assignmentId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['secretary-assignments'] });
      toast.success('Permisos actualizados exitosamente');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al actualizar permisos');
    },
  });

  return {
    assignments,
    isLoading,
    assignSecretary: assignSecretaryMutation.mutate,
    isAssigning: assignSecretaryMutation.isPending,
    removeSecretary: removeSecretaryMutation.mutate,
    isRemoving: removeSecretaryMutation.isPending,
    updateSecretary: updateSecretaryMutation.mutate,
    isUpdating: updateSecretaryMutation.isPending,
  };
};
