import { useState, useEffect, useCallback } from "react";
import * as api from "@/services/api";
import type { EMI } from "@/types";

export function useEmis() {
  const [emis, setEmis] = useState<EMI[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      setEmis(await api.getEmis());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load EMIs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetch(); }, [fetch]);

  return { emis, loading, error, refetch: fetch };
}
