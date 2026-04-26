import type {
  Subscription, EMI, CreditCard,
  BankAccount, Receivable, CapExItem, Rent,
  SmartAllocationResponse,
  DailyLogMeta, DailyLogComparison,
  DashboardSummary, MonthlyBurnItem, FinancialAccount, Obligation,
} from "@/modules/subtracker/types";
import { getApiBase } from "@/lib/apiBase";
import { track, kindForMethod } from "@/lib/loadingBus";

const BASE = getApiBase();

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Confirmed-logout latch. The previous version of `request()` wiped the
 * token + force-reloaded on *any* 401, which is hostile in real-world
 * conditions: a single transient 401 (Render cold start, mid-deploy
 * request, JWT-init race during boot, parallel call dispatched before
 * the token had been hydrated) would log the user out and reload the
 * page, undoing their work.
 *
 * The fix: only declare the user logged-out after a *confirming* round-tracker
 * against `/auth/me`. That endpoint is cheap and authoritative — if the
 * token is actually invalid/expired it will 401; if not, the original
 * 401 was transient and we simply throw so the caller can retry.
 *
 * The verification is also debounced — we never run more than one in
 * flight, and we cache the recent result for a few seconds so a burst of
 * parallel 401s only triggers one check.
 */
let inFlightVerify: Promise<boolean> | null = null;
let lastVerifyAt = 0;
let lastVerifyValid = true;

async function verifyTokenStillValid(): Promise<boolean> {
  const now = Date.now();
  // Cache: if we re-checked in the last 5s, reuse the answer.
  if (now - lastVerifyAt < 5000) return lastVerifyValid;
  if (inFlightVerify) return inFlightVerify;
  inFlightVerify = (async () => {
    try {
      const r = await fetch(`${BASE}/auth/me`, { headers: { ...getAuthHeaders() } });
      lastVerifyValid = r.status !== 401;
      return lastVerifyValid;
    } catch {
      // Network error: treat as "still valid" — we can't prove it's bad.
      lastVerifyValid = true;
      return true;
    } finally {
      lastVerifyAt = Date.now();
      inFlightVerify = null;
    }
  })();
  return inFlightVerify;
}

/**
 * Per-URL GET dedupe.
 *
 * React's <StrictMode> intentionally double-mounts components in dev,
 * which fires every effect twice — including data-fetching effects on
 * every dashboard hook. The result is two identical GETs back-to-back.
 *
 * Solution: collapse concurrent + immediately-repeated GETs to the same
 * URL into a single in-flight Promise. Window is short (1.5s) so the
 * dedupe only catches StrictMode's repeat mount; deliberate refresh
 * patterns (refetch on focus, polling, "Refresh" button) still hit the
 * server. POSTs/PUTs/DELETEs are never deduplicated.
 */
const _inFlight = new Map<string, Promise<any>>();

function dedupeKey(method: string, path: string): string | null {
  if (method !== "GET") return null;
  return `GET ${path}`;
}

/** All backend responses are wrapped: { data: T | null, error: string | null } */
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const method = (options?.method ?? "GET").toUpperCase();
  const key = dedupeKey(method, path);
  if (key && _inFlight.has(key)) return _inFlight.get(key)! as Promise<T>;

  const done = track(kindForMethod(options?.method));
  const p = (async (): Promise<T> => {
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
        // Skip the verify dance for the verify endpoint itself.
        const isVerifyCall = path === "/auth/me";
        const hadToken = !!localStorage.getItem("auth_token");
        if (hadToken && !isVerifyCall) {
          const stillValid = await verifyTokenStillValid();
          if (stillValid) {
            // Transient 401 — surface the error but keep the session.
            throw new Error("Request failed (please retry)");
          }
        }
        // Token is genuinely invalid — clear and surface a logout signal.
        localStorage.removeItem("auth_token");
        localStorage.removeItem("auth_user");
        window.dispatchEvent(new Event("subtracker:logout"));
        throw new Error("Unauthorized");
      }

      const json = await res.json() as { data: T | null; error: string | null };

      if (!res.ok || json.error) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      return json.data as T;
    } finally {
      done();
    }
  })();

  if (key) {
    _inFlight.set(key, p);
    // Clear after a short window. Doing it on resolution would still
    // let StrictMode's repeat fire a fresh request because the second
    // mount happens on the next tick — keep the entry around 1.5s.
    p.finally(() => {
      setTimeout(() => {
        if (_inFlight.get(key) === p) _inFlight.delete(key);
      }, 1500);
    });
  }
  return p;
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
  billed_statement_status?: "all" | "paid" | "unpaid";
}

