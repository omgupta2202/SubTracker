import { useState, useEffect, useCallback } from "react";
import * as api from "@/modules/subtracker/services/api";
import type { DashboardSummary } from "@/modules/subtracker/types";

export function useDashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      setSummary(await api.getDashboardSummary());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetch(); }, [fetch]);
  return { summary, loading, error, refetch: fetch };
}
