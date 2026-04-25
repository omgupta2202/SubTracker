import { useState, useEffect, useCallback } from "react";
import * as api from "@/services/api";
import type { DashboardFilters } from "@/types";

export type { PeriodSummary } from "@/services/api";

/** Skip the API call when the user is mid-typing a date (e.g. year=0002).
    The native date input fires onChange on every keystroke, so we'd
    otherwise hammer the backend with malformed values. */
function isPlausibleDate(s: string | undefined): boolean {
  if (!s) return true;            // empty is fine — backend treats as "no filter"
  const m = /^(\d{4})-\d{2}-\d{2}$/.exec(s);
  if (!m) return false;
  const yr = Number(m[1]);
  return yr >= 1900 && yr <= 2100;
}

export function usePeriodSummary(filters: DashboardFilters, active: boolean) {
  const [summary,  setSummary] = useState<api.PeriodSummary | null>(null);
  const [loading,  setLoading] = useState(false);

  const fetch = useCallback(async () => {
    if (!active) { setSummary(null); return; }
    if (!isPlausibleDate(filters.asOfDate)) { return; }
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

  // Debounce — bursty keystrokes shouldn't all fire requests.
  useEffect(() => {
    const t = setTimeout(() => { void fetch(); }, 250);
    return () => clearTimeout(t);
  }, [fetch]);

  return { summary, loading, refetch: fetch };
}
