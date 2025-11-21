import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Badge } from '@/components/ui/badge';

export const PendingDevicesBadge = () => {
  const { user, isSuperAdmin } = useAuth();

  const { data: pendingCount } = useQuery({
    queryKey: ['mikrotik-devices-pending-count', user?.id],
    queryFn: async () => {
      if (!isSuperAdmin) return 0;
      
      const { count, error } = await supabase
        .from('mikrotik_devices')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      if (error) throw error;
      return count || 0;
    },
    enabled: !!user && isSuperAdmin,
    refetchInterval: 10000, // Refetch every 10 seconds as backup
  });

  if (!isSuperAdmin || !pendingCount || pendingCount === 0) {
    return null;
  }

  return (
    <Badge variant="destructive" className="ml-auto">
      {pendingCount}
    </Badge>
  );
};
