import { useState, useEffect, useCallback } from "react";
import * as api from "@/services/api";
import type { Rent } from "@/types";

export function useRent() {
  const [rent, setRent] = useState<Rent>({ amount: 0, due_day: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      const rows = await api.getObligations("rent");
      const current = rows[0];
      setRent(current ? { id: current.id, amount: current.amount, due_day: current.due_day ?? 1 } : { amount: 0, due_day: 1 });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load rent");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetch(); }, [fetch]);
  return { rent, loading, error, refetch: fetch };
}
