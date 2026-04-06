import { useState, useEffect, useCallback } from "react";
import * as api from "@/services/api";
import type { CardTransaction, CardStatement } from "@/types";

export function useCardTransactions(cardId: string | null) {
  const [transactions, setTransactions] = useState<CardTransaction[]>([]);
  const [statements,   setStatements]   = useState<CardStatement[]>([]);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    if (!cardId) return;
    setLoading(true);
    try {
      const [txns, stmts] = await Promise.all([
        api.getCardTransactions(cardId),
        api.getCardStatements(cardId),
      ]);
      setTransactions(txns);
      setStatements(stmts);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [cardId]);

  useEffect(() => { void fetch(); }, [fetch]);

  return { transactions, statements, loading, refetch: fetch };
}
