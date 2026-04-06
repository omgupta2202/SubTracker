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
      const rows = await api.getObligations("subscription");
      setSubscriptions(rows.map(r => ({
        id: r.id,
        name: r.name,
        amount: r.amount,
        billing_cycle: (r.frequency === "monthly" || r.frequency === "weekly" || r.frequency === "yearly")
          ? r.frequency
          : "monthly",
        due_day: r.due_day ?? 1,
        category: "Recurring",
      })));
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
