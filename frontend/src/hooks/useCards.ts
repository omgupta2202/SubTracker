import { useState, useEffect, useCallback } from "react";
import * as api from "@/services/api";
import type { CreditCard } from "@/types";

function computeDueDateOffset(
  billingCycleDay: number | null | undefined,
  dueOffsetDays: number | null | undefined
): number {
  if (!billingCycleDay || !dueOffsetDays) return 0;
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();

  const statementDate = new Date(currentYear, currentMonth, billingCycleDay);
  if (statementDate < today) {
    statementDate.setMonth(statementDate.getMonth() + 1);
  }
  const dueDate = new Date(statementDate);
  dueDate.setDate(dueDate.getDate() + dueOffsetDays);

  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((dueDate.getTime() - today.getTime()) / msPerDay));
}

export function useCards() {
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      const rows = await api.getFinancialAccounts("credit_card");
      setCards(rows.map(r => ({
        id: r.id,
        name: r.name,
        bank: r.institution || "Card",
        last4: r.last4 ?? "",
        outstanding: r.outstanding ?? 0,
        minimum_due: r.minimum_due ?? 0,
        credit_limit: r.credit_limit ?? undefined,
        due_day: r.billing_cycle_day ?? null,
        due_date_offset: computeDueDateOffset(r.billing_cycle_day, r.due_offset_days),
      })));
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
