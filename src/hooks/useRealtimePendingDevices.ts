import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from './useAuth';
import { devicesApi } from '@/lib/api-client';

/**
 * Polls for pending devices instead of using Supabase Realtime.
 * Checks every 30 seconds for new pending devices.
 */
export const useRealtimePendingDevices = () => {
  const queryClient = useQueryClient();
  const { isSuperAdmin } = useAuth();

  useEffect(() => {
    if (!isSuperAdmin) return;

    let previousPendingCount = -1;

    const checkPendingDevices = async () => {
      try {
        const devices = await devicesApi.list();
        const pendingDevices = devices?.filter((d: any) => d.status === 'pending') || [];
        const currentCount = pendingDevices.length;

        if (previousPendingCount >= 0 && currentCount > previousPendingCount) {
          const newDevice = pendingDevices[0];
          toast.info('Nuevo dispositivo pendiente', {
            description: `Se ha agregado "${newDevice?.name || 'dispositivo'}"`,
            duration: 10000,
            action: {
              label: 'Ver',
              onClick: () => {
                window.location.href = '/admin/mikrotik-devices';
              }
            }
          });

          queryClient.invalidateQueries({ queryKey: ['mikrotik-devices'] });
          queryClient.invalidateQueries({ queryKey: ['mikrotik-devices-pending'] });
          queryClient.invalidateQueries({ queryKey: ['mikrotik-devices-pending-count'] });
        }

        previousPendingCount = currentCount;
      } catch (error) {
        console.error('Error checking pending devices:', error);
      }
    };

    // Initial check
    checkPendingDevices();

    // Poll every 30 seconds
    const interval = setInterval(checkPendingDevices, 30000);

    return () => clearInterval(interval);
  }, [isSuperAdmin, queryClient]);
};
