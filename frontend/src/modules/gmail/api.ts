import type { GmailStatus, SyncResult } from "./types";

const BASE = "/api";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
      ...(options?.headers as Record<string, string> | undefined),
    },
  });

  if (res.status === 401) {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    window.location.reload();
    throw new Error("Unauthorized");
  }

  const json = (await res.json()) as { data: T | null; error: string | null };
  if (!res.ok || json.error) {
    throw new Error(json.error ?? `HTTP ${res.status}`);
  }
  return json.data as T;
}

export const getGmailStatus = () =>
  request<GmailStatus>("/gmail/status");

export const getConnectUrl = () =>
  request<{ oauth_url: string }>("/gmail/connect");

export const syncGmail = () =>
  request<SyncResult>("/gmail/sync", { method: "POST" });

export const disconnectGmail = () =>
  request<{ disconnected: boolean }>("/gmail/disconnect", { method: "DELETE" });