export const getPeriodSummary = (p: {
  dateFrom?: string;
  dateTo?: string;
  includeBilled?: boolean;
  includeUnbilled?: boolean;
  billedStatementStatus?: "all" | "paid" | "unpaid";
}) => {
  const qs = new URLSearchParams();
  if (p.dateFrom)                      qs.set("date_from",        p.dateFrom);
  if (p.dateTo)                        qs.set("date_to",          p.dateTo);
  if (p.includeBilled   !== undefined) qs.set("include_billed",   String(p.includeBilled));
  if (p.includeUnbilled !== undefined) qs.set("include_unbilled", String(p.includeUnbilled));
  if (p.billedStatementStatus)         qs.set("billed_statement_status", p.billedStatementStatus);
  return request<PeriodSummary>(`/cards/summary/period?${qs}`);
};

// ── Dashboard (Ledger-derived) ─────────────────────────────────────────────
export const getDashboardSummary = () =>
  request<DashboardSummary>("/dashboard/summary");
export const getDashboardMonthlyBurn = (months = 6) =>
  request<MonthlyBurnItem[]>(`/dashboard/monthly-burn?months=${months}`);
export interface CashFlowCategory { category: string; total: number; count: number }
export interface DashboardCashFlow {
  date_from: string; date_to: string;
  inflows: CashFlowCategory[]; outflows: CashFlowCategory[];
  total_inflows: number; total_outflows: number; net: number;
}
export const getDashboardCashFlow = (dateFrom?: string, dateTo?: string) => {
  const p = new URLSearchParams();
  if (dateFrom) p.set("date_from", dateFrom);
  if (dateTo)   p.set("date_to",   dateTo);
  return request<DashboardCashFlow>(`/dashboard/cash-flow?${p}`);
};
export const getDashboardUtilization = () =>
  request<{ id: string; name: string; last4: string | null; outstanding: number; credit_limit: number | null; utilization_pct: number | null; available_credit: number | null }[]>("/dashboard/utilization");

// ── Financial Accounts (Ledger) ────────────────────────────────────────────
export const getFinancialAccounts = (kind?: FinancialAccount["kind"]) => {
  const p = kind ? `?kind=${kind}` : "";
  return request<FinancialAccount[]>(`/financial-accounts/${p}`);
};
export const createFinancialAccount = (d: Partial<FinancialAccount> & { kind: FinancialAccount["kind"]; name: string }) =>
  request<FinancialAccount>("/financial-accounts/", { method: "POST", body: JSON.stringify(d) });
export const updateFinancialAccount = (id: string, d: Partial<FinancialAccount>) =>
  request<FinancialAccount>(`/financial-accounts/${id}`, { method: "PUT", body: JSON.stringify(d) });
export const deleteFinancialAccount = (id: string) =>
  request<{ deleted: boolean }>(`/financial-accounts/${id}`, { method: "DELETE" });
export const getFinancialAccountBalance = (id: string, asOf?: string) =>
  request<{ account_id: string; balance?: number; outstanding?: number; minimum_due?: number }>(
    `/financial-accounts/${id}/balance${asOf ? `?as_of=${asOf}` : ""}`
  );
