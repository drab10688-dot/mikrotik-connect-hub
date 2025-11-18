import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export const useUserMikrotikAccess = () => {
  const queryClient = useQueryClient();

  const { data: adminUsers, isLoading: loadingUsers } = useQuery({
    queryKey: ['admin-users-list'],
    queryFn: async () => {
      const { data: profiles, error } = await supabase
        .from('profiles')
        .select('*, user_roles!inner(role)')
        .eq('user_roles.role', 'admin')
        .order('full_name');

      if (error) throw error;
      return profiles;
    },
  });

  const { data: devices, isLoading: loadingDevices } = useQuery({
    queryKey: ['mikrotik-devices-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mikrotik_devices')
        .select('*')
        .order('name');

      if (error) throw error;
      return data;
    },
  });

  const { data: accesses, isLoading: loadingAccesses } = useQuery({
    queryKey: ['user-mikrotik-accesses'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_mikrotik_access')
        .select('*, profiles(full_name, email), mikrotik_devices(name)');

      if (error) throw error;
      return data;
    },
  });

  const grantAccessMutation = useMutation({
    mutationFn: async ({ userId, deviceId, grantedBy }: { userId: string; deviceId: string; grantedBy: string }) => {
      const { error } = await supabase
        .from('user_mikrotik_access')
        .insert({
          user_id: userId,
          mikrotik_id: deviceId,
          granted_by: grantedBy,
        });

      if (error) throw error;
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
      const { error } = await supabase
        .from('user_mikrotik_access')
        .delete()
        .eq('id', accessId);

      if (error) throw error;
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
    return accesses?.filter(access => access.user_id === userId) || [];
  };

  const getUsersByDevice = (deviceId: string) => {
    return accesses?.filter(access => access.mikrotik_id === deviceId) || [];
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
