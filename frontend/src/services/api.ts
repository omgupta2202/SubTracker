import type {
  Subscription, EMI, CreditCard,
  BankAccount, Receivable, CapExItem, Rent,
  SmartAllocationResponse,
  DailyLogMeta, DailyLogComparison,
  CardTransaction, CardStatement,
} from "@/types";

const BASE = "/api";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** All backend responses are wrapped: { data: T | null, error: string | null } */
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

  const json = await res.json() as { data: T | null; error: string | null };

  if (!res.ok || json.error) {
    throw new Error(json.error ?? `HTTP ${res.status}`);
  }
  return json.data as T;
}

// ── Subscriptions ──────────────────────────────────────────────────────────
export const getSubscriptions = () => request<Subscription[]>("/subscriptions");
export const createSubscription = (d: Omit<Subscription, "id">) =>
  request<Subscription>("/subscriptions", { method: "POST", body: JSON.stringify(d) });
export const updateSubscription = (id: string, d: Partial<Omit<Subscription, "id">>) =>
  request<Subscription>(`/subscriptions/${id}`, { method: "PUT", body: JSON.stringify(d) });
export const deleteSubscription = (id: string) =>
  request<{ deleted: string }>(`/subscriptions/${id}`, { method: "DELETE" });

// ── EMIs ───────────────────────────────────────────────────────────────────
export const getEmis = () => request<EMI[]>("/emis");
export const createEmi = (d: Omit<EMI, "id">) =>
  request<EMI>("/emis", { method: "POST", body: JSON.stringify(d) });
export const updateEmi = (id: string, d: Partial<Omit<EMI, "id">>) =>
  request<EMI>(`/emis/${id}`, { method: "PUT", body: JSON.stringify(d) });
export const deleteEmi = (id: string) =>
  request<{ deleted: string }>(`/emis/${id}`, { method: "DELETE" });

// ── Credit Cards ───────────────────────────────────────────────────────────
export const getCards = () => request<CreditCard[]>("/cards");
export const createCard = (d: Omit<CreditCard, "id">) =>
  request<CreditCard>("/cards", { method: "POST", body: JSON.stringify(d) });
export const updateCard = (id: string, d: Partial<Omit<CreditCard, "id">>) =>
  request<CreditCard>(`/cards/${id}`, { method: "PUT", body: JSON.stringify(d) });
export const deleteCard = (id: string) =>
  request<{ deleted: string }>(`/cards/${id}`, { method: "DELETE" });

// ── Bank Accounts ──────────────────────────────────────────────────────────
export const getAccounts = () => request<BankAccount[]>("/accounts");
export const createAccount = (d: Omit<BankAccount, "id">) =>
  request<BankAccount>("/accounts", { method: "POST", body: JSON.stringify(d) });
export const updateAccount = (id: string, d: Partial<Omit<BankAccount, "id">>) =>
  request<BankAccount>(`/accounts/${id}`, { method: "PUT", body: JSON.stringify(d) });
export const deleteAccount = (id: string) =>
  request<{ deleted: string }>(`/accounts/${id}`, { method: "DELETE" });

// ── Receivables ────────────────────────────────────────────────────────────
export const getReceivables = () => request<Receivable[]>("/receivables");
export const createReceivable = (d: Omit<Receivable, "id">) =>
  request<Receivable>("/receivables", { method: "POST", body: JSON.stringify(d) });
export const updateReceivable = (id: string, d: Partial<Omit<Receivable, "id">>) =>
  request<Receivable>(`/receivables/${id}`, { method: "PUT", body: JSON.stringify(d) });
export const deleteReceivable = (id: string) =>
  request<{ deleted: string }>(`/receivables/${id}`, { method: "DELETE" });

// ── CapEx ──────────────────────────────────────────────────────────────────
export const getCapex = () => request<CapExItem[]>("/capex");
export const createCapex = (d: Omit<CapExItem, "id">) =>
  request<CapExItem>("/capex", { method: "POST", body: JSON.stringify(d) });
export const updateCapex = (id: string, d: Partial<Omit<CapExItem, "id">>) =>
  request<CapExItem>(`/capex/${id}`, { method: "PUT", body: JSON.stringify(d) });
