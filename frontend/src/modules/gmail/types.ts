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

export interface RecurringSuggestion {
  merchant_key: string;
  display_name: string;
  frequency: "weekly" | "monthly" | "quarterly" | "yearly";
  occurrences: number;
  average_amount: number;
  amount_variation: number;
  first_seen: string;
  last_seen: string;
  sample_account: string | null;
}
