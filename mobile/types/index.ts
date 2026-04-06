export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
}

export interface Subscription {
  id: string;
  name: string;
  amount: number;
  billing_cycle: string;
  due_day: number;
  category: string;
}

export interface EMI {
  id: string;
  name: string;
  lender: string;
  amount: number;
  due_day: number;
  total_months: number;
  paid_months: number;
}

export interface CreditCard {
  id: string;
  name: string;
  bank: string;
  last4: string;
  outstanding: number;
  minimum_due: number;
  due_day: number | null;
  due_date_offset: number;
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
  source: string;
  expected_day: number;
}

export interface CapExItem {
  id: string;
  name: string;
  amount: number;
  category: string;
}

export interface Rent {
  amount: number;
  due_day: number;
}

export interface SmartAllocationRow {
  card_id: string;
  card_name: string;
  bank: string;
  outstanding: number;
  minimum_due: number;
  due_day: number;
  days_until_due: number;
  source_account_id: string | null;
  source_account_name: string | null;
  source_bank: string | null;
  covered: boolean;
}

export interface SmartAllocationSummary {
  total_liquid: number;
  total_cc_outstanding: number;
  total_minimum_due: number;
  fully_covered: boolean;
  post_payment_liquid: number;
}

export interface SmartAllocationResponse {
  summary: SmartAllocationSummary;
  allocations: SmartAllocationRow[];
}

export interface CardTransaction {
  id: string;
  card_id: string;
  description: string;
  amount: number;
  txn_date: string;
  statement_id: string | null;
}

export interface GmailStatus {
  connected: boolean;
  connected_at: string | null;
  last_synced_at: string | null;
}

export interface SyncResult {
  emails_found: number;
  txns_created: number;
  stmts_created: number;
  errors: string[];
}
