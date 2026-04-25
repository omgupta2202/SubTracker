import { useState, useEffect } from "react";
import { GoogleLogin } from "@react-oauth/google";
import type { CredentialResponse } from "@react-oauth/google";
import { useAuth } from "./AuthContext";
import { loginUser, registerUser, googleLogin } from "./api";
import { cn } from "@/lib/utils";

type Mode = "signin" | "register";

const inputCls =
  "w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-100 " +
  "placeholder:text-zinc-600 focus:outline-none focus:border-violet-500 " +
  "focus:ring-1 focus:ring-violet-500/30 transition-all";

export function LoginPage() {
  const { login } = useAuth();

  const [mode, setMode]         = useState<Mode>("signin");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [name, setName]         = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [success, setSuccess]   = useState("");

  // Handle redirect back from the email confirmation link
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("email_confirmed") === "1") {
      setMode("signin");
      setSuccess("Email confirmed! You can now sign in.");
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (params.get("confirm_error") === "expired") {
      setError("Confirmation link has expired. Please register again.");
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (params.get("confirm_error") === "invalid") {
      setError("Invalid confirmation link.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const clearMessages = () => { setError(""); setSuccess(""); };

  // ── Google ───────────────────────────────────────────────────────────────
  const handleGoogleSuccess = async (res: CredentialResponse) => {
    if (!res.credential) return;
    clearMessages();
    try {
      const data = await googleLogin(res.credential);
      login(data.access_token, data.user);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Google sign-in failed.");
    }
  };

  // ── Email / password ─────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();
    setLoading(true);
    try {
      if (mode === "signin") {
        const data = await loginUser(email, password);
        login(data.access_token, data.user);
      } else {
        const data = await registerUser(email, password, name || undefined);
        setSuccess(data.message);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-zinc-100 tracking-tight">SubTracker</h1>
          <p className="text-sm text-zinc-500 mt-1">Your personal finance dashboard</p>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl">
          {/* Mode tabs */}
          <div className="flex rounded-xl bg-zinc-800/60 p-1 mb-6">
            {(["signin", "register"] as Mode[]).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); clearMessages(); }}
                className={cn(
                  "flex-1 py-2 text-sm font-semibold rounded-lg transition-colors",
                  mode === m
                    ? "bg-zinc-700 text-zinc-100 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                {m === "signin" ? "Sign In" : "Create Account"}
              </button>
            ))}
          </div>

          {/* Status banners */}
          {error && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm">
              {success}
            </div>
          )}

          {/* Email / password form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            {mode === "register" && (
              <input
                className={inputCls}
                type="text"
                placeholder="Name (optional)"
                value={name}
                onChange={e => setName(e.target.value)}
                autoComplete="name"
              />
            )}
            <input
              className={inputCls}
              type="email"
              placeholder="Email address"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
            <input
              className={inputCls}
              type="password"
              placeholder={mode === "register" ? "Password (min 8 characters)" : "Password"}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl py-3 text-sm font-semibold transition-colors mt-1"
            >
              {loading
                ? mode === "signin" ? "Signing in…" : "Creating account…"
                : mode === "signin" ? "Sign In" : "Create Account"}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-zinc-800" />
            <span className="text-xs text-zinc-600 uppercase tracking-widest">or</span>
            <div className="flex-1 h-px bg-zinc-800" />
          </div>

          {/* Google SSO — width must be a number of px (max 400), not a CSS string. */}
          <div className="flex justify-center">
            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={() => setError("Google sign-in failed.")}
              theme="filled_black"
              size="large"
              shape="rectangular"
              width={320}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
