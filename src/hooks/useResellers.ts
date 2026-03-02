import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resellersApi, authApi } from '@/lib/api-client';
import { toast } from 'sonner';

interface CreateResellerParams {
  email: string;
  password: string;
  fullName: string;
  mikrotikId: string;
  commissionPercentage?: number;
}

export const useResellers = (mikrotikId?: string) => {
  const queryClient = useQueryClient();

  const { data: assignments, isLoading } = useQuery({
    queryKey: ['reseller-assignments', mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      return await resellersApi.assignments(mikrotikId);
    },
    enabled: !!mikrotikId,
  });

  const createResellerMutation = useMutation({
    mutationFn: async (params: CreateResellerParams) => {
      return await resellersApi.assign(params.mikrotikId, {
        email: params.email,
        password: params.password,
        full_name: params.fullName,
        commission_percentage: params.commissionPercentage || 0,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reseller-assignments'] });
      toast.success('Reseller creado exitosamente');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al crear reseller');
    },
  });

  const updateCommissionMutation = useMutation({
    mutationFn: async (params: { assignmentId: string; commission: number }) => {
      return await resellersApi.updateCommission(params.assignmentId, params.commission);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reseller-assignments'] });
      toast.success('Comisión actualizada');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al actualizar comisión');
    },
  });

  const removeAssignmentMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      return await resellersApi.remove(assignmentId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reseller-assignments'] });
      toast.success('Asignación eliminada');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al eliminar asignación');
    },
  });

  return {
    assignments,
    isLoading,
    createReseller: createResellerMutation.mutate,
    isCreating: createResellerMutation.isPending,
    updateCommission: updateCommissionMutation.mutate,
    isUpdating: updateCommissionMutation.isPending,
    removeAssignment: removeAssignmentMutation.mutate,
    isRemoving: removeAssignmentMutation.isPending,
  };
};
