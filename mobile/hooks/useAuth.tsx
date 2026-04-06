import React, { createContext, useContext, useEffect, useState } from 'react';
import { getStoredToken, getStoredUser, setStoredToken, setStoredUser, clearStoredToken, clearStoredUser } from '@/services/api';
import type { AuthUser } from '@/types';

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (token: string, user: AuthUser) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (user: AuthUser) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [t, u] = await Promise.all([getStoredToken(), getStoredUser()]);
      setToken(t);
      setUser(u);
      setLoading(false);
    })();
  }, []);

  const login = async (accessToken: string, authUser: AuthUser) => {
    await setStoredToken(accessToken);
    await setStoredUser(authUser);
    setToken(accessToken);
    setUser(authUser);
  };

  const logout = async () => {
    await clearStoredToken();
    await clearStoredUser();
    setToken(null);
    setUser(null);
  };

  const updateUser = async (updated: AuthUser) => {
    await setStoredUser(updated);
    setUser(updated);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
