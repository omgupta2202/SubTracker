import { useState } from "react";
import { Plus, Trash2, FileText, ChevronDown, ChevronRight } from "lucide-react";
import type { CreditCard, CardTransaction, CardStatement } from "@/types";
import * as api from "@/services/api";
import { formatINR } from "@/lib/utils";
import { useCardTransactions } from "@/hooks/useCardTransactions";

const inputCls =
  "bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-100 " +
  "focus:outline-none focus:border-violet-500 transition-all w-full placeholder:text-zinc-600";

interface Props {
  card: CreditCard;
}

function groupByStatement(
  transactions: CardTransaction[],
  statements: CardStatement[],
): { stmt: CardStatement | null; txns: CardTransaction[] }[] {
  const stmtMap = new Map<string, CardStatement>(statements.map(s => [s.id, s]));
  const unbilled: CardTransaction[] = [];
  const billedMap = new Map<string, CardTransaction[]>();

  for (const t of transactions) {
    if (!t.statement_id) {
      unbilled.push(t);
    } else {
      if (!billedMap.has(t.statement_id)) billedMap.set(t.statement_id, []);
      billedMap.get(t.statement_id)!.push(t);
    }
  }

  const groups: { stmt: CardStatement | null; txns: CardTransaction[] }[] = [
    { stmt: null, txns: unbilled },
  ];

  for (const stmt of statements) {
    groups.push({ stmt, txns: billedMap.get(stmt.id) ?? [] });
  }

  return groups;
}

