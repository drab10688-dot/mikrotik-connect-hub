import { useEffect, useState, useCallback, useRef } from 'react';
import { authApi, getToken, setToken, clearToken, getStoredUser, setStoredUser, ApiError } from '@/lib/api-client';
import { clearSelectedDevice } from '@/lib/mikrotik';

interface VpsUser {
  id: string;
  email: string;
  full_name: string | null;
  role: 'super_admin' | 'admin' | 'user' | 'reseller' | 'secretary';
}

// Global session cache to avoid re-validating on every mount
let cachedUser: VpsUser | null = null;
let lastValidation = 0;
const VALIDATION_INTERVAL = 5 * 60 * 1000; // Re-validate every 5 minutes

export const useAuth = () => {
  const [user, setUser] = useState<VpsUser | null>(cachedUser || getStoredUser());
  const [loading, setLoading] = useState(!cachedUser && !!getToken());
  const validatingRef = useRef(false);

  const role = user?.role ?? null;

  useEffect(() => {
    let mounted = true;

    const validateSession = async () => {
      const token = getToken();
      if (!token) {
        setUser(null);
        setLoading(false);
        return;
      }

      // Skip if recently validated
      const now = Date.now();
      if (cachedUser && (now - lastValidation) < VALIDATION_INTERVAL) {
        setUser(cachedUser);
        setLoading(false);
        return;
      }

      // Prevent concurrent validations
      if (validatingRef.current) return;
      validatingRef.current = true;

      try {
        const { user: userData } = await authApi.me();
        if (!mounted) return;
        cachedUser = userData;
        lastValidation = Date.now();
        setUser(userData);
        setStoredUser(userData);
      } catch (err) {
        if (!mounted) return;
        // Only clear session on explicit 401 (invalid token)
        if (err instanceof ApiError && err.status === 401) {
          cachedUser = null;
          clearToken();
          clearSelectedDevice();
          setUser(null);
        }
        // For network errors, keep the stored user
        // so navigation doesn't kick them out
      } finally {
        validatingRef.current = false;
        if (mounted) setLoading(false);
      }
    };

    validateSession();
    return () => { mounted = false; };
  }, []);

  const signOut = useCallback(async () => {
    cachedUser = null;
    lastValidation = 0;
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
