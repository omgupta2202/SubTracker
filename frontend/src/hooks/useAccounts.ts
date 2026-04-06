import { useState, useEffect, useCallback } from "react";
import * as api from "@/services/api";
import type { BankAccount } from "@/types";

export function useAccounts() {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      setAccounts(await api.getAccounts());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetch(); }, [fetch]);
  return { accounts, loading, error, refetch: fetch };
}
