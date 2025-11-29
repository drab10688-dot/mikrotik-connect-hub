import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export const useSecretaryPermissions = () => {
  const { user, isSecretary } = useAuth();

  // Get secretary assignments with device details
  const { data: assignments, isLoading } = useQuery({
    queryKey: ['my-secretary-assignments', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      
      const { data, error } = await supabase
        .from('secretary_assignments')
        .select(`
          *,
          mikrotik_devices:mikrotik_id (
            id,
            name,
            host,
            port,
            username,
            password,
            version,
            status
          )
        `)
        .eq('secretary_id', user.id);

      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id && isSecretary,
  });

  // Get permissions for a specific mikrotik device
  const getPermissionsForDevice = (mikrotikId: string) => {
    const assignment = assignments?.find(a => a.mikrotik_id === mikrotikId);
    return assignment || null;
  };

  // Check if has any permission for any device
  const hasAnyAccess = assignments && assignments.length > 0;

  // Get all assigned mikrotik IDs
  const assignedDeviceIds = assignments?.map(a => a.mikrotik_id) || [];

  // Get all assigned devices with full details
  const assignedDevices = assignments?.map(a => a.mikrotik_devices).filter(Boolean) || [];

  return {
    assignments,
    isLoading,
    hasAnyAccess,
    assignedDeviceIds,
    assignedDevices,
    getPermissionsForDevice,
  };
};
