import { useMemo, useState } from "react";
import { FileText, CalendarClock, ArrowLeft, Plus, X, Loader2 } from "lucide-react";
import type { CreditCard } from "@/types";
import * as api from "@/services/api";
import { formatINR } from "@/lib/utils";
import { useCardTransactions } from "@/hooks/useCardTransactions";
import { useToast } from "@/components/ToastProvider";

const inputCls =
  "bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-100 " +
  "focus:outline-none focus:border-violet-500 transition-all w-full placeholder:text-zinc-600";
const fieldLabelCls = "text-[11px] uppercase tracking-wider text-zinc-500";

interface Props {
  card: CreditCard;
  onBack?: () => void;
  defaultAddingBill?: boolean;
}
type CcTab = "overview" | "cycles" | "transactions";

function toDisplayDate(s: string) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN");
}

export function CardTransactionPanel({ card, onBack, defaultAddingBill = false }: Props) {
  const toast = useToast();
  const { entries, cycles, currentCycle, lastStatement, pastStatements, currentBalance, loading, refetch } = useCardTransactions(card.id);
  const [tab, setTab] = useState<CcTab>(defaultAddingBill ? "cycles" : "overview");
  const [editingCycleId, setEditingCycleId] = useState<string | null>(null);
  const [addingEntry, setAddingEntry] = useState(false);
  const [addingStatement, setAddingStatement] = useState(defaultAddingBill);
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [entryAmount, setEntryAmount] = useState("");
  const [entryDescription, setEntryDescription] = useState("");
  const [billStatementPeriod, setBillStatementPeriod] = useState<"current" | "last">("current");
  const [billTotal, setBillTotal] = useState("");
  const [billMinDue, setBillMinDue] = useState("");
  const [editStatementDate, setEditStatementDate] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editTotalBilled, setEditTotalBilled] = useState("");
  const [editMinDue, setEditMinDue] = useState("");

  const openCycles = useMemo(
    () => cycles.filter(c => !c.is_closed),
    [cycles]
  );
  const historyCycles = useMemo(
    () => (pastStatements?.length ? pastStatements.slice(0, 8) : cycles.filter(c => c.is_closed).slice(0, 8)),
    [pastStatements, cycles]
  );
  const billedDueTotalFromCycles = useMemo(
    () =>
      cycles
        .filter(c => c.is_closed)
        .reduce((sum, c) => {
          const due = Number(c.balance_due ?? (Number(c.total_billed || 0) - Number(c.total_paid || 0)));
          return sum + Math.max(due, 0);
        }, 0),
    [cycles]
  );
  const unbilledTotalFromCycles = useMemo(
    () =>
      openCycles.reduce((sum, c) => {
        const unbilled = Number(c.balance_due ?? c.total_billed ?? 0);
        return sum + Math.max(unbilled, 0);
      }, 0),
    [openCycles]
  );
  const derivedOutstanding = useMemo(() => billedDueTotalFromCycles + unbilledTotalFromCycles, [billedDueTotalFromCycles, unbilledTotalFromCycles]);
  const displayedOutstanding = useMemo(() => {
    if (cycles.length === 0) return currentBalance;
    return derivedOutstanding;
  }, [cycles.length, currentBalance, derivedOutstanding]);
  const latestClosedStatementDate = useMemo(() => {
    const dates = cycles
      .filter(c => c.is_closed && c.statement_date)
      .map(c => new Date(c.statement_date).getTime())
      .filter(Number.isFinite);
    if (dates.length === 0) return null;
    return new Date(Math.max(...dates));
  }, [cycles]);

  const debitEntries = useMemo(
    () => entries.filter(e => e.direction === "debit"),
    [entries]
  );
  const creditEntries = useMemo(
    () => entries.filter(e => e.direction === "credit"),
    [entries]
  );

  const billedEntries = useMemo(
    () => debitEntries.filter(e => {
      if (e.is_billed) return true;
      if (!latestClosedStatementDate) return false;
      const d = new Date(e.effective_date);
      return Number.isFinite(d.getTime()) && d <= latestClosedStatementDate;
    }),
    [debitEntries, latestClosedStatementDate]
  );
  const unbilledEntries = useMemo(
    () => debitEntries.filter(e => {
      if (e.is_billed) return false;
      if (!latestClosedStatementDate) return true;
      const d = new Date(e.effective_date);
      return Number.isFinite(d.getTime()) && d > latestClosedStatementDate;
    }),
    [debitEntries, latestClosedStatementDate]
  );
  async function handleAddBill() {
    if (!billTotal) return;
    try {
      await api.createBillingCycleForCard(card.id, {
        statement_period: billStatementPeriod,
        total_billed: Number(billTotal),
        minimum_due: billMinDue ? Number(billMinDue) : undefined,
      });
      setAddingStatement(false);
      setBillStatementPeriod("current");
      setBillTotal("");
      setBillMinDue("");
      void refetch();
      toast.success("Statement saved");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save statement";
      toast.error(msg);
    }
  }

  async function handleAddEntry() {
    if (!entryDate || !entryAmount || !entryDescription) return;
    try {
      await api.createLedgerEntry({
        account_id: card.id,
        direction: "debit",
        amount: Number(entryAmount),
        description: entryDescription,
        effective_date: entryDate,
        category: "card_spend",
      });
      setAddingEntry(false);
      setEntryAmount("");
      setEntryDescription("");
      void refetch();
      toast.success("Transaction entry saved");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save entry";
      toast.error(msg);
    }
  }

  async function handleUpdateCycle(cycleId: string) {
    if (!editStatementDate || !editDueDate) return;
    try {
      await api.updateBillingCycle(cycleId, {
        statement_date: editStatementDate,
        due_date: editDueDate,
        total_billed: editTotalBilled ? Number(editTotalBilled) : undefined,
        minimum_due: editMinDue ? Number(editMinDue) : undefined,
      });
      setEditingCycleId(null);
      void refetch();
      toast.success("Cycle updated");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to update cycle";
      toast.error(msg);
    }
  }

  async function handleDeleteCycle(cycleId: string) {
    if (!window.confirm("Delete this cycle? Linked transactions will become unbilled.")) return;
    try {
      await api.deleteBillingCycle(cycleId);
      if (editingCycleId === cycleId) setEditingCycleId(null);
      void refetch();
      toast.success("Cycle deleted");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to delete cycle";
      toast.error(msg);
    }
  }

  async function markCyclePaid(cycleId: string, totalBilledValue: number) {
    try {
      await api.updateBillingCycle(cycleId, { total_paid: Math.max(Number(totalBilledValue || 0), 0) });
      void refetch();
      toast.success("Statement marked as paid");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to mark statement paid";
      toast.error(msg);
    }
  }

  async function markCycleUnpaid(cycleId: string) {
    try {
      await api.updateBillingCycle(cycleId, { total_paid: 0 });
      void refetch();
      toast.success("Statement marked as unpaid");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to mark statement unpaid";
      toast.error(msg);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {onBack && (
        <div className="flex items-center justify-between">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            <ArrowLeft size={13} />
            Back to cards
          </button>
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200 transition-colors"
            aria-label="Close card activity"
            title="Close"
          >
            <X size={13} />
            Close
          </button>
        </div>
      )}

      <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Current Outstanding</p>
          <div className="flex items-center gap-2">
            <p className="font-mono text-sm text-zinc-500">{cycles.length > 0 ? "cycle-derived" : "ledger"}</p>
            <button
              onClick={() => { setTab("cycles"); setAddingStatement(v => !v); }}
              className="inline-flex items-center gap-1.5 text-xs bg-zinc-700/40 border border-zinc-600/40 text-zinc-300 hover:bg-zinc-700/60 transition-colors px-2.5 py-1 rounded-lg"
            >
              {addingStatement ? <X size={12} /> : <Plus size={12} />}
              {addingStatement ? "Cancel" : "Add Manual Statement"}
            </button>
          </div>
        </div>
        <p className="font-mono text-2xl font-bold text-red-400 mt-1">{formatINR(displayedOutstanding)}</p>
        <p className="text-xs text-zinc-500 mt-1">
          {card.name}{card.last4 ? ` ···· ${card.last4}` : ""}{card.bank ? ` · ${card.bank}` : ""}
        </p>
      </div>

      <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/40 p-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 bg-zinc-800 rounded-lg p-0.5 border border-zinc-700">
          <button
            onClick={() => { setTab("overview"); setAddingEntry(false); setAddingStatement(false); }}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${tab === "overview" ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
          >
            Overview
          </button>
          <button
            onClick={() => { setTab("cycles"); setAddingEntry(false); }}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${tab === "cycles" ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
          >
            Cycles
          </button>
          <button
            onClick={() => { setTab("transactions"); setAddingStatement(false); }}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${tab === "transactions" ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
          >
            Transactions
          </button>
        </div>
        {tab === "transactions" && (
          <button
            onClick={() => setAddingEntry(v => !v)}
            className="inline-flex items-center gap-1.5 text-xs bg-violet-600/20 border border-violet-500/40 text-violet-300 hover:bg-violet-600/30 transition-colors px-2.5 py-1 rounded-lg"
          >
            {addingEntry ? <X size={12} /> : <Plus size={12} />}
            {addingEntry ? "Cancel Entry" : "Add Manual Entry"}
          </button>
        )}
      </div>

      {tab === "overview" && (
        <>
          {(currentCycle || lastStatement) && (
            <div className="rounded-xl border border-zinc-700/50 overflow-hidden">
              <div className="px-4 py-3 bg-zinc-800/60">
                <p className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Cycle Overview</p>
              </div>
              <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-amber-300">Current Cycle (Unbilled)</p>
                  {currentCycle ? (
                    <>
                      <p className="text-xs text-zinc-400 mt-1">
                        {toDisplayDate(currentCycle.cycle_start ?? "")} to {toDisplayDate(currentCycle.cycle_end ?? "")}
                      </p>
                      <p className="font-mono text-sm text-amber-300 mt-1">{formatINR(Number(currentCycle.total_billed || 0))}</p>
                    </>
                  ) : <p className="text-xs text-zinc-500 mt-1">No open cycle</p>}
                </div>
                <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/40 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-zinc-300">Last Statement</p>
                  {lastStatement ? (
                    <>
                      <p className="text-xs text-zinc-400 mt-1">{toDisplayDate(lastStatement.statement_date)} · due {toDisplayDate(lastStatement.due_date)}</p>
                      <p className="font-mono text-sm text-zinc-200 mt-1">{formatINR(Number(lastStatement.total_billed || 0))}</p>
                    </>
                  ) : <p className="text-xs text-zinc-500 mt-1">No closed statements yet</p>}
                </div>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-zinc-700/50 overflow-hidden">
            <div className="px-4 py-3 bg-zinc-800/60 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText size={14} className="text-violet-400" />
                <p className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Spend Snapshot</p>
              </div>
            </div>
            <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wider text-red-300">Billed (Due)</p>
                <p className="font-mono text-sm text-red-300 mt-0.5">{formatINR(billedDueTotalFromCycles)}</p>
              </div>
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wider text-amber-300">Unbilled</p>
                <p className="font-mono text-sm text-amber-300 mt-0.5">{formatINR(unbilledTotalFromCycles)}</p>
              </div>
            </div>
          </div>
        </>
      )}

      {tab === "cycles" && (
      <div className="rounded-xl border border-zinc-700/50 overflow-hidden">
        <div className="px-4 py-3 bg-zinc-800/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarClock size={14} className="text-violet-400" />
            <p className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Statements</p>
          </div>
          <span className="text-xs text-zinc-600">{openCycles.length} open</span>
        </div>
        <div className="p-3 flex flex-col gap-2">
          {addingEntry && (
            <div className="rounded-lg border border-violet-500/30 bg-zinc-900/40 p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-violet-300">Add Manual Card Entry</p>
                <button
                  onClick={() => setAddingEntry(false)}
                  className="text-zinc-500 hover:text-zinc-200 transition-colors"
                  aria-label="Close manual entry form"
                  title="Close"
                >
                  <X size={13} />
                </button>
              </div>
              <p className="text-[11px] text-zinc-500 mb-2">
                Use transaction date only. Billed vs unbilled is auto-determined from your card billing cycle.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <label className={fieldLabelCls}>Transaction Date</label>
                  <input
                    className={inputCls}
                    type="date"
                    value={entryDate}
                    onChange={e => setEntryDate(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className={fieldLabelCls}>Amount</label>
                  <input
                    className={inputCls}
                    type="number"
                    placeholder="Amount ₹"
                    value={entryAmount}
                    onChange={e => setEntryAmount(e.target.value)}
                  />
                </div>
                <div className="sm:col-span-2 flex flex-col gap-1">
                  <label className={fieldLabelCls}>Description</label>
                  <input
                    className="sm:col-span-2 bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-violet-500 transition-all w-full placeholder:text-zinc-600"
                    value={entryDescription}
                    onChange={e => setEntryDescription(e.target.value)}
                    placeholder="Description (merchant/spend note)"
                  />
                </div>
                <button
                  onClick={() => void handleAddEntry()}
                  className="col-span-1 bg-violet-600 hover:bg-violet-500 text-white py-2 rounded-lg text-xs font-semibold transition-colors"
                >
                  Save Entry
                </button>
                <button
                  onClick={() => setAddingEntry(false)}
                  className="col-span-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 py-2 rounded-lg text-xs transition-colors"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
          {addingStatement && (
            <div className="rounded-lg border border-violet-500/30 bg-zinc-900/40 p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-violet-300">Add Manual Statement</p>
                <button
                  onClick={() => setAddingStatement(false)}
                  className="text-zinc-500 hover:text-zinc-200 transition-colors"
                  aria-label="Close manual bill form"
                  title="Close"
                >
                  <X size={13} />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] uppercase tracking-wider text-zinc-500">Statement Period</label>
                <select
                  className={inputCls}
                  value={billStatementPeriod}
                  onChange={e => setBillStatementPeriod((e.target.value as "current" | "last"))}
                >
                  <option value="current">Current Cycle Month</option>
                  <option value="last">Last Cycle Month</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className={fieldLabelCls}>Auto Dates</label>
                <div className="min-h-[40px] rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-400 flex items-center">
                  Statement date from card billing day. Due date auto +20 days (or card setting).
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className={fieldLabelCls}>Total Billed</label>
                <input
                  className={inputCls}
                  type="number"
                  placeholder="Total billed ₹"
                  value={billTotal}
                  onChange={e => setBillTotal(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className={fieldLabelCls}>Minimum Due (Optional)</label>
                <input
                  className={inputCls}
                  type="number"
                  placeholder="Minimum due ₹ (optional)"
                  value={billMinDue}
                  onChange={e => setBillMinDue(e.target.value)}
                />
              </div>
              <div className="sm:col-span-2 text-[11px] text-zinc-500">
                Cycle start/end will be auto-derived from statement date and card billing day.
              </div>
              <button
                onClick={() => void handleAddBill()}
                className="col-span-1 bg-violet-600 hover:bg-violet-500 text-white py-2 rounded-lg text-xs font-semibold transition-colors"
              >
                Save Statement
              </button>
              <button
                onClick={() => setAddingStatement(false)}
                className="col-span-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 py-2 rounded-lg text-xs transition-colors"
              >
                Dismiss
              </button>
              </div>
            </div>
          )}
          {openCycles.length === 0 ? (
            <p className="text-xs text-zinc-600">No open billing cycles.</p>
          ) : openCycles.map(c => (
            <div key={c.id} className="rounded-lg border border-zinc-700/50 bg-zinc-900/40 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-zinc-200 font-medium">Statement {toDisplayDate(c.statement_date)}</p>
                <p className="font-mono text-sm text-red-400">{formatINR(Number(c.balance_due))}</p>
              </div>
              <p className="text-xs text-zinc-500 mt-0.5">
                Due {toDisplayDate(c.due_date)} · Min {formatINR(Number(c.minimum_due))}
              </p>

              {editingCycleId === c.id ? (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <label className={fieldLabelCls}>Statement Date</label>
                    <input className={inputCls} type="date" value={editStatementDate} onChange={e => setEditStatementDate(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className={fieldLabelCls}>Due Date</label>
                    <input className={inputCls} type="date" value={editDueDate} onChange={e => setEditDueDate(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className={fieldLabelCls}>Total Billed</label>
                    <input className={inputCls} type="number" placeholder="Total billed ₹" value={editTotalBilled} onChange={e => setEditTotalBilled(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className={fieldLabelCls}>Minimum Due</label>
                    <input className={inputCls} type="number" placeholder="Minimum due ₹" value={editMinDue} onChange={e => setEditMinDue(e.target.value)} />
                  </div>
                  <button
                    onClick={() => void handleUpdateCycle(c.id)}
                    className="col-span-1 bg-violet-600 hover:bg-violet-500 text-white py-2 rounded-lg text-xs font-semibold transition-colors"
                  >
                    Save Changes
                  </button>
                  <button
                    onClick={() => setEditingCycleId(null)}
                    className="col-span-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 py-2 rounded-lg text-xs transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="mt-3 flex items-center gap-3">
                  <button
                    onClick={() => {
                      setEditingCycleId(c.id);
                      setEditStatementDate((c.statement_date ?? "").slice(0, 10));
                      setEditDueDate((c.due_date ?? "").slice(0, 10));
                      setEditTotalBilled(String(c.total_billed ?? ""));
                      setEditMinDue(String(c.minimum_due ?? ""));
                    }}
                    className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
                  >
                    Edit statement
                  </button>
                  <button
                    onClick={() => void handleDeleteCycle(c.id)}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    Delete cycle
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      )}

      {tab === "transactions" && (
      <div className="rounded-xl border border-zinc-700/50 overflow-hidden">
        <div className="px-4 py-3 bg-zinc-800/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-violet-400" />
            <p className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Card Transactions</p>
          </div>
          <span className="text-xs text-zinc-600">{debitEntries.length}</span>
        </div>
        <div className="divide-y divide-zinc-800/60">
          {loading ? (
            <div className="h-20 bg-zinc-800/30 flex items-center justify-center">
              <Loader2 size={18} className="text-violet-400 animate-spin" />
            </div>
          ) : (
            <>
              <div className="px-4 py-2 bg-zinc-900/40">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-red-300">
                  Billed Transactions ({billedEntries.length})
                </p>
              </div>
              {billedEntries.length === 0 ? (
                <p className="text-xs text-zinc-600 px-4 py-3">No billed transactions yet.</p>
              ) : billedEntries.map(e => (
                <div key={e.id} className="px-4 py-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-sm text-zinc-200">{e.description}</p>
                    <p className="text-xs text-zinc-600">{toDisplayDate(e.effective_date)} · {e.category}</p>
                  </div>
                  <p className="font-mono text-sm text-red-400">−{formatINR(Number(e.amount))}</p>
                </div>
              ))}

              <div className="px-4 py-2 bg-zinc-900/40 border-t border-zinc-800/60">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
                  Unbilled Transactions ({unbilledEntries.length})
                </p>
              </div>
              {unbilledEntries.length === 0 ? (
                <p className="text-xs text-zinc-600 px-4 py-3">No unbilled transactions.</p>
              ) : unbilledEntries.map(e => (
                <div key={e.id} className="px-4 py-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-sm text-zinc-200">{e.description}</p>
                    <p className="text-xs text-zinc-600">{toDisplayDate(e.effective_date)} · {e.category}</p>
                  </div>
                  <p className="font-mono text-sm text-amber-300">−{formatINR(Number(e.amount))}</p>
                </div>
              ))}

              {creditEntries.length > 0 && (
                <>
                  <div className="px-4 py-2 bg-zinc-900/40 border-t border-zinc-800/60">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
                      Payments / Credits ({creditEntries.length})
                    </p>
                  </div>
                  {creditEntries.map(e => (
                    <div key={e.id} className="px-4 py-2.5 flex items-center justify-between">
                      <div>
                        <p className="text-sm text-zinc-200">{e.description}</p>
                        <p className="text-xs text-zinc-600">{toDisplayDate(e.effective_date)} · {e.category}</p>
                      </div>
                      <p className="font-mono text-sm text-emerald-400">+{formatINR(Number(e.amount))}</p>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
      )}

      {tab === "cycles" && historyCycles.length > 0 && (
        <div className="rounded-xl border border-zinc-700/50 overflow-hidden">
          <div className="px-4 py-3 bg-zinc-800/60">
            <p className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Closed Cycles</p>
          </div>
          <div className="divide-y divide-zinc-800/60">
            {historyCycles.map(c => (
              <div key={c.id} className="px-4 py-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-zinc-400">
                      {toDisplayDate(c.statement_date)} · due {toDisplayDate(c.due_date)}
                    </p>
                    <span className={`inline-block mt-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                      c.statement_status === "paid"
                        ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
                        : c.statement_status === "partial"
                          ? "text-amber-300 border-amber-500/30 bg-amber-500/10"
                          : "text-red-300 border-red-500/30 bg-red-500/10"
                    }`}>
                      {c.statement_status ?? (Number(c.balance_due) <= 0 ? "paid" : "unpaid")}
                    </span>
                  </div>
                  <p className="font-mono text-xs text-zinc-300">{formatINR(Number(c.total_billed))}</p>
                </div>

                {editingCycleId === c.id ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <label className={fieldLabelCls}>Statement Date</label>
                      <input className={inputCls} type="date" value={editStatementDate} onChange={e => setEditStatementDate(e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className={fieldLabelCls}>Due Date</label>
                      <input className={inputCls} type="date" value={editDueDate} onChange={e => setEditDueDate(e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className={fieldLabelCls}>Total Billed</label>
                      <input className={inputCls} type="number" placeholder="Total billed ₹" value={editTotalBilled} onChange={e => setEditTotalBilled(e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className={fieldLabelCls}>Minimum Due</label>
                      <input className={inputCls} type="number" placeholder="Minimum due ₹" value={editMinDue} onChange={e => setEditMinDue(e.target.value)} />
                    </div>
                    <button
                      onClick={() => void handleUpdateCycle(c.id)}
                      className="col-span-1 bg-violet-600 hover:bg-violet-500 text-white py-2 rounded-lg text-xs font-semibold transition-colors"
                    >
                      Save Changes
                    </button>
                    <button
                      onClick={() => setEditingCycleId(null)}
                      className="col-span-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 py-2 rounded-lg text-xs transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="mt-2 flex items-center gap-3">
                    {Number(c.balance_due) > 0 ? (
                      <button
                        onClick={() => void markCyclePaid(c.id, Number(c.total_billed))}
                        className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                      >
                        Mark Paid
                      </button>
                    ) : (
                      <button
                        onClick={() => void markCycleUnpaid(c.id)}
                        className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
                      >
                        Mark Unpaid
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setEditingCycleId(c.id);
                        setEditStatementDate((c.statement_date ?? "").slice(0, 10));
                        setEditDueDate((c.due_date ?? "").slice(0, 10));
                        setEditTotalBilled(String(c.total_billed ?? ""));
                        setEditMinDue(String(c.minimum_due ?? ""));
                      }}
                      className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
                    >
                      Edit statement
                    </button>
                    <button
                      onClick={() => void handleDeleteCycle(c.id)}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors"
                    >
                      Delete cycle
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
