export interface Subscription {
  id: string;
  name: string;
  amount: number;
  billing_cycle: "monthly" | "yearly" | "weekly";
  due_day: number;
  category: string;
}

export interface EmiMath {
  outstanding_principal: number;
  interest_paid_to_date: number;
  principal_paid_to_date: number;
  total_interest_over_loan: number;
  scheduled_remaining: number;
  foreclosure_savings: number;
}

export interface EMI {
  id: string;
  name: string;
  lender: string;
  amount: number;
  total_months: number;
  paid_months: number;
  due_day: number;
  principal?: number | null;
  interest_rate?: number | null;
  emi_math?: EmiMath | null;
}

export interface CreditCard {
  id: string;
  name: string;
  bank: string;
  last4: string;
  /** Single-number summary: unbilled + last_statement. */
  outstanding: number;
  /** What's accumulating on the current open cycle (statement not yet issued). */
  unbilled?: number;
  /** What was billed on the most recent closed cycle and isn't fully paid. */
  last_statement?: number;
  /** ISO due date for the most recent closed-and-unpaid statement. */
  last_statement_due_date?: string | null;
  /** ISO statement date for the most recent closed-and-unpaid cycle. */
  last_statement_date?: string | null;
  minimum_due: number;
  credit_limit?: number;
  due_date_offset: number;
  due_day: number | null;
}

export interface BankAccount {
  id: string;
  name: string;
  balance: number;
  bank: string;
}

export interface Receivable {
  id: string;
  name: string;
  amount: number;
  expected_day: number;
  source: string;
}

export interface CapExItem {
  id: string;
  name: string;
  amount: number;
  category: string;
}

export interface AllocationItem {
  card?: string;
  card_name?: string;
  amount?: number;
  allocatable?: number;
  balance_due?: number;
  pay_from?: string;
  from_account_name?: string | null;
  due_date: string;
  days_left?: number;
  can_pay_minimum?: boolean;
  feasible?: boolean;
  apr?: number;
  interest_saved_monthly?: number;
}

export interface PostBalance {
  account?: string;
  account_name?: string;
  original?: number;
  before?: number;
  remaining?: number;
  after?: number;
}

export interface AllocationSummary {
  total_liquid: number;
  total_cc_outstanding: number;
  total_cc_minimum_due?: number;
  net_after_cc: number;
  total_receivables?: number;
  total_receivables_30d?: number;
  total_capex?: number;
  total_capex_planned?: number;
  cash_flow_gap: number;
  rent?: number;
}

export interface SmartAllocationResponse {
  allocations: AllocationItem[];
  post_balances: PostBalance[];
  summary: AllocationSummary;
}

export interface Rent {
  id?: string;
  amount: number;
  due_day: number;
}


// ── Daily Logs & Comparison ────────────────────────────────────────────────

export interface DailyLogSummary {
  total_liquid: number;
  total_cc_outstanding: number;
  rent: number;
  net_after_cc: number;
  total_receivables: number;
  total_capex: number;
  cash_flow_gap: number;
}

export interface DailyLogMeta {
  id: string;
  log_date: string;
  summary: DailyLogSummary;
  created_at: string;
}

export interface DiffValue {
  a: number | null;
  b: number | null;
  delta: number;
  pct: number | null;
  positive_is_good: boolean | null;
}

export interface DiffEntity {
  id: string;
  name: string;
  status: "unchanged" | "changed" | "added" | "removed";
  fields: Record<string, DiffValue>;
}

export interface DailyLogComparison {
  date_a: string;
  date_b: string;
  summary: Record<string, DiffValue>;
  accounts: DiffEntity[];
  cards: DiffEntity[];
  emis: DiffEntity[];
  subscriptions: DiffEntity[];
  receivables: DiffEntity[];
  capex: DiffEntity[];
}

// ── Card Transactions & Statements ────────────────────────────────────────────

export interface CardTransaction {
  id: string;
  card_id: string;
  description: string;
  amount: number;
  txn_date: string;
  statement_id: string | null;
  created_at: string;
}

export interface CardStatement {
  id: string;
  card_id: string;
  statement_date: string;
  due_date: string;
  total_billed: number;
  minimum_due: number;
  created_at: string;
}

export interface DashboardFilters {
  asOfDate: string;
}

// ── Ledger / New Architecture Types ───────────────────────────────────────────

export interface DashboardAccount {
  id: string;
  name: string;
  balance: number;
}

export interface DashboardCreditCard {
  id: string;
  name: string;
  last4: string | null;
  outstanding: number;
  minimum_due: number;
}

export interface UpcomingObligation {
  id: string;
  obligation_id: string;
  name: string;
  type?: "subscription" | "emi" | "rent" | "insurance" | "sip" | "utility" | "other";
  obligation_type?: "subscription" | "emi" | "rent";
  amount_due: number;
  amount_paid?: number;
  balance_due?: number;
  due_date: string;
  days_until?: number;
  days_until_due?: number;
}

export interface DashboardSummary {
  total_liquid: number;
  total_cc_outstanding: number;
  total_cc_minimum_due: number;
  credit_utilization_pct: number | null;
  monthly_burn: number;
  monthly_burn_baseline?: number;
  monthly_burn_projected?: number;
  monthly_burn_trend_pct: number | null;
  cash_flow_gap: number;
  net_after_cc: number;
  upcoming_obligations_30d: number;
  total_receivables_30d: number;
  total_capex_planned: number;
  total_capex_due_30d?: number;
  accounts: DashboardAccount[];
  credit_cards: DashboardCreditCard[];
  upcoming_dues_7d: UpcomingObligation[];
  attention_items?: AttentionItem[];
  as_of: string;
}

export interface AttentionItem {
  id: string;
  kind: "credit_card_due" | "obligation_due";
  title: string;
  due_date: string;
  amount: number;
  days_until_due: number;
  account_id?: string;
  obligation_id?: string;
  obligation_type?: string;
}

export interface MonthlyBurnItem {
  year: number;
  month: number;
  month_label: string;
  burn: number;
  income: number;
  net: number;
}

export interface FinancialAccount {
  id: string;
  name: string;
  kind: "bank" | "wallet" | "cash" | "credit_card" | "bnpl" | "investment";
  institution: string;
  is_active: boolean;
  balance?: number;
  outstanding?: number;
  minimum_due?: number;
  last4?: string;
  credit_limit?: number;
  billing_cycle_day?: number | null;
  due_offset_days?: number | null;
}

export interface Obligation {
  id: string;
  type: "subscription" | "emi" | "rent" | "insurance" | "sip" | "utility" | "other";
  name: string;
  category?: string;
  amount: number;
  frequency: "monthly" | "yearly" | "weekly" | "quarterly" | "half_yearly" | "one_time";
  anchor_date: string;
  due_day: number | null;
  status: "active" | "paused" | "cancelled" | "completed";
  total_installments?: number;
  completed_installments?: number;
  remaining_installments?: number;
  lender?: string;
  principal?: number | null;
  interest_rate?: number | null;
  emi_math?: EmiMath | null;
}

export type CardId =
  | "monthly-burn"
  | "seven-day"
  | "emi-progress"
  | "net-worth"
  | "cash-flow"
  | "capex";

export interface CardConfig {
  id: CardId;
  label: string;
  visible: boolean;
  order: number;
  colSpan: 1 | 2 | 3;
  widthPct?: number;
  rowHeight?: number; // px; stored on the first card of each row
}
