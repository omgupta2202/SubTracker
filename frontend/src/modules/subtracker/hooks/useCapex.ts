import { useState, useEffect, useCallback } from "react";
import * as api from "@/modules/subtracker/services/api";
import type { CapExItem } from "@/modules/subtracker/types";

export function useCapex() {
  const [capex, setCapex] = useState<CapExItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      setCapex(await api.getCapex());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load capex");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetch(); }, [fetch]);
  return { capex, loading, error, refetch: fetch };
}
