import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import type { AuthUser, AuthContextValue } from "./types";

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]     = useState<AuthUser | null>(null);
  const [token, setToken]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedToken = localStorage.getItem("auth_token");
    const storedUser  = localStorage.getItem("auth_user");
    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
    }
    setLoading(false);

    // Listen for the global logout signal dispatched by the API client
    // when the server confirms a token is invalid. This avoids force
    // page-reloads for transient 401s — see `verifyTokenStillValid` in
    // services/api.ts.
    const onLogoutSignal = () => {
      setToken(null);
      setUser(null);
    };
    window.addEventListener("subtracker:logout", onLogoutSignal);
    return () => window.removeEventListener("subtracker:logout", onLogoutSignal);
  }, []);

  const login = (accessToken: string, userData: AuthUser) => {
    localStorage.setItem("auth_token", accessToken);
    localStorage.setItem("auth_user", JSON.stringify(userData));
    setToken(accessToken);
    setUser(userData);
  };

  const logout = () => {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
