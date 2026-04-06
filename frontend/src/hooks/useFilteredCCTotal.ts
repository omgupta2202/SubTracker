import { useState, useEffect, useCallback } from "react";
import * as api from "@/services/api";
import type { DashboardFilters } from "@/types";

export type { PeriodSummary } from "@/services/api";

export function usePeriodSummary(filters: DashboardFilters, active: boolean) {
  const [summary,  setSummary] = useState<api.PeriodSummary | null>(null);
  const [loading,  setLoading] = useState(false);

  const fetch = useCallback(async () => {
    if (!active) { setSummary(null); return; }
    setLoading(true);
    try {
      const res = await api.getPeriodSummary({
        dateTo: filters.asOfDate || undefined,
      });
      setSummary(res);
    } catch (e) {
      console.error(e);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [filters, active]);

  useEffect(() => { void fetch(); }, [fetch]);

  return { summary, loading, refetch: fetch };
}
