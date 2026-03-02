import { useEffect, useState, useCallback } from 'react';
import { authApi, getToken, setToken, clearToken, getStoredUser, setStoredUser } from '@/lib/api-client';
import { clearSelectedDevice } from '@/lib/mikrotik';

interface VpsUser {
  id: string;
  email: string;
  full_name: string | null;
  role: 'super_admin' | 'admin' | 'user' | 'reseller' | 'secretary';
}

export const useAuth = () => {
  const [user, setUser] = useState<VpsUser | null>(getStoredUser());
  const [loading, setLoading] = useState(true);

  const role = user?.role ?? null;

  // Validate session on mount
  useEffect(() => {
    let mounted = true;

    const validateSession = async () => {
      const token = getToken();
      if (!token) {
        setUser(null);
        setLoading(false);
        return;
      }

      try {
        const { user: userData } = await authApi.me();
        if (!mounted) return;
        setUser(userData);
        setStoredUser(userData);
      } catch {
        if (!mounted) return;
        // Token invalid or expired
        clearToken();
        clearSelectedDevice();
        setUser(null);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    validateSession();
    return () => { mounted = false; };
  }, []);

  const signOut = useCallback(async () => {
    clearSelectedDevice();
    clearToken();
    setUser(null);
    window.location.href = '/login';
  }, []);

  return {
    user,
    role,
    loading,
    signOut,
    isSuperAdmin: role === 'super_admin',
    isAdmin: role === 'admin' || role === 'super_admin',
    isReseller: role === 'reseller',
    isSecretary: role === 'secretary',
    isAuthenticated: !!user && !!getToken(),
  };
};
