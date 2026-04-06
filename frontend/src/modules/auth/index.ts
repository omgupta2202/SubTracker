/**
 * Auth module — public API.
 *
 * Drop-in authentication for React + Flask projects.
 *
 * Usage:
 *   // main.tsx
 *   import { AuthProvider } from "@/modules/auth";
 *   <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
 *     <AuthProvider><App /></AuthProvider>
 *   </GoogleOAuthProvider>
 *
 *   // App.tsx
 *   import { useAuth, LoginPage } from "@/modules/auth";
 *   const { user, loading } = useAuth();
 *   if (!user) return <LoginPage />;
 */
export { AuthProvider, useAuth }  from "./AuthContext";
export { LoginPage }              from "./LoginPage";
export { loginUser, registerUser, googleLogin } from "./api";
export type { AuthUser, AuthContextValue }      from "./types";
