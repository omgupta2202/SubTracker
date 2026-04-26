import { useState, useEffect, useCallback } from "react";
import * as api from "@/modules/subtracker/services/api";

interface LedgerFilters {
  dateFrom?: string;
  dateTo?: string;
}

export function useCardTransactions(cardId: string | null, filters: LedgerFilters = {}) {
  const [entries, setEntries] = useState<api.AccountLedgerEntry[]>([]);
  const [cycles, setCycles] = useState<api.BillingCycle[]>([]);
  const [currentCycle, setCurrentCycle] = useState<api.BillingCycle | null>(null);
  const [lastStatement, setLastStatement] = useState<api.BillingCycle | null>(null);
  const [pastStatements, setPastStatements] = useState<api.BillingCycle[]>([]);
  const [currentBalance, setCurrentBalance] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    if (!cardId) return;
    setLoading(true);
    try {
      const [ledger, billingCycles, overview] = await Promise.all([
        api.getFinancialAccountLedger(cardId, {
          limit: 100,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
        }),
        api.getBillingCycles({ accountId: cardId, limit: 24 }),
        api.getBillingCycleOverview(cardId),
      ]);
      setEntries(ledger.entries);
      setCurrentBalance(ledger.current_balance);
      setCycles(billingCycles);
      setCurrentCycle(overview.current_cycle);
      setLastStatement(overview.last_statement);
      setPastStatements(overview.past_statements ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [cardId, filters.dateFrom, filters.dateTo]);

  useEffect(() => { void fetch(); }, [fetch]);

  return { entries, cycles, currentCycle, lastStatement, pastStatements, currentBalance, loading, refetch: fetch };
}
