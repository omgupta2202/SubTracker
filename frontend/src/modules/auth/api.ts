/**
 * Auth module API client.
 *
 * Intentionally self-contained — uses plain fetch, NOT the shared request()
 * helper, because auth calls establish the session rather than consuming it.
 * No JWT header is attached here.
 */
import type { AuthUser } from "./types";
import { getApiBase } from "@/lib/apiBase";

const BASE = `${getApiBase()}/auth`;

async function authFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res  = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const json = (await res.json()) as { data: T | null; error: string | null };
  if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.data as T;
}

export interface LoginResponse {
  access_token: string;
  user: AuthUser;
}

export const loginUser = (email: string, password: string) =>
  authFetch<LoginResponse>("/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

export const registerUser = (email: string, password: string, name?: string) =>
  authFetch<{ message: string }>("/register", {
    method: "POST",
    body: JSON.stringify({ email, password, name }),
  });

export const googleLogin = (credential: string) =>
  authFetch<LoginResponse>("/google", {
    method: "POST",
    body: JSON.stringify({ credential }),
  });
