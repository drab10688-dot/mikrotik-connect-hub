import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { secretariesApi } from '@/lib/api-client';
import { toast } from 'sonner';
import { useAuth } from './useAuth';

interface AssignSecretaryParams {
  secretaryId: string;
  mikrotikId: string;
  canManagePppoe: boolean;
  canManageQueues: boolean;
  canCreatePppoe?: boolean;
  canEditPppoe?: boolean;
  canDeletePppoe?: boolean;
  canDisconnectPppoe?: boolean;
  canTogglePppoe?: boolean;
  canCreateQueues?: boolean;
  canEditQueues?: boolean;
  canDeleteQueues?: boolean;
  canToggleQueues?: boolean;
  canSuspendQueues?: boolean;
  canReactivateQueues?: boolean;
  // Module permissions
  can_manage_clients?: boolean;
  can_manage_payments?: boolean;
  can_manage_billing?: boolean;
  can_manage_reports?: boolean;
  can_manage_hotspot?: boolean;
  can_manage_address_list?: boolean;
  can_manage_backup?: boolean;
  can_manage_vps_services?: boolean;
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
      return await secretariesApi.assign(params.mikrotikId, {
        secretary_id: params.secretaryId,
        can_manage_pppoe: params.canManagePppoe,
        can_manage_queues: params.canManageQueues,
        can_create_pppoe: params.canCreatePppoe ?? true,
        can_edit_pppoe: params.canEditPppoe ?? true,
        can_delete_pppoe: params.canDeletePppoe ?? true,
        can_disconnect_pppoe: params.canDisconnectPppoe ?? true,
        can_toggle_pppoe: params.canTogglePppoe ?? true,
        can_create_queues: params.canCreateQueues ?? true,
        can_edit_queues: params.canEditQueues ?? true,
        can_delete_queues: params.canDeleteQueues ?? true,
        can_toggle_queues: params.canToggleQueues ?? true,
        can_suspend_queues: params.canSuspendQueues ?? true,
        can_reactivate_queues: params.canReactivateQueues ?? true,
        can_manage_clients: params.can_manage_clients ?? true,
        can_manage_payments: params.can_manage_payments ?? true,
        can_manage_billing: params.can_manage_billing ?? true,
        can_manage_reports: params.can_manage_reports ?? true,
        can_manage_hotspot: params.can_manage_hotspot ?? true,
        can_manage_address_list: params.can_manage_address_list ?? true,
        can_manage_backup: params.can_manage_backup ?? true,
        can_manage_vps_services: params.can_manage_vps_services ?? true,
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
