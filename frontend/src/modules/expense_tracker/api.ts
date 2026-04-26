/**
 * Expense Tracker module — self-contained API client.
 *
 * Per the project's module convention this file uses plain `fetch`
 * directly and does NOT import from `services/api.ts`. That keeps the
 * module liftable into its own service later — change `BASE` and ship
 * the folder as-is to a new project.
 *
 * Auth-attached endpoints reuse the JWT in localStorage (same key as
 * the host app). Guest endpoints (token IS auth) use the unauth'd
 * `guestRequest`.
 */
import { getApiBase } from "@/lib/apiBase";
import { track, kindForMethod } from "@/lib/loadingBus";

const BASE = getApiBase();

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Per-URL GET dedupe — collapses StrictMode's double-mount fetches into
// one network request. Same pattern as the shared services/api.ts.
const _inFlight = new Map<string, Promise<any>>();

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const method = (options?.method ?? "GET").toUpperCase();
  const key = method === "GET" ? `GET ${path}` : null;
  if (key && _inFlight.has(key)) return _inFlight.get(key)! as Promise<T>;

  const done = track(kindForMethod(options?.method));
  const p = (async (): Promise<T> => {
    try {
      const res = await fetch(`${BASE}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
          ...(options?.headers as Record<string, string> | undefined),
        },
      });
      if (res.status === 401) {
        localStorage.removeItem("auth_token");
        localStorage.removeItem("auth_user");
        window.dispatchEvent(new Event("subtracker:logout"));
        throw new Error("Unauthorized");
      }
      const json = await res.json() as { data: T | null; error: string | null };
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      return json.data as T;
    } finally { done(); }
  })();

  if (key) {
    _inFlight.set(key, p);
    p.finally(() => {
      setTimeout(() => {
        if (_inFlight.get(key) === p) _inFlight.delete(key);
      }, 1500);
    });
  }
  return p;
}

async function guestRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const method = (options?.method ?? "GET").toUpperCase();
  const key = method === "GET" ? `guestGET ${path}` : null;
  if (key && _inFlight.has(key)) return _inFlight.get(key)! as Promise<T>;

  const p = (async (): Promise<T> => {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers as Record<string, string> | undefined),
      },
    });
    const json = await res.json() as { data: T | null; error: string | null };
    if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json.data as T;
  })();

  if (key) {
    _inFlight.set(key, p);
    p.finally(() => {
      setTimeout(() => {
        if (_inFlight.get(key) === p) _inFlight.delete(key);
      }, 1500);
    });
  }
  return p;
}

/* ── Types ──────────────────────────────────────────────────────────── */

export interface TrackerSummary {
  id: string;
  creator_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  currency: string;
  status: "active" | "settled" | "archived";
  note: string | null;
  created_at: string;
  total_spent?: number;
  expenses_count?: number;
  members_count?: number;
  /** Net balance for the current viewer in this tracker (paid − share). */
  my_balance?: number | null;
}
export interface TrackerMember {
  id: string;
  tracker_id: string;
  email: string;
  display_name: string;
  user_id: string | null;
  invite_status: "pending" | "joined" | "creator";
  invite_token: string | null;
  upi_id: string | null;
  invited_at: string;
  joined_at: string | null;
}
export interface TrackerExpenseSplit { member_id: string; share: number }
export interface TrackerExpensePayment { member_id: string; amount: number }
export interface TrackerCategory {
  id: string;
  tracker_id: string;
  name: string;
  color: "violet" | "fuchsia" | "emerald" | "amber" | "sky" | "rose" | "lime" | "orange" | "zinc";
  position: number;
  created_at: string;
}
export interface TrackerExpense {
  id: string;
  tracker_id: string;
  payer_id: string;
  description: string;
  amount: number;
  currency: string;
  expense_date: string;
  split_kind: "equal" | "custom";
  note: string | null;
  category_id: string | null;
  created_by: string | null;
  created_at: string;
  splits: TrackerExpenseSplit[];
  payments: TrackerExpensePayment[];
}
export interface TrackerBalance { member_id: string; display_name: string; paid: number; owed: number; net: number }
export interface TrackerDetail extends TrackerSummary {
  members: TrackerMember[];
  expenses: TrackerExpense[];
  balances: TrackerBalance[];
  categories?: TrackerCategory[];
  /** Off-ledger settlements; folded into balances already on the server. */
  settlements?: TrackerRecordedSettlement[];
}
export interface TrackerTransfer {
  from_member_id: string;
  from_display_name: string;
  to_member_id: string;
  to_display_name: string;
  to_upi_id: string | null;
  amount: number;
}
/** Recorded off-ledger payment ("Mark as paid"). Adjusts balances so the
 *  pair stops appearing in the pending-transfer list. */
export interface TrackerRecordedSettlement {
  id: string;
  tracker_id: string;
  from_member_id: string;
  to_member_id: string;
  amount: number;
  note: string | null;
  marked_by_member_id: string | null;
  settled_at: string;
}
export interface TrackerSettlement {
  balances: TrackerBalance[];
  transfers: TrackerTransfer[];
  /** History of recorded "marked paid" settlements. */
  settlements: TrackerRecordedSettlement[];
}
export interface TrackerTemplate {
  slug: string;
  label: string;
  description: string;
  icon: string;
  categories: { name: string; color: TrackerCategory["color"] }[];
}
export interface ImportRow {
  description: string;
  amount: number;
  payer?: string | null;
  expense_date?: string | null;
  category?: string | null;
  note?: string | null;
  split_with?: string[] | null;
}

/* ── Owner endpoints ─────────────────────────────────────────────────
   StrictMode dev double-fetch is handled at the `request()` layer above
   (1.5s in-flight + immediately-repeated GET dedupe), so plain calls
   here are fine. Templates rarely change; if they ever become heavy
   we can layer a longer TTL cache on top. */

export const listTrackerTemplates = () =>
  request<TrackerTemplate[]>("/trackers/templates");
export const listTrackers = () =>
  request<TrackerSummary[]>("/trackers/");
export const createTracker = (d: { name: string; start_date?: string; end_date?: string; note?: string; template?: string }) =>
  request<TrackerDetail>("/trackers/", { method: "POST", body: JSON.stringify(d) });
export const getTracker = (id: string) =>
  request<TrackerDetail>(`/trackers/${id}`);
export const updateTracker = (
  id: string,
  d: Partial<Pick<TrackerSummary, "name" | "start_date" | "end_date" | "note" | "status">>,
) => request<TrackerDetail>(`/trackers/${id}`, { method: "PUT", body: JSON.stringify(d) });
export const deleteTracker = (id: string) =>
  request<{ deleted: boolean }>(`/trackers/${id}`, { method: "DELETE" });

export const inviteTrackerMember = (id: string, d: { email: string; display_name: string }) =>
  request<TrackerMember>(`/trackers/${id}/members`, { method: "POST", body: JSON.stringify(d) });
export const removeTrackerMember = (id: string, memberId: string) =>
  request<{ deleted: boolean }>(`/trackers/${id}/members/${memberId}`, { method: "DELETE" });
export const resendTrackerInvite = (id: string, memberId: string) =>
  request<TrackerMember>(`/trackers/${id}/members/${memberId}/resend-invite`, { method: "POST" });
export const cancelTrackerInvite = (id: string, memberId: string) =>
  request<{ cancelled: boolean }>(`/trackers/${id}/members/${memberId}/cancel-invite`, { method: "POST" });
export const leaveTracker = (id: string) =>
  request<{ left: boolean }>(`/trackers/${id}/leave`, { method: "POST" });
export const nudgeTrackerMember = (id: string, memberId: string, d?: { expense_id?: string; note?: string }) =>
  request<{
    sent: boolean;
    to: string;
    subject: string;
    error?: string;
    /** Daily rolling-24h cap — backend tunable via NUDGE_DAILY_LIMIT. */
    daily_limit?: number;
    used_today?: number;
  }>(
    `/trackers/${id}/members/${memberId}/nudge`,
    { method: "POST", body: JSON.stringify(d ?? {}) },
  );

export const importTrackerExpenses = (
  id: string, rows: ImportRow[], opts?: { create_missing_categories?: boolean },
) => request<{ created: number; total: number; errors: { row: number; error: string }[] }>(
  `/trackers/${id}/import`,
  { method: "POST", body: JSON.stringify({ rows, ...opts }) },
);

export const addTrackerExpense = (
  id: string,
  d: {
    payer_id: string;
    description: string;
    amount: number;
    expense_date?: string;
    split_kind?: "equal" | "custom";
    splits?: TrackerExpenseSplit[];
    payments?: TrackerExpensePayment[];
    note?: string;
    category_id?: string | null;
  },
) => request<TrackerExpense>(`/trackers/${id}/expenses`, { method: "POST", body: JSON.stringify(d) });
export const updateTrackerExpense = (
  id: string, eid: string,
  d: Partial<{
    payer_id: string;
    description: string;
    amount: number;
    expense_date: string;
    split_kind: "equal" | "custom";
    splits: TrackerExpenseSplit[];
    payments: TrackerExpensePayment[];
    note: string | null;
    category_id: string | null;
  }>,
) => request<TrackerExpense>(`/trackers/${id}/expenses/${eid}`, { method: "PUT", body: JSON.stringify(d) });
export const deleteTrackerExpense = (id: string, eid: string) =>
  request<{ deleted: boolean }>(`/trackers/${id}/expenses/${eid}`, { method: "DELETE" });

export const listTrackerCategories = (id: string) =>
  request<TrackerCategory[]>(`/trackers/${id}/categories`);
export const createTrackerCategory = (id: string, d: { name: string; color?: TrackerCategory["color"] }) =>
  request<TrackerCategory>(`/trackers/${id}/categories`, { method: "POST", body: JSON.stringify(d) });
export const updateTrackerCategory = (id: string, cid: string, d: Partial<Pick<TrackerCategory, "name" | "color" | "position">>) =>
  request<TrackerCategory>(`/trackers/${id}/categories/${cid}`, { method: "PUT", body: JSON.stringify(d) });
export const deleteTrackerCategory = (id: string, cid: string) =>
  request<{ deleted: boolean }>(`/trackers/${id}/categories/${cid}`, { method: "DELETE" });

export const getTrackerSettlement = (id: string) =>
  request<TrackerSettlement>(`/trackers/${id}/settlement`);

export const recordTrackerSettlement = (
  id: string,
  d: { from_member_id: string; to_member_id: string; amount: number; note?: string },
) => request<TrackerRecordedSettlement>(
  `/trackers/${id}/settlements`,
  { method: "POST", body: JSON.stringify(d) },
);
export const deleteTrackerSettlement = (id: string, sid: string) =>
  request<{ deleted: boolean }>(`/trackers/${id}/settlements/${sid}`, { method: "DELETE" });

/* ── Guest endpoints ───────────────────────────────────────────────── */

export const guestGetTracker = (token: string) =>
  guestRequest<TrackerDetail & { me: TrackerMember }>(`/trackers/guest/${token}`);
export const guestAddTrackerExpense = (
  token: string,
  d: {
    payer_id?: string;
    description: string;
    amount: number;
    expense_date?: string;
    split_kind?: "equal" | "custom";
    splits?: TrackerExpenseSplit[];
    payments?: TrackerExpensePayment[];
    note?: string;
    category_id?: string | null;
  },
) => guestRequest<TrackerExpense>(`/trackers/guest/${token}/expenses`, { method: "POST", body: JSON.stringify(d) });
export const guestUpdateTrackerExpense = (
  token: string, eid: string,
  d: Partial<{
    payer_id: string;
    description: string;
    amount: number;
    expense_date: string;
    split_kind: "equal" | "custom";
    splits: TrackerExpenseSplit[];
    payments: TrackerExpensePayment[];
    note: string | null;
    category_id: string | null;
  }>,
) => guestRequest<TrackerExpense>(`/trackers/guest/${token}/expenses/${eid}`, { method: "PUT", body: JSON.stringify(d) });
export const guestDeleteTrackerExpense = (token: string, eid: string) =>
  guestRequest<{ deleted: boolean }>(`/trackers/guest/${token}/expenses/${eid}`, { method: "DELETE" });
export const guestCreateTrackerCategory = (token: string, d: { name: string; color?: TrackerCategory["color"] }) =>
  guestRequest<TrackerCategory>(`/trackers/guest/${token}/categories`, { method: "POST", body: JSON.stringify(d) });
export const guestUpdateMe = (token: string, d: { display_name?: string; upi_id?: string }) =>
  guestRequest<TrackerMember>(`/trackers/guest/${token}/me`, { method: "PATCH", body: JSON.stringify(d) });
