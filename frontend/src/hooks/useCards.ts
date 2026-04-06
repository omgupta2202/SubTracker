import { useState, useEffect, useCallback } from "react";
import * as api from "@/services/api";
import type { CreditCard } from "@/types";

export function useCards() {
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      setCards(await api.getCards());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load cards");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetch(); }, [fetch]);

  return { cards, loading, error, refetch: fetch };
}
