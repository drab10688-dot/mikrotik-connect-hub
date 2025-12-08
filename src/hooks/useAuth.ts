import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { User } from '@supabase/supabase-js';
import { clearSelectedDevice } from '@/lib/mikrotik';

interface UserRole {
  role: 'super_admin' | 'admin' | 'user' | 'reseller' | 'secretary' | null;
}

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole['role']>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    // Get initial session
    const initAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!mounted) return;
        
        setUser(session?.user ?? null);
        
        if (session?.user) {
          await fetchUserRole(session.user.id);
        } else {
          // Clear device selection when no session
          clearSelectedDevice();
          setLoading(false);
        }
      } catch (error) {
        console.error('Error initializing auth:', error);
        if (mounted) {
          setUser(null);
          setRole(null);
          setLoading(false);
        }
      }
    };

    initAuth();

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchUserRole(session.user.id);
      } else {
        // Clear device selection on logout
        if (event === 'SIGNED_OUT') {
          clearSelectedDevice();
        }
        setRole(null);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const fetchUserRole = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .order('role', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Error fetching user role:', error);
        setRole(null);
        setLoading(false);
        return;
      }
      
      // If no role exists, create a default 'user' role
      if (!data) {
        const { error: insertError } = await supabase
          .from('user_roles')
          .insert({ user_id: userId, role: 'user' });
        
        if (!insertError) {
          setRole('user');
        } else {
          console.error('Error creating default role:', insertError);
          setRole(null);
        }
      } else {
        setRole(data.role);
      }
    } catch (error) {
      console.error('Error in fetchUserRole:', error);
      setRole(null);
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    clearSelectedDevice();
    await supabase.auth.signOut();
  };

  return {
    user,
    role,
    loading,
    signOut,
    isSuperAdmin: role === 'super_admin',
    isAdmin: role === 'admin' || role === 'super_admin',
    isReseller: role === 'reseller',
    isSecretary: role === 'secretary',
    isAuthenticated: !!user,
  };
};
