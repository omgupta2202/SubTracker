export interface Subscription {
  id: string;
  name: string;
  amount: number;
  billing_cycle: "monthly" | "yearly" | "weekly";
  due_day: number;
  category: string;
}

export interface EMI {
  id: string;
  name: string;
  lender: string;
  amount: number;
  total_months: number;
  paid_months: number;
  due_day: number;
}

export interface CreditCard {
  id: string;
  name: string;
  bank: string;
  last4: string;
  outstanding: number;
  minimum_due: number;
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
  card: string;
  amount: number;
  pay_from: string;
  due_date: string;
  days_left: number;
  feasible: boolean;
}

export interface PostBalance {
  account: string;
  original: number;
  remaining: number;
}

export interface AllocationSummary {
  total_liquid: number;
  total_cc_outstanding: number;
  net_after_cc: number;
  total_receivables: number;
  total_capex: number;
  cash_flow_gap: number;
  rent: number;
}

export interface SmartAllocationResponse {
  allocations: AllocationItem[];
  post_balances: PostBalance[];
  summary: AllocationSummary;
}

export interface Rent {
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
  dateFrom: string;
  dateTo: string;
  includeBilled: boolean;
  includeUnbilled: boolean;
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
