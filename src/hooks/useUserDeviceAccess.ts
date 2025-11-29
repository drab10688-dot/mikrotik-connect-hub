import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export const useUserDeviceAccess = () => {
  const { user, isSuperAdmin, isAdmin, isSecretary } = useAuth();

  const { data: devices, isLoading } = useQuery({
    queryKey: ['user-device-access', user?.id],
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
        // Secretaries see their assigned devices
        const { data, error } = await supabase
          .from('secretary_assignments')
          .select(`
            mikrotik_devices (*)
          `)
          .eq('secretary_id', user?.id)
          .eq('mikrotik_devices.status', 'active');

        if (error) throw error;
        return data.map((assignment: any) => assignment.mikrotik_devices).filter(Boolean);
      } else if (isAdmin) {
        // Regular admins only see assigned active devices
        const { data, error } = await supabase
          .from('user_mikrotik_access')
          .select('mikrotik_devices(*)')
          .eq('user_id', user?.id)
          .eq('mikrotik_devices.status', 'active');

        if (error) throw error;
        return data.map((access: any) => access.mikrotik_devices).filter(Boolean);
      } else {
        // Regular users see their own devices (both active and pending)
        const { data, error } = await supabase
          .from('mikrotik_devices')
          .select('*')
          .eq('created_by', user?.id)
          .order('name');

        if (error) throw error;
        return data;
      }
    },
    enabled: !!user,
  });

  const hasDeviceAccess = (devices && devices.length > 0) || isSuperAdmin;

  return {
    devices: devices || [],
    hasDeviceAccess,
    isLoading,
  };
};