export interface AccountLedgerEntry {
  id: string;
  account_id: string;
  direction: "debit" | "credit";
  amount: number;
  description: string;
  category: string;
  effective_date: string;
  status: string;
  created_at: string;
  billing_cycle_id?: string | null;
  billing_statement_date?: string | null;
  billing_due_date?: string | null;
  is_billed?: boolean;
}
export const getFinancialAccountLedger = (
  id: string,
  p: { dateFrom?: string; dateTo?: string; category?: string; limit?: number; offset?: number } = {}
) => {
  const qs = new URLSearchParams();
  if (p.dateFrom) qs.set("date_from", p.dateFrom);
  if (p.dateTo) qs.set("date_to", p.dateTo);
  if (p.category) qs.set("category", p.category);
  if (p.limit !== undefined) qs.set("limit", String(p.limit));
  if (p.offset !== undefined) qs.set("offset", String(p.offset));
  return request<{ entries: AccountLedgerEntry[]; current_balance: number; count: number }>(
    `/financial-accounts/${id}/ledger?${qs}`
  );
};
export const createLedgerEntry = (d: {
  account_id: string;
  direction: "debit" | "credit";
  amount: number;
  description: string;
  effective_date?: string;
  category?: string;
  merchant?: string;
  billing_cycle_id?: string;
}) =>
  request<AccountLedgerEntry>("/ledger/", { method: "POST", body: JSON.stringify(d) });

export interface BillingCycle {
  id: string;
  account_id: string;
  cycle_start?: string;
  cycle_end?: string;
  statement_date: string;
  due_date: string;
  total_billed: number;
  minimum_due: number;
  total_paid: number;
  balance_due: number;
  is_closed: boolean;
  statement_status?: "unbilled" | "paid" | "unpaid" | "partial";
  card_name?: string;
  bank?: string;
}
export const getBillingCycles = (p: { accountId?: string; openOnly?: boolean; limit?: number } = {}) => {
  const qs = new URLSearchParams();
  if (p.accountId) qs.set("account_id", p.accountId);
  if (p.openOnly !== undefined) qs.set("open_only", String(p.openOnly));
  if (p.limit !== undefined) qs.set("limit", String(p.limit));
  return request<BillingCycle[]>(`/billing-cycles/?${qs}`);
};
export const closeBillingCycle = (cycleId: string, d: { total_billed?: number; minimum_due?: number } = {}) =>
  request<BillingCycle>(`/billing-cycles/${cycleId}/close`, { method: "POST", body: JSON.stringify(d) });
export const updateBillingCycle = (
  cycleId: string,
  d: { cycle_start?: string; cycle_end?: string; statement_date?: string; due_date?: string; total_billed?: number; minimum_due?: number; total_paid?: number }
) =>
  request<BillingCycle>(`/billing-cycles/${cycleId}`, { method: "PUT", body: JSON.stringify(d) });
export const deleteBillingCycle = (cycleId: string) =>
  request<{ deleted: boolean; id: string }>(`/billing-cycles/${cycleId}`, { method: "DELETE" });
export const createBillingCycleForCard = (
  accountId: string,
  d: {
    statement_period?: "current" | "last";
    statement_date?: string;
    due_date?: string;
    cycle_start?: string;
    cycle_end?: string;
    total_billed?: number;
    minimum_due?: number;
  }
) =>
  request<BillingCycle>(`/financial-accounts/${accountId}/billing-cycles`, { method: "POST", body: JSON.stringify(d) });
export const reopenBillingCycle = (cycleId: string) =>
  request<BillingCycle>(`/billing-cycles/${cycleId}/reopen`, { method: "POST" });
export const getBillingCycleOverview = (accountId: string) =>
  request<{ account_id: string; current_cycle: BillingCycle | null; last_statement: BillingCycle | null; past_statements: BillingCycle[] }>(
    `/billing-cycles/account/${accountId}/overview`
  );

