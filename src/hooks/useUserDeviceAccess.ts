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
          .map((a: any) => {
            // Handle nested device object or flat fields
            if (a.mikrotik_devices && typeof a.mikrotik_devices === 'object') {
              return a.mikrotik_devices;
            }
            // Fallback: build device from flat fields
            return {
              id: a.mikrotik_id || a.device_id,
              name: a.device_name || a.name,
              host: a.host,
              port: a.port || 8728,
              version: a.version || 'v7',
              status: a.device_status || 'active',
            };
          })
          .filter((d: any) => d && d.id && d.status === 'active');
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
