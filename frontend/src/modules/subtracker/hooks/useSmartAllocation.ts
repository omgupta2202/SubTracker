import { useState, useEffect, useCallback } from "react";
import * as api from "@/modules/subtracker/services/api";
import type { SmartAllocationResponse } from "@/modules/subtracker/types";

export function useSmartAllocation() {
  const [data, setData] = useState<SmartAllocationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      setData(await api.getSmartAllocation());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load allocation");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetch(); }, [fetch]);
  return { data, loading, error, refetch: fetch };
}