/** Pay a statement: posts a `cc_payment` ledger entry from a source account
 *  and bumps the cycle's total_paid. The backend handles the double-entry. */
export const payBillingCycle = (
  cycleId: string,
  d: { amount: number; source_account_id: string; effective_date?: string },
) =>
  request<{ cycle: BillingCycle; new_total_paid: number }>(
    `/billing-cycles/${cycleId}/pay`,
    { method: "POST", body: JSON.stringify(d) },
  );

/** Fetch one billing cycle's full detail including its linked transactions. */
export const getBillingCycle = (cycleId: string) =>
  request<BillingCycle & { entries: AccountLedgerEntry[] }>(
    `/billing-cycles/${cycleId}`,
  );

// ── Email preferences ─────────────────────────────────────────────────────
export interface EmailPrefs {
  reminders_enabled: boolean;
  reminders_horizon_days: number;
  reminders_last_sent_at: string | null;
  invite_emails_enabled: boolean;
}
/** Back-compat alias — older callers use `ReminderPrefs`. */
export type ReminderPrefs = EmailPrefs;
export const getEmailPrefs = () =>
  request<EmailPrefs>("/reminders/preferences");
export const updateEmailPrefs = (
  d: Partial<Pick<EmailPrefs, "reminders_enabled" | "reminders_horizon_days" | "invite_emails_enabled">>,
) =>
  request<EmailPrefs>("/reminders/preferences", { method: "PUT", body: JSON.stringify(d) });
// Legacy aliases used by older components.
export const getReminderPrefs    = getEmailPrefs;
export const updateReminderPrefs = updateEmailPrefs;
export const sendTestReminder = () =>
  request<{ sent: boolean }>("/reminders/test", { method: "POST" });

/** Server-side snooze for an attention item. Mirrors the email snooze. */
export const snoozeAttention = (item_key: string, days: number = 3) =>
  request<{ item_key: string; snoozed_until: string }>(
    "/reminders/snooze",
    { method: "POST", body: JSON.stringify({ item_key, days }) },
  );

// Tracker types/endpoints have moved to `@/modules/expense_tracker`. The
// barrel at modules/expense_tracker/index.ts is the only public surface;
// importers should use that path so future microservice extraction stays
// painless.

// ── Obligations (Unified: subscriptions + EMIs + rent) ────────────────────
export const getObligations = (type?: "subscription" | "emi" | "rent" | "insurance" | "sip" | "utility" | "other") => {
  const p = type ? `?type=${type}` : "";
  return request<Obligation[]>(`/obligations/${p}`);
};
export const createObligation = (d: Partial<Obligation>) =>
  request<Obligation>("/obligations/", { method: "POST", body: JSON.stringify(d) });
export const updateObligation = (id: string, d: Partial<Obligation>) =>
  request<Obligation>(`/obligations/${id}`, { method: "PUT", body: JSON.stringify(d) });
export const deleteObligation = (id: string) =>
  request<{ deleted: boolean }>(`/obligations/${id}`, { method: "DELETE" });
export const getUpcomingObligations = (days = 30) =>
  request<{ id: string; obligation_id: string; name: string; type: string; amount_due: number; amount_paid: number; due_date: string; days_until_due: number; balance_due: number }[]>(`/obligations/upcoming?days=${days}`);

// ── Payments ───────────────────────────────────────────────────────────────
export const initiatePayment = (d: { from_account_id: string; to_entity_type: "billing_cycle" | "obligation" | "receivable" | "account" | "other"; to_entity_id?: string; amount: number; billing_cycle_id?: string; payment_method?: string; reference_number?: string; note?: string }) =>
  request<{ id: string; status: string }>("/payments", { method: "POST", body: JSON.stringify(d) });
export const settlePayment = (id: string, applied_amount?: number) =>
  request<{ id: string; status: string }>(`/payments/${id}/settle`, { method: "POST", body: JSON.stringify({ applied_amount }) });

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
