import { useState, useEffect, useCallback } from "react";
import * as api from "@/services/api";
import type { Receivable } from "@/types";

export function useReceivables() {
  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      setReceivables(await api.getReceivables());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load receivables");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetch(); }, [fetch]);
  return { receivables, loading, error, refetch: fetch };
}
