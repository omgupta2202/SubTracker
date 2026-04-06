import { useState, useEffect, useCallback } from "react";
import * as api from "@/services/api";
import type { Subscription } from "@/types";

export function useSubscriptions() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      setSubscriptions(await api.getSubscriptions());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load subscriptions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetch(); }, [fetch]);

  return { subscriptions, loading, error, refetch: fetch };
}
