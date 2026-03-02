import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { devicesApi } from '@/lib/api-client';
import { toast } from 'sonner';

export const useUserMikrotikAccess = () => {
  const queryClient = useQueryClient();

  const { data: adminUsers, isLoading: loadingUsers } = useQuery({
    queryKey: ['admin-users-list'],
    queryFn: async () => {
      const users = await import('@/lib/api-client').then(m => m.usersApi.list());
      return users.filter((u: any) => u.role === 'admin');
    },
  });

  const { data: devices, isLoading: loadingDevices } = useQuery({
    queryKey: ['mikrotik-devices-all'],
    queryFn: () => devicesApi.list(),
  });

  const { data: accesses, isLoading: loadingAccesses } = useQuery({
    queryKey: ['user-mikrotik-accesses'],
    queryFn: async () => {
      const { apiGet } = await import('@/lib/api-client');
      return await apiGet('/devices/accesses');
    },
  });

  const grantAccessMutation = useMutation({
    mutationFn: async ({ userId, deviceId, grantedBy }: { userId: string; deviceId: string; grantedBy: string }) => {
      const { apiPost } = await import('@/lib/api-client');
      return await apiPost('/devices/accesses', { user_id: userId, mikrotik_id: deviceId, granted_by: grantedBy });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-mikrotik-accesses'] });
      toast.success('Acceso concedido exitosamente');
    },
    onError: (error: any) => {
      if (error.message?.includes('duplicate')) {
        toast.error('El usuario ya tiene acceso a este dispositivo');
      } else {
        toast.error(error.message || 'Error al conceder acceso');
      }
    },
  });

  const revokeAccessMutation = useMutation({
    mutationFn: async (accessId: string) => {
      const { apiDelete } = await import('@/lib/api-client');
      return await apiDelete(`/devices/accesses/${accessId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-mikrotik-accesses'] });
      toast.success('Acceso revocado exitosamente');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al revocar acceso');
    },
  });

  const getDevicesByUser = (userId: string) => {
    return accesses?.filter((access: any) => access.user_id === userId) || [];
  };

  const getUsersByDevice = (deviceId: string) => {
    return accesses?.filter((access: any) => access.mikrotik_id === deviceId) || [];
  };

  return {
    adminUsers,
    devices,
    accesses,
    isLoading: loadingUsers || loadingDevices || loadingAccesses,
    grantAccess: grantAccessMutation.mutate,
    revokeAccess: revokeAccessMutation.mutate,
    getDevicesByUser,
    getUsersByDevice,
    isGranting: grantAccessMutation.isPending,
    isRevoking: revokeAccessMutation.isPending,
  };
};
