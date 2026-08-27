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
        // The API expands a global assistant assignment to every active
        // device owned by the assigning administrator.
        return await devicesApi.list();
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
    isLoading: isLoading || authLoading,
  };
};