export const deleteCapex = (id: string) =>
  request<{ deleted: string }>(`/capex/${id}`, { method: "DELETE" });

// ── Rent ───────────────────────────────────────────────────────────────────
export const getRent = () => request<Rent>("/rent");
export const updateRent = (d: Rent) =>
  request<Rent>("/rent", { method: "PUT", body: JSON.stringify(d) });

// ── Smart Allocation ───────────────────────────────────────────────────────
export const getSmartAllocation = () =>
  request<SmartAllocationResponse>("/smart-allocation");

// ── Auth ───────────────────────────────────────────────────────────────────
interface AuthUser { id: string; email: string; name: string | null; avatar_url: string | null }
export const loginUser = (email: string, password: string) =>
  request<{ access_token: string; user: AuthUser }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
export const registerUser = (email: string, password: string, name?: string) =>
  request<{ message: string }>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, name }),
  });
export const updateUser = (d: { name?: string; email?: string; password?: string }) =>
  request<AuthUser>("/auth/me", { method: "PUT", body: JSON.stringify(d) });
export const deleteUser = () =>
  request<{ message: string }>("/auth/me", { method: "DELETE" });

// ── Card Transactions ──────────────────────────────────────────────────────
export interface TxnFilters { dateFrom?: string; dateTo?: string; type?: "billed" | "unbilled" | "all" }

export const getCardTransactions = (cardId: string, f: TxnFilters = {}) => {
  const p = new URLSearchParams();
  if (f.dateFrom) p.set("date_from", f.dateFrom);
  if (f.dateTo)   p.set("date_to",   f.dateTo);
  if (f.type)     p.set("type",      f.type);
  return request<CardTransaction[]>(`/cards/${cardId}/transactions?${p}`);
};
export const addCardTransaction = (cardId: string, d: { description: string; amount: number; txn_date?: string }) =>
  request<CardTransaction>(`/cards/${cardId}/transactions`, { method: "POST", body: JSON.stringify(d) });
export const deleteCardTransaction = (cardId: string, txnId: string) =>
  request<{ deleted: string }>(`/cards/${cardId}/transactions/${txnId}`, { method: "DELETE" });

export const getCardStatements = (cardId: string) =>
  request<CardStatement[]>(`/cards/${cardId}/statements`);
export const closeCardStatement = (cardId: string, d: { statement_date: string; due_date: string; minimum_due?: number }) =>
  request<CardStatement>(`/cards/${cardId}/statements`, { method: "POST", body: JSON.stringify(d) });

export interface PeriodSummary {
  total_liquid: number;
  cc_total: number;
  subs_total: number;
  emis_total: number;
  rent_total: number;
  receivables_total: number;
  capex_total: number;
  net_after_cc: number;
  cash_flow_gap: number;
  cc_source: "transactions" | "outstanding";
  is_period: boolean;
}

export const getPeriodSummary = (p: { dateFrom?: string; dateTo?: string; includeBilled?: boolean; includeUnbilled?: boolean }) => {
  const qs = new URLSearchParams();
  if (p.dateFrom)                      qs.set("date_from",        p.dateFrom);
  if (p.dateTo)                        qs.set("date_to",          p.dateTo);
  if (p.includeBilled   !== undefined) qs.set("include_billed",   String(p.includeBilled));
  if (p.includeUnbilled !== undefined) qs.set("include_unbilled", String(p.includeUnbilled));
  return request<PeriodSummary>(`/cards/summary/period?${qs}`);
};

// ── Daily Logs ─────────────────────────────────────────────────────────────
export const getDailyLogs = (limit = 90) =>
  request<DailyLogMeta[]>(`/daily-logs?limit=${limit}`);
export const captureDailyLog = (date?: string) =>
  request<DailyLogMeta>("/daily-logs/capture", {
    method: "POST",
    body: JSON.stringify(date ? { date } : {}),
  });
export const compareDailyLogs = (date_a: string, date_b: string) =>
  request<DailyLogComparison>(`/daily-logs/compare?date_a=${date_a}&date_b=${date_b}`);
