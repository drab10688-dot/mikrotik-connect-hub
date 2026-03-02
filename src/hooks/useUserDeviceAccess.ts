import { useQuery } from "@tanstack/react-query";
import { devicesApi, secretariesApi } from "@/lib/api-client";
import { useAuth } from "./useAuth";

export const useUserDeviceAccess = () => {
  const { user, isSuperAdmin, isAdmin, isSecretary, loading: authLoading } = useAuth();

  const { data: devices, isLoading } = useQuery({
    queryKey: ['user-device-access', user?.id, isSecretary, isAdmin, isSuperAdmin],
    queryFn: async () => {
      if (!user) return [];

      if (isSuperAdmin || isAdmin) {
        // Admins and super admins see their devices from the API
        return await devicesApi.list();
      } else if (isSecretary) {
        // Secretaries see assigned devices
        const assignments = await secretariesApi.myAssignments();
        return assignments
          .map((a: any) => a.mikrotik_devices || a.device)
          .filter((d: any) => d && d.status === 'active');
      } else {
        // Regular users see their own devices
        return await devicesApi.list();
      }
    },
    enabled: !!user && !authLoading,
  });

  const hasDeviceAccess = (devices && devices.length > 0) || isSuperAdmin;

  return {
    devices: devices || [],
    hasDeviceAccess,
    isLoading: isLoading || authLoading,
  };
};
