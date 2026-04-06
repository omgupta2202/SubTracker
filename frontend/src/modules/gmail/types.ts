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
