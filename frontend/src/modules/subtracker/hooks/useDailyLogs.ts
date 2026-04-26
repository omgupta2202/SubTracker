import { useEffect, useState, useCallback } from "react";
import * as api from "@/modules/subtracker/services/api";
import type { DailyLogMeta } from "@/modules/subtracker/types";

/** Lightweight fetch of recent daily snapshots — used by sparklines. */
export function useDailyLogs(limit: number = 30) {
  const [logs, setLogs] = useState<DailyLogMeta[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      const rows = await api.getDailyLogs(limit);
      // API returns newest-first; sparkline expects oldest→newest left to right.
      setLogs([...rows].reverse());
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => { void fetch(); }, [fetch]);
  return { logs, loading, refetch: fetch };
}
