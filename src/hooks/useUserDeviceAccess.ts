import { useQuery } from "@tanstack/react-query";
import { devicesApi, secretariesApi } from "@/lib/api-client";
import { useAuth } from "./useAuth";

export const useUserDeviceAccess = () => {
  const { user, isSuperAdmin, isAdmin, isSecretary, loading: authLoading } = useAuth();

  const { data: devices, isLoading, isError } = useQuery({
    retry: false,
    queryKey: ['user-device-access', user?.id, isSecretary, isAdmin, isSuperAdmin],
    queryFn: async () => {
      if (!user) return [];

      if (isSuperAdmin || isAdmin) {
        // Admins and super admins see their devices from the API
        return await devicesApi.list();
      } else if (isSecretary) {
        // Assistants use their explicit assignments. Global assignments do
        // not fabricate a MikroTik selection for modules that do not need it.
        const assignments = await secretariesApi.myAssignments();
        return assignments
          .map((assignment: any) => {
            if (assignment.mikrotik_devices && typeof assignment.mikrotik_devices === 'object') {
              return assignment.mikrotik_devices;
            }

            if (!assignment.mikrotik_id && !assignment.device_id) return null;

            return {
              id: assignment.mikrotik_id || assignment.device_id,
              name: assignment.device_name || assignment.name,
              host: assignment.host,
              port: assignment.port || 8728,
              version: assignment.version || 'v7',
              status: assignment.device_status || 'active',
            };
          })
          .filter((device: any) => device?.id && device.status === 'active');
      } else {
        // Regular users see their own devices
        return await devicesApi.list();
      }
    },
    enabled: !!user && !authLoading,
  });

  // An assistant may manage modules that do not require a MikroTik.
  const hasDeviceAccess = isSecretary || (devices && devices.length > 0) || isSuperAdmin;

  return {
    devices: devices || [],
    hasDeviceAccess,
    isError,
    isLoading: isLoading || authLoading,
  };
};
