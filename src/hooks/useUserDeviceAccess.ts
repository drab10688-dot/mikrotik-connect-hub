import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export const useUserDeviceAccess = () => {
  const { user, isSuperAdmin, isAdmin, isSecretary, loading: authLoading } = useAuth();

  const { data: devices, isLoading } = useQuery({
    queryKey: ['user-device-access', user?.id, isSecretary, isAdmin, isSuperAdmin],
    queryFn: async () => {
      if (!user) return [];

      if (isSuperAdmin) {
        // Super admins see all devices
        const { data, error } = await supabase
          .from('mikrotik_devices')
          .select('*')
          .order('name');

        if (error) throw error;
        return data;
      } else if (isSecretary) {
        // Secretaries see their assigned devices - fetch and filter client-side
        const { data, error } = await supabase
          .from('secretary_assignments')
          .select(`
            mikrotik_devices (*)
          `)
          .eq('secretary_id', user.id);

        if (error) throw error;
        // Filter to only active devices client-side
        return data
          .map((assignment: any) => assignment.mikrotik_devices)
          .filter((device: any) => device && device.status === 'active');
      } else if (isAdmin) {
        // Regular admins only see assigned active devices
        const { data, error } = await supabase
          .from('user_mikrotik_access')
          .select('mikrotik_devices(*)')
          .eq('user_id', user.id);

        if (error) throw error;
        return data
          .map((access: any) => access.mikrotik_devices)
          .filter((device: any) => device && device.status === 'active');
      } else {
        // Regular users see their own devices (both active and pending)
        const { data, error } = await supabase
          .from('mikrotik_devices')
          .select('*')
          .eq('created_by', user.id)
          .order('name');

        if (error) throw error;
        return data;
      }
    },
    enabled: !!user && !authLoading,
  });

  // Check if user has device access - secretaries need at least one assigned device
  const hasDeviceAccess = (devices && devices.length > 0) || isSuperAdmin;

  return {
    devices: devices || [],
    hasDeviceAccess,
    isLoading: isLoading || authLoading,
  };
};