export function CardTransactionPanel({ card }: Props) {
  const { transactions, statements, loading, refetch } = useCardTransactions(card.id);
  const [adding, setAdding] = useState(false);
  const [closingStmt, setClosingStmt] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Add form state
  const [desc, setDesc]         = useState("");
  const [amount, setAmount]     = useState("");
  const [txnDate, setTxnDate]   = useState("");

  // Close statement form state
  const [stmtDate, setStmtDate]     = useState("");
  const [dueDate, setDueDate]       = useState("");
  const [minDue, setMinDue]         = useState("");

  async function handleAdd() {
    if (!desc || !amount) return;
    try {
      await api.addCardTransaction(card.id, {
        description: desc,
        amount: parseFloat(amount),
        txn_date: txnDate || undefined,
      });
      setDesc(""); setAmount(""); setTxnDate("");
      setAdding(false);
      void refetch();
    } catch (e) { console.error(e); }
  }

  async function handleDelete(txnId: string) {
    try {
      await api.deleteCardTransaction(card.id, txnId);
      void refetch();
    } catch (e) { console.error(e); }
  }

  async function handleCloseStatement() {
    if (!stmtDate || !dueDate) return;
    try {
      await api.closeCardStatement(card.id, {
        statement_date: stmtDate,
        due_date: dueDate,
        minimum_due: minDue ? parseFloat(minDue) : 0,
      });
      setStmtDate(""); setDueDate(""); setMinDue("");
      setClosingStmt(false);
      void refetch();
    } catch (e) { console.error(e); }
  }

  function toggleCollapse(key: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  const groups = groupByStatement(transactions, statements);
  const unbilledTotal = groups[0].txns.reduce((s, t) => s + Number(t.amount), 0);
  const hasUnbilled   = groups[0].txns.length > 0;

  return (
    <div className="flex flex-col gap-4">

      {/* Actions row */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => { setAdding(a => !a); setClosingStmt(false); }}
          className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
        >
          <Plus size={13} /> Add Transaction
        </button>
        {hasUnbilled && (
          <button
            onClick={() => { setClosingStmt(s => !s); setAdding(false); }}
            className="flex items-center gap-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
          >
            <FileText size={13} /> Close Statement
          </button>
        )}
      </div>

      {/* Add transaction form */}
      {adding && (
        <div className="rounded-xl bg-zinc-800/60 border border-violet-500/20 p-4 flex flex-col gap-3">
          <p className="text-xs font-semibold text-violet-400 uppercase tracking-wider">New Transaction</p>
          <input className={inputCls} placeholder="Description" value={desc} onChange={e => setDesc(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <input className={inputCls} type="number" placeholder="Amount ₹" value={amount} onChange={e => setAmount(e.target.value)} />
            <input className={inputCls} type="date" value={txnDate} onChange={e => setTxnDate(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd} className="flex-1 bg-violet-600 hover:bg-violet-500 text-white py-2 rounded-lg text-xs font-semibold transition-colors">Save</button>
            <button onClick={() => setAdding(false)} className="px-4 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 py-2 rounded-lg text-xs transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {/* Close statement form */}
      {closingStmt && (
        <div className="rounded-xl bg-zinc-800/60 border border-amber-500/20 p-4 flex flex-col gap-3">
          <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Close Statement</p>
          <p className="text-xs text-zinc-500">
            All unbilled transactions up to the statement date will be locked into this statement.
            Unbilled total: <span className="text-zinc-200 font-mono">{formatINR(unbilledTotal)}</span>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Statement Cut-off Date</label>
              <input className={inputCls} type="date" value={stmtDate} onChange={e => setStmtDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Payment Due Date</label>
              <input className={inputCls} type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Minimum Due ₹ (optional)</label>
            <input className={inputCls} type="number" placeholder="0" value={minDue} onChange={e => setMinDue(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button onClick={handleCloseStatement} className="flex-1 bg-amber-600 hover:bg-amber-500 text-white py-2 rounded-lg text-xs font-semibold transition-colors">Close Statement</button>
            <button onClick={() => setClosingStmt(false)} className="px-4 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 py-2 rounded-lg text-xs transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {/* Transaction groups */}
      {loading ? (
        <div className="h-20 rounded-xl bg-zinc-800/40 animate-pulse" />
      ) : transactions.length === 0 && statements.length === 0 ? (
        <p className="text-xs text-zinc-600 text-center py-6">
          No transactions yet. Add one above.
          <br /><span className="text-zinc-700">Note: this card's outstanding balance is set manually.</span>
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map(({ stmt, txns }) => {
            const key = stmt?.id ?? "unbilled";
            const isCollapsed = collapsed.has(key);
            const total = txns.reduce((s, t) => s + Number(t.amount), 0);
            const isUnbilled = !stmt;

            return (
              <div key={key} className="rounded-xl border border-zinc-700/50 overflow-hidden">
                {/* Group header */}
                <button
                  onClick={() => toggleCollapse(key)}
                  className="w-full flex items-center justify-between px-4 py-2.5 bg-zinc-800/60 hover:bg-zinc-800 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {isCollapsed ? <ChevronRight size={13} className="text-zinc-500" /> : <ChevronDown size={13} className="text-zinc-500" />}
                    <span className={`text-xs font-semibold ${isUnbilled ? "text-amber-400" : "text-zinc-300"}`}>
                      {isUnbilled ? "Unbilled" : `Statement — ${stmt.statement_date}`}
                    </span>
                    {!isUnbilled && (
                      <span className="text-xs text-zinc-600">Due {stmt.due_date}</span>
                    )}
                    <span className="text-xs text-zinc-600">{txns.length} txn{txns.length !== 1 ? "s" : ""}</span>
                  </div>
                  <span className={`font-mono text-xs font-semibold ${isUnbilled ? "text-amber-300" : "text-zinc-300"}`}>
                    {formatINR(total)}
                  </span>
                </button>

                {/* Transactions list */}
                {!isCollapsed && (
                  <div className="divide-y divide-zinc-800/60">
                    {txns.length === 0 ? (
                      <p className="text-xs text-zinc-600 px-4 py-3">No transactions</p>
                    ) : txns.map(t => (
                      <div key={t.id} className="flex items-center justify-between px-4 py-2.5 group hover:bg-zinc-800/30">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-zinc-200 truncate">{t.description}</p>
                          <p className="text-xs text-zinc-600">{t.txn_date}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono text-sm text-zinc-300">{formatINR(Number(t.amount))}</span>
                          {isUnbilled && (
                            <button
                              onClick={() => handleDelete(t.id)}
                              className="opacity-0 group-hover:opacity-100 p-1 rounded text-zinc-600 hover:text-red-400 transition-all"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
