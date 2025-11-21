import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from './useAuth';

export const useRealtimePendingDevices = () => {
  const queryClient = useQueryClient();
  const { isSuperAdmin } = useAuth();

  useEffect(() => {
    if (!isSuperAdmin) return;

    console.log('Setting up realtime subscription for pending devices...');

    const channel = supabase
      .channel('mikrotik-devices-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'mikrotik_devices',
          filter: 'status=eq.pending'
        },
        async (payload) => {
          console.log('New pending device detected:', payload);

          // Fetch the user profile for the device creator
          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, email')
            .eq('user_id', payload.new.created_by)
            .single();

          const deviceName = payload.new.name;
          const userName = profile?.full_name || profile?.email || 'Usuario desconocido';

          // Show toast notification
          toast.info('Nuevo dispositivo pendiente', {
            description: `${userName} ha agregado "${deviceName}"`,
            duration: 10000,
            action: {
              label: 'Ver',
              onClick: () => {
                window.location.href = '/admin/mikrotik-devices';
              }
            }
          });

          // Invalidate queries to refresh the data
          queryClient.invalidateQueries({ queryKey: ['mikrotik-devices'] });
          queryClient.invalidateQueries({ queryKey: ['mikrotik-devices-pending'] });
          queryClient.invalidateQueries({ queryKey: ['mikrotik-devices-pending-count'] });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'mikrotik_devices'
        },
        (payload) => {
          console.log('Device status updated:', payload);

          // Invalidate queries to refresh the data
          queryClient.invalidateQueries({ queryKey: ['mikrotik-devices'] });
          queryClient.invalidateQueries({ queryKey: ['mikrotik-devices-pending'] });
          queryClient.invalidateQueries({ queryKey: ['mikrotik-devices-pending-count'] });
          queryClient.invalidateQueries({ queryKey: ['user-device-access'] });
        }
      )
      .subscribe((status) => {
        console.log('Realtime subscription status:', status);
      });

    return () => {
      console.log('Cleaning up realtime subscription...');
      supabase.removeChannel(channel);
    };
  }, [isSuperAdmin, queryClient]);
};
