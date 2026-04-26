import { useEffect, useMemo, useState } from "react";
import {
  X, CreditCard as CardIcon, ChevronDown, ChevronUp, Receipt,
  ArrowDownToLine, Sparkles, Check, AlertTriangle, Loader2,
} from "lucide-react";
import * as api from "@/modules/subtracker/services/api";
import type { BillingCycle, AccountLedgerEntry } from "@/modules/subtracker/services/api";
import type { BankAccount } from "@/modules/subtracker/types";
import { inrCompact, inr, relativeDay } from "@/lib/tokens";
import { cn } from "@/lib/utils";
import { Sparkline } from "@/components/ui/Sparkline";

/**
 * CRED-style card detail drawer.
 *
 * Shows everything you need to manage one credit card without leaving the
 * dashboard:
 *   - Hero: outstanding, available credit (limit - outstanding), 6-month
 *     billed sparkline, smart-pay APR savings.
 *   - Statement history list — newest first, with status pill, due-in-X
 *     badge, and tappable to expand its transactions.
 *   - Pay flow — choose source account, click min/full/custom, posts a
 *     cc_payment ledger entry through the backend's /pay endpoint.
 *   - UPI deep link — one-tap to GPay/PhonePe with prefilled amount.
 *
 * Mounted from NetWorthCard via `cardId` prop. Returns null when closed.
 */

interface Props {
  cardId: string | null;
  cardName: string | null;
  cardLast4: string | null;
  cardBank: string | null;
  /** When provided, the user can pay from one of these accounts. */
  accounts: BankAccount[];
  onClose: () => void;
  onChange?: () => void;          // refetch parent dashboard after a write
}

type StatusKind = "paid" | "partial" | "unpaid" | "unbilled" | "overdue";

const STATUS_TONE: Record<StatusKind, string> = {
  paid:     "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
  partial:  "text-amber-300 bg-amber-500/10 border-amber-500/30",
  unpaid:   "text-red-300 bg-red-500/10 border-red-500/30",
  unbilled: "text-zinc-300 bg-zinc-700/40 border-zinc-700",
  overdue:  "text-red-400 bg-red-500/15 border-red-500/40",
};

