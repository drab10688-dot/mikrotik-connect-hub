import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { secretariesApi } from '@/lib/api-client';
import { toast } from 'sonner';
import { useAuth } from './useAuth';

interface AssignSecretaryParams {
  secretaryId: string;
  mikrotikId: string;
  [key: string]: any; // All permission keys are dynamic
}

export const useSecretaries = (mikrotikId?: string) => {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: assignments, isLoading } = useQuery({
    queryKey: ['secretary-assignments', mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      return await secretariesApi.assignments(mikrotikId);
    },
    enabled: !!mikrotikId,
  });

  const assignSecretaryMutation = useMutation({
    mutationFn: async (params: AssignSecretaryParams) => {
      const { secretaryId, mikrotikId, ...permData } = params;
      return await secretariesApi.assign(mikrotikId, {
        secretary_id: secretaryId,
        ...permData,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['secretary-assignments'] });
      toast.success('Secretaria asignada exitosamente');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al asignar secretaria');
    },
  });

  const removeSecretaryMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      return await secretariesApi.remove(assignmentId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['secretary-assignments'] });
      toast.success('Secretaria removida exitosamente');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al remover secretaria');
    },
  });

  const updateSecretaryMutation = useMutation({
    mutationFn: async (params: { assignmentId: string; [key: string]: any }) => {
      const { assignmentId, ...updateData } = params;
      return await secretariesApi.update(assignmentId, updateData);
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
