import { useQuery } from '@tanstack/react-query';
import { secretariesApi } from '@/lib/api-client';
import { useAuth } from './useAuth';

export const useSecretaryPermissions = () => {
  const { user, isSecretary } = useAuth();

  const { data: assignments, isLoading } = useQuery({
    queryKey: ['my-secretary-assignments', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      return await secretariesApi.myAssignments();
    },
    enabled: !!user?.id && isSecretary,
  });

  const getPermissionsForDevice = (mikrotikId: string) => {
    const assignment = assignments?.find((a: any) => a.mikrotik_id === mikrotikId);
    return assignment || null;
  };

  const hasAnyAccess = assignments && assignments.length > 0;
  const assignedDeviceIds = assignments?.map((a: any) => a.mikrotik_id) || [];
  const assignedDevices = assignments?.map((a: any) => a.mikrotik_devices || a.device).filter(Boolean) || [];

  return {
    assignments,
    isLoading,
    hasAnyAccess,
    assignedDeviceIds,
    assignedDevices,
    getPermissionsForDevice,
  };
};
