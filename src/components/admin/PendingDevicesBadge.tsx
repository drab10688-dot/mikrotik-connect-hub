import { useQuery } from '@tanstack/react-query';
import { devicesApi } from '@/lib/api-client';
import { useAuth } from '@/hooks/useAuth';
import { Badge } from '@/components/ui/badge';

export const PendingDevicesBadge = () => {
  const { user, isSuperAdmin } = useAuth();

  const { data: pendingCount } = useQuery({
    queryKey: ['mikrotik-devices-pending-count', user?.id],
    queryFn: async () => {
      if (!isSuperAdmin) return 0;
      const devices = await devicesApi.list();
      return devices.filter((d: any) => d.status === 'pending').length;
    },
    enabled: !!user && isSuperAdmin,
    refetchInterval: 10000,
  });

  if (!isSuperAdmin || !pendingCount || pendingCount === 0) return null;

  return <Badge variant="destructive" className="ml-auto">{pendingCount}</Badge>;
};
