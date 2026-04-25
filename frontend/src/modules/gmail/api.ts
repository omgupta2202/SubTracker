import type { GmailStatus, SyncResult, RecurringSuggestion } from "./types";

import { getApiBase } from "@/lib/apiBase";
import { track, kindForMethod } from "@/lib/loadingBus";

const BASE = getApiBase();

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const done = track(kindForMethod(options?.method));
  try {
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
  } finally {
    done();
  }
}

export const getGmailStatus = () =>
  request<GmailStatus>("/gmail/status");

export const getConnectUrl = () =>
  request<{ oauth_url: string }>("/gmail/connect");

export const syncGmail = () =>
  request<SyncResult>("/gmail/sync", { method: "POST" });

export const disconnectGmail = () =>
  request<{ disconnected: boolean }>("/gmail/disconnect", { method: "DELETE" });

export const getRecurringSuggestions = (params?: { lookbackDays?: number; minOccurrences?: number }) => {
  const qs = new URLSearchParams();
  if (params?.lookbackDays)    qs.set("lookback_days",    String(params.lookbackDays));
  if (params?.minOccurrences)  qs.set("min_occurrences",  String(params.minOccurrences));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return request<RecurringSuggestion[]>(`/gmail/recurring-suggestions${suffix}`);
};