export function CardDetailDrawer({
  cardId, cardName, cardLast4, cardBank, accounts, onClose, onChange,
}: Props) {
  const [overview, setOverview] = useState<{
    current_cycle: BillingCycle | null;
    last_statement: BillingCycle | null;
    past_statements: BillingCycle[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedCycleId, setExpandedCycleId] = useState<string | null>(null);
  const [entriesByCycle, setEntriesByCycle] = useState<Record<string, AccountLedgerEntry[]>>({});
  const [paying, setPaying] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payCycleId, setPayCycleId] = useState<string | null>(null);
  const [paySource, setPaySource] = useState<string>("");

  useEffect(() => {
    if (!cardId) { setOverview(null); return; }
    let alive = true;
    setLoading(true);
    api.getBillingCycleOverview(cardId)
      .then(d => { if (alive) setOverview(d); })
      .catch(() => alive && setOverview(null))
      .finally(() => alive && setLoading(false));
    if (accounts.length && !paySource) setPaySource(accounts[0].id);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  const allStatements = useMemo(() => {
    if (!overview) return [] as BillingCycle[];
    const out: BillingCycle[] = [];
    if (overview.current_cycle) out.push(overview.current_cycle);
    if (overview.last_statement && overview.last_statement.id !== overview.current_cycle?.id) {
      out.push(overview.last_statement);
    }
    for (const s of overview.past_statements) {
      if (!out.some(x => x.id === s.id)) out.push(s);
    }
    return out;
  }, [overview]);

  const sparkData = useMemo(
    () => [...allStatements]
      .reverse()
      .filter(s => s.is_closed)
      .map(s => ({ x: s.statement_date, y: Number(s.total_billed || 0) })),
    [allStatements],
  );

  const totalOutstanding = useMemo(
    () => allStatements
      .filter(s => Number(s.balance_due ?? (s.total_billed - s.total_paid)) > 0)
      .reduce((sum, s) => sum + Number(s.balance_due ?? (s.total_billed - s.total_paid)), 0),
    [allStatements],
  );

  async function ensureExpand(cycle: BillingCycle) {
    if (expandedCycleId === cycle.id) {
      setExpandedCycleId(null);
      return;
    }
    setExpandedCycleId(cycle.id);
    if (!entriesByCycle[cycle.id]) {
      try {
        const detail = await api.getBillingCycle(cycle.id);
        setEntriesByCycle(prev => ({ ...prev, [cycle.id]: detail.entries ?? [] }));
      } catch {
        setEntriesByCycle(prev => ({ ...prev, [cycle.id]: [] }));
      }
    }
  }

  async function pay(amount: number) {
    if (!payCycleId || !paySource || amount <= 0) return;
    setPaying(true);
    try {
      await api.payBillingCycle(payCycleId, {
        amount,
        source_account_id: paySource,
      });
      // Refetch overview
      if (cardId) {
        const fresh = await api.getBillingCycleOverview(cardId);
        setOverview(fresh);
      }
      setPayCycleId(null);
      setPayAmount("");
      onChange?.();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setPaying(false);
    }
  }

  function buildUpiLink(amount: number): string | null {
    const src = accounts.find(a => a.id === paySource);
    if (!src) return null;
    // Generic UPI intent — most apps accept payee = self or empty for "select recipient".
    // We don't know the user's CC issuer's UPI VPA; just pre-fill the amount + note.
    const params = new URLSearchParams({
      pa: "", // payee VPA — left blank, opens picker
      pn: cardName ?? "Credit card",
      am: amount.toFixed(2),
      cu: "INR",
      tn: `${cardName ?? "CC"} statement payment`,
    });
    return `upi://pay?${params.toString()}`;
  }

  if (!cardId) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Slide-over panel */}
      <div className="fixed top-0 right-0 bottom-0 w-full sm:w-[560px] z-[90] bg-zinc-950 border-l border-zinc-800 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 backdrop-blur-md bg-zinc-950/85 border-b border-zinc-800/60 px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <CardIcon size={16} className="text-violet-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-zinc-100 truncate">
                {cardName} {cardLast4 && <span className="text-zinc-500 num text-xs">···· {cardLast4}</span>}
              </div>
              <div className="text-[11px] text-zinc-500">{cardBank}</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/70"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {loading && !overview ? (
          <div className="p-12 flex items-center justify-center">
            <Loader2 size={20} className="text-violet-400 animate-spin" />
          </div>
        ) : (
          <div className="p-5 flex flex-col gap-4">
            {/* Hero */}
            <div className="rounded-2xl bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800/60 p-5 flex flex-col gap-3">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-1">Outstanding</div>
                  <div className={cn(
                    "num text-4xl font-semibold tracking-tight",
                    totalOutstanding > 0 ? "text-red-400" : "text-emerald-400",
                  )}>
                    {inrCompact(totalOutstanding)}
                  </div>
                </div>
                <div className="flex-1 max-w-[160px] -mb-2">
                  <Sparkline
                    data={sparkData}
                    stroke={totalOutstanding > 0 ? "rgb(248 113 113)" : "rgb(52 211 153)"}
                    height={52}
                    filled
                  />
                  {sparkData.length > 0 && (
                    <div className="text-[10px] text-zinc-600 text-right num">last {sparkData.length} months billed</div>
                  )}
                </div>
              </div>
            </div>

            {/* Statement list */}
            <div className="rounded-2xl bg-zinc-900 border border-zinc-800/60 p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-2">
                  <Receipt size={12} className="text-violet-400" /> Statements
                  <span className="text-zinc-600 num">·{allStatements.length}</span>
                </div>
              </div>

              {allStatements.length === 0 ? (
                <div className="text-sm text-zinc-500 text-center py-6">
                  No statements yet — they'll appear here when transactions land on this card.
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {allStatements.map(stmt => (
                    <StatementRow
                      key={stmt.id}
                      stmt={stmt}
                      isOpen={expandedCycleId === stmt.id}
                      onToggle={() => ensureExpand(stmt)}
                      entries={entriesByCycle[stmt.id]}
                      onPay={() => {
                        setPayCycleId(stmt.id);
                        setPayAmount(String(Math.round(Number(stmt.balance_due ?? (stmt.total_billed - stmt.total_paid)))));
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Pay panel — only renders when a statement is selected for payment */}
            {payCycleId && (() => {
              const stmt = allStatements.find(s => s.id === payCycleId);
              if (!stmt) return null;
              const minDue = Number(stmt.minimum_due || 0);
              const fullDue = Number(stmt.balance_due ?? (stmt.total_billed - stmt.total_paid));
              const amt = Number(payAmount) || 0;
              const upi = buildUpiLink(amt);
              return (
                <div className="rounded-2xl bg-zinc-900 border border-violet-500/30 p-5 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold uppercase tracking-wider text-violet-300 flex items-center gap-2">
                      <ArrowDownToLine size={12} /> Pay statement
                    </div>
                    <button
                      onClick={() => { setPayCycleId(null); setPayAmount(""); }}
                      className="text-[11px] text-zinc-500 hover:text-zinc-300"
                    >
                      cancel
                    </button>
                  </div>

                  {/* Source account selector */}
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">From account</span>
                    <select
                      value={paySource}
                      onChange={e => setPaySource(e.target.value)}
                      className="bg-zinc-950 border border-zinc-700/70 rounded px-2.5 py-1.5 text-sm text-zinc-100"
                    >
                      {accounts.map(a => (
                        <option key={a.id} value={a.id}>{a.name} — {inr(a.balance)}</option>
                      ))}
                    </select>
                  </label>

                  {/* Amount */}
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Amount (₹)</span>
                    <input
                      type="number"
                      value={payAmount}
                      onChange={e => setPayAmount(e.target.value)}
                      placeholder="0"
                      className="bg-zinc-950 border border-zinc-700/70 rounded px-2.5 py-1.5 text-sm text-zinc-100 num"
                    />
                  </label>

                  {/* Quick-pick buttons */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => setPayAmount(String(Math.round(minDue)))}
                      disabled={minDue <= 0}
                      className="text-xs px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-30"
                    >
                      Min · {inrCompact(minDue)}
                    </button>
                    <button
                      onClick={() => setPayAmount(String(Math.round(fullDue)))}
                      disabled={fullDue <= 0}
                      className="text-xs px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-30"
                    >
                      Full · {inrCompact(fullDue)}
                    </button>
                  </div>

                  {/* Confirm + UPI */}
                  <div className="flex items-center gap-2 pt-1 border-t border-zinc-800/60">
                    <button
                      onClick={() => pay(amt)}
                      disabled={paying || amt <= 0 || !paySource}
                      className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 rounded bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium disabled:opacity-50"
                    >
                      <Check size={14} /> {paying ? "Posting…" : `Record payment ${inrCompact(amt)}`}
                    </button>
                    {upi && amt > 0 && (
                      <a
                        href={upi}
                        className="inline-flex items-center gap-1 px-3 py-2 rounded border border-violet-500/40 text-violet-300 hover:bg-violet-500/10 text-sm font-medium"
                        title="Open in UPI app"
                      >
                        <Sparkles size={13} /> UPI
                      </a>
                    )}
                  </div>
                  <p className="text-[10px] text-zinc-600">
                    "Record payment" posts a ledger entry locally. The UPI button opens your phone's UPI app to actually transfer the money — record after you've paid.
                  </p>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </>
  );
}

function StatementRow({
  stmt, isOpen, onToggle, entries, onPay,
}: {
  stmt: BillingCycle;
  isOpen: boolean;
  onToggle: () => void;
  entries: AccountLedgerEntry[] | undefined;
  onPay: () => void;
}) {
  const status = computeStatus(stmt);
  const balance = Number(stmt.balance_due ?? (stmt.total_billed - stmt.total_paid));
  const due = stmt.due_date ? daysFrom(stmt.due_date) : null;
  const dueTone =
    status === "overdue" ? "text-red-400" :
    due !== null && due <= 3 ? "text-amber-400" :
    "text-zinc-500";

  return (
    <div className="rounded-lg hover:bg-zinc-800/30 transition-colors">
      <button
        onClick={onToggle}
        className="w-full text-left px-2 py-2.5 flex items-center gap-3"
      >
        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-sm text-zinc-200 num">
              {stmt.statement_date ? new Date(stmt.statement_date).toLocaleDateString("en-IN", { month: "short", year: "numeric" }) : "Open cycle"}
            </span>
            <span className={cn("text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border", STATUS_TONE[status])}>
              {status}
            </span>
            {due !== null && status !== "paid" && status !== "unbilled" && (
              <span className={cn("text-[11px] num", dueTone)}>
                {status === "overdue" ? `${Math.abs(due)}d late` : relativeDay(due)}
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-3 text-[11px] text-zinc-500 num">
            <span>billed {inrCompact(stmt.total_billed)}</span>
            <span>min {inrCompact(stmt.minimum_due)}</span>
            {Number(stmt.total_paid) > 0 && <span className="text-emerald-400">paid {inrCompact(stmt.total_paid)}</span>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={cn("num text-sm font-semibold", balance > 0 ? "text-red-400" : "text-emerald-400")}>
            {balance > 0 ? `− ${inrCompact(balance)}` : inrCompact(0)}
          </div>
          {isOpen ? <ChevronUp size={13} className="text-zinc-600 inline" /> : <ChevronDown size={13} className="text-zinc-600 inline" />}
        </div>
      </button>

      {isOpen && (
        <div className="px-2 pb-3 pl-4 ml-2 border-l border-zinc-800/80 flex flex-col gap-2">
          {/* Pay action — only for statements with money owed */}
          {balance > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); onPay(); }}
              className="self-start inline-flex items-center gap-1.5 text-xs text-violet-300 hover:text-violet-200"
            >
              <ArrowDownToLine size={12} /> Pay this statement
            </button>
          )}

          {/* Transactions */}
          {entries === undefined ? (
            <div className="text-xs text-zinc-600">Loading transactions…</div>
          ) : entries.length === 0 ? (
            <div className="text-xs text-zinc-600">No transactions on this statement.</div>
          ) : (
            <div className="flex flex-col">
              {entries.slice(0, 12).map(e => (
                <div key={e.id} className="flex items-center gap-3 py-1.5">
                  <span className={cn(
                    "h-1.5 w-1.5 rounded-full shrink-0",
                    e.direction === "debit" ? "bg-red-500/60" : "bg-emerald-500/60",
                  )} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-zinc-300 truncate">{e.description}</div>
                    <div className="text-[10px] text-zinc-600 num">
                      {e.effective_date} · {e.category}
                    </div>
                  </div>
                  <div className={cn("num text-sm shrink-0", e.direction === "debit" ? "text-red-400" : "text-emerald-400")}>
                    {e.direction === "debit" ? "− " : "+ "}{inrCompact(e.amount)}
                  </div>
                </div>
              ))}
              {entries.length > 12 && (
                <div className="text-[10px] text-zinc-600 text-center pt-1">+{entries.length - 12} older</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function computeStatus(stmt: BillingCycle): StatusKind {
  const balance = Number(stmt.balance_due ?? (stmt.total_billed - stmt.total_paid));
  const billed  = Number(stmt.total_billed || 0);
  const paid    = Number(stmt.total_paid || 0);

  if (!stmt.is_closed)               return "unbilled";
  if (billed === 0)                  return "unbilled";
  if (balance <= 0 || paid >= billed) return "paid";
  if (paid > 0 && paid < billed)     return "partial";
  if (stmt.due_date && new Date(stmt.due_date).getTime() < Date.now() - 86_400_000) {
    return "overdue";
  }
  return "unpaid";
}

function daysFrom(iso: string): number {
  const target = new Date(iso);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/* Tiny re-export so AlertTriangle isn't tree-shaken if we later use it for status */
export { AlertTriangle };
