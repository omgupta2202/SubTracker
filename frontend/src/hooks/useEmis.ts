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
      const rows = await api.getObligations("emi");
      setEmis(rows.map(r => ({
        id: r.id,
        name: r.name,
        lender: r.lender ?? "Lender",
        amount: r.amount,
        total_months: r.total_installments ?? 0,
        paid_months: r.completed_installments ?? 0,
        due_day: r.due_day ?? 1,
        principal: r.principal ?? null,
        interest_rate: r.interest_rate ?? null,
        emi_math: r.emi_math ?? null,
      })));
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
