import { useEffect, useMemo, useState } from "react";
import {
  Users, Receipt, Loader2, ExternalLink, Pencil,
  Search, X, Trash2, Plus, TrendingUp, TrendingDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { inrCompact, inr, relativeTime, fullTimestamp } from "@/lib/tokens";
import * as api from "@/services/api";
import type { TrackerDetail, TrackerMember, TrackerExpense, TrackerExpenseSplit } from "@/services/api";

/**
 * Guest entry point — opened by anyone holding the magic-link from an
 * invite email at `/trackers/guest/<token>`. No SubTracker account needed.
 *
 * Behaviour:
 *   - GET /api/trackers/guest/<token>   → returns tracker + this guest's row.
 *     Backend auto-promotes invite_status from 'pending' → 'joined'.
 *   - Guest can add expenses, set their UPI VPA, see balances + settlement.
 *   - The token is cached in localStorage so they can revisit by typing
 *     just /trackers and we'll route back to the active tracker.
 */

const STORAGE_KEY = "subtracker:guest-tracker-token";

export function ExpenseTrackerGuestRoute({ token }: { token: string }) {
  const [tracker, setTracker]     = useState<(TrackerDetail & { me: TrackerMember }) | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet]     = useState<TrackerExpense | "new" | null>(null);
  const [editingMe, setEditingMe] = useState(false);
  const [search, setSearch]   = useState("");

  async function refresh() {
    setLoading(true);
    try {
      const t = await api.guestGetTracker(token);
      setTracker(t);
      localStorage.setItem(STORAGE_KEY, token);
    } catch (e) {
      setError((e as Error).message || "Could not load tracker");
    } finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); /* eslint-disable-next-line */ }, [token]);

  const myStats = useMemo(() => {
    if (!tracker) return null;
    let paid = 0, share = 0;
    for (const e of tracker.expenses) {
      if (e.payments?.length) {
        const mine = e.payments.find(p => p.member_id === tracker.me.id);
        if (mine) paid += Number(mine.amount);
      } else if (e.payer_id === tracker.me.id) {
        paid += Number(e.amount);
      }
      const s = e.splits.find(x => x.member_id === tracker.me.id);
      if (s) share += Number(s.share);
    }
    return { paid: +paid.toFixed(2), share: +share.toFixed(2) };
  }, [tracker]);

  if (loading && !tracker) {
    return <Center><Loader2 size={20} className="text-violet-400 animate-spin" /></Center>;
  }
  if (error) {
    return (
      <Center>
        <div className="text-center max-w-sm">
          <h1 className="text-lg font-semibold text-zinc-100">Couldn't open this tracker</h1>
          <p className="text-sm text-zinc-500 mt-2">{error}</p>
        </div>
      </Center>
    );
  }
  if (!tracker) return null;

  const myBal = tracker.balances.find(b => b.member_id === tracker.me.id);
  const totalSpent = tracker.expenses.reduce((s, e) => s + Number(e.amount || 0), 0);

  const q = search.trim().toLowerCase();
  const filteredExpenses = q
    ? tracker.expenses.filter(e =>
        e.description.toLowerCase().includes(q)
        || (e.payments?.length ? e.payments.map(p => p.member_id) : [e.payer_id])
            .some(id => tracker.members.find(m => m.id === id)?.display_name?.toLowerCase().includes(q))
      )
    : tracker.expenses;

  return (
    <div className="min-h-screen bg-zinc-950">
      <header className="sticky top-0 z-10 backdrop-blur-md bg-zinc-950/85 border-b border-zinc-800/60">
        <div className="max-w-[760px] mx-auto px-5 py-3 flex items-center gap-3">
          <Users size={16} className="text-violet-400" />
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold text-zinc-100 truncate">{tracker.name}</h1>
            <p className="text-[11px] text-zinc-500 truncate">
              You're <strong className="text-zinc-300">{tracker.me.display_name}</strong>
              {tracker.me.upi_id && <span> · UPI <span className="num">{tracker.me.upi_id}</span></span>}
              <button onClick={() => setEditingMe(true)}
                      title="Update your display name or UPI ID (so others can pay you with one tap)"
                      className="ml-2 inline-flex items-center gap-1 text-violet-300 hover:text-violet-200">
                <Pencil size={10} /> edit
              </button>
            </p>
          </div>
        </div>
      </header>

      <div className="max-w-[760px] mx-auto px-5 py-6 pb-28 flex flex-col gap-5">
        {/* Hero — your balance + tracker total */}
        <div className="relative overflow-hidden rounded-3xl border border-zinc-800/60 bg-gradient-to-br from-violet-500/10 via-zinc-900 to-zinc-950 p-6"
             title="Net amount across the whole tracker: positive means people owe you; negative means you owe.">
          <div aria-hidden className="pointer-events-none absolute -top-16 -right-16 w-44 h-44 rounded-full bg-violet-500/15 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-16 -left-12 w-44 h-44 rounded-full bg-fuchsia-500/10 blur-3xl" />
          <div className="relative flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-400 mb-1">Your balance</div>
              {myBal ? (
                <div className={cn(
                  "num text-4xl font-semibold tracking-tight",
                  myBal.net > 0.01 ? "text-emerald-400" :
                  myBal.net < -0.01 ? "text-red-400" :
                                      "text-zinc-100",
                )}>
                  {myBal.net > 0.01  ? `+${inr(myBal.net)}`  :
                   myBal.net < -0.01 ? `${inr(myBal.net)}`   :
                                       "settled · ₹0"}
                </div>
              ) : (
                <div className="text-sm text-zinc-500">No expenses involving you yet.</div>
              )}
              {myBal && myBal.net !== 0 && (
                <div className="text-xs text-zinc-500 mt-1">
                  {myBal.net > 0.01 ? "you'll receive" : "you owe"}
                </div>
              )}
              <div className="mt-3 text-[11px] text-zinc-500 flex flex-wrap gap-x-3 gap-y-1">
                <span>paid <span className="num text-zinc-300">{inrCompact(myStats?.paid ?? 0)}</span></span>
                <span>your share <span className="num text-zinc-300">{inrCompact(myStats?.share ?? 0)}</span></span>
                <span>tracker total <span className="num text-zinc-300">{inrCompact(totalSpent)}</span></span>
              </div>
            </div>
          </div>
        </div>

        {/* Members balances */}
        <section>
          <SectionTitle>Who owes whom</SectionTitle>
          <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/60 mt-2 overflow-hidden">
            {tracker.balances.map(b => (
              <div key={b.member_id} className="flex items-center px-4 py-2.5 border-b border-zinc-800/40 last:border-0">
                <span className="text-sm text-zinc-200 flex-1 truncate">{b.display_name}</span>
                <span className={cn(
                  "num text-sm",
                  b.net > 0.01  ? "text-emerald-400" :
                  b.net < -0.01 ? "text-red-400" :
                                  "text-zinc-500",
                )}>
                  {b.net > 0.01  ? `+${inrCompact(b.net)}` :
                   b.net < -0.01 ? `${inrCompact(b.net)}`  :
                                   "settled"}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Stats — who spent how much */}
        {tracker.expenses.length > 0 && (
          <section>
            <SectionTitle>Who spent how much</SectionTitle>
            <GuestStatsGrid tracker={tracker} />
          </section>
        )}

        {/* Search + Expenses */}
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <SectionTitle>Expenses · {tracker.expenses.length}</SectionTitle>
          </div>
          {tracker.expenses.length > 0 && (
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search expenses or payers…"
                className="w-full pl-8 pr-8 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/50"
              />
              {search && (
                <button onClick={() => setSearch("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-zinc-500 hover:text-zinc-200">
                  <X size={12} />
                </button>
              )}
            </div>
          )}

          <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 mt-1 overflow-hidden">
            {filteredExpenses.length === 0 ? (
              <p className="text-sm text-zinc-500 text-center py-8">
                {search ? "No expenses match that search." : "No expenses yet. Tap \"Add expense\" to start."}
              </p>
            ) : filteredExpenses.map(e => (
              <GuestExpenseRow
                key={e.id}
                expense={e}
                members={tracker.members}
                onEdit={() => setSheet(e)}
                onDelete={async () => {
                  if (!confirm("Delete this expense?")) return;
                  try {
                    await api.guestDeleteTrackerExpense(token, e.id);
                    await refresh();
                  } catch (err) { alert((err as Error).message); }
                }}
              />
            ))}
          </div>
        </section>

        {/* Settlement */}
        <SettleStrip tracker={tracker} />
      </div>

      {/* Sticky FAB */}
      <div className="fixed bottom-4 inset-x-0 z-[40] pointer-events-none">
        <div className="max-w-[760px] mx-auto px-5 flex justify-end">
          <button
            onClick={() => setSheet("new")}
            title="Record a shared expense"
            className="pointer-events-auto inline-flex items-center gap-2 px-4 py-3 rounded-full bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium shadow-2xl shadow-violet-900/40 ring-1 ring-violet-400/30"
          >
            <Plus size={16} /> Add expense
          </button>
        </div>
      </div>

      {sheet && (
        <ExpenseSheetGuest
          tracker={tracker}
          token={token}
          existing={sheet === "new" ? undefined : sheet}
          onClose={() => setSheet(null)}
          onSaved={async () => { setSheet(null); await refresh(); }}
        />
      )}
      {editingMe && (
        <EditMeSheet
          token={token}
          me={tracker.me}
          onClose={() => setEditingMe(false)}
          onSaved={async () => { setEditingMe(false); await refresh(); }}
        />
      )}
    </div>
  );
}

/* ── Guest expense row with edit + delete ── */

function GuestExpenseRow({
  expense, members, onEdit, onDelete,
}: {
  expense: TrackerExpense;
  members: TrackerMember[];
  onEdit: () => void;
  onDelete: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const payer = members.find(m => m.id === expense.payer_id);
  const multi = (expense.payments?.length ?? 0) > 1;
  const payerLabel = multi ? `${expense.payments.length} paid` : `${payer?.display_name ?? "?"} paid`;
  return (
    <div className="border-b border-zinc-800/40 last:border-b-0 hover:bg-zinc-800/20 transition-colors">
      <div className="px-3 sm:px-4 py-3 flex items-center gap-3">
        <button onClick={() => setOpen(o => !o)}
                className="flex items-center gap-3 flex-1 min-w-0 text-left"
                title="Click to see split details">
          <span className="h-8 w-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-300 shrink-0">
            <Receipt size={14} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-zinc-100 truncate">{expense.description}</div>
            <div className="text-[11px] text-zinc-500 num truncate">
              {payerLabel} · {expense.expense_date}
              <span className="ml-1 text-zinc-600" title={`Added ${fullTimestamp(expense.created_at)}`}>
                · {relativeTime(expense.created_at)}
              </span>
            </div>
          </div>
          <span className="num text-sm font-medium text-zinc-100 shrink-0">{inrCompact(expense.amount)}</span>
        </button>
        <button onClick={onEdit} title="Edit this expense"
                className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/70">
          <Pencil size={12} />
        </button>
      </div>
      {open && (
        <div className="px-3 sm:px-4 pb-3 ml-11 pl-3 border-l border-zinc-800 flex flex-col gap-2">
          {multi && (
            <div className="flex flex-col gap-1">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Paid by</div>
              {expense.payments.map(p => {
                const m = members.find(mm => mm.id === p.member_id);
                return (
                  <div key={p.member_id} className="flex items-center justify-between text-xs text-zinc-400">
                    <span>{m?.display_name ?? "?"}</span>
                    <span className="num text-zinc-300">{inrCompact(p.amount)}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex flex-col gap-1">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Split</div>
            {expense.splits.map(s => {
              const m = members.find(mm => mm.id === s.member_id);
              return (
                <div key={s.member_id} className="flex items-center justify-between text-xs text-zinc-400">
                  <span>{m?.display_name ?? "?"}</span>
                  <span className="num text-zinc-300">{inrCompact(s.share)}</span>
                </div>
              );
            })}
          </div>
          <button onClick={onDelete}
                  title="Permanently remove this expense"
                  className="self-start mt-1 inline-flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300">
            <Trash2 size={11} /> Delete expense
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Lite stats grid for the guest view ── */

function GuestStatsGrid({ tracker }: { tracker: TrackerDetail & { me: TrackerMember } }) {
  const stats = useMemo(() => {
    const totalCost = tracker.expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
    return tracker.members.map(m => {
      let paid = 0, share = 0;
      for (const e of tracker.expenses) {
        if (e.payments?.length) {
          const mine = e.payments.find(p => p.member_id === m.id);
          if (mine) paid += Number(mine.amount);
        } else if (e.payer_id === m.id) {
          paid += Number(e.amount);
        }
        const s = e.splits.find(x => x.member_id === m.id);
        if (s) share += Number(s.share);
      }
      return {
        member_id: m.id,
        display_name: m.display_name,
        paid: +paid.toFixed(2),
        share: +share.toFixed(2),
        net: +(paid - share).toFixed(2),
        share_pct: totalCost > 0 ? paid / totalCost : 0,
      };
    }).sort((a, b) => b.paid - a.paid);
  }, [tracker]);
  const maxPaid = Math.max(1, ...stats.map(s => s.paid));

  return (
    <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-4 mt-2 flex flex-col gap-3">
      {stats.map(s => {
        const trend = s.net > 0.01 ? "up" : s.net < -0.01 ? "down" : "flat";
        return (
          <div key={s.member_id}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm text-zinc-100 truncate">{s.display_name}</span>
              <span className="num text-sm text-zinc-100">{inrCompact(s.paid)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-400"
                   style={{ width: `${(s.paid / maxPaid) * 100}%` }} />
            </div>
            <div className="flex items-center justify-between mt-1.5 text-[11px] text-zinc-500 num">
              <span>share {inrCompact(s.share)}</span>
              <span className={cn(
                "inline-flex items-center gap-1",
                trend === "up"   ? "text-emerald-400" :
                trend === "down" ? "text-red-400"     :
                                   "text-zinc-500",
              )}>
                {trend === "up"   && <TrendingUp size={11} />}
                {trend === "down" && <TrendingDown size={11} />}
                {trend === "flat" ? "settled" :
                 trend === "up"   ? `+${inrCompact(s.net)}` :
                                    inrCompact(s.net)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Settle strip — guest sees only transfers involving them, with a UPI button to send. ── */

function SettleStrip({ tracker }: { tracker: TrackerDetail & { me: TrackerMember } }) {
  const [data, setData] = useState<{ transfers: { from_member_id: string; to_member_id: string; amount: number; from_display_name: string; to_display_name: string; to_upi_id: string | null }[] } | null>(null);

  // Recompute whenever tracker changes — guest doesn't have access to /settlement
  // (that's owner-side), so we compute locally from the balances.
  useEffect(() => {
    const t = greedy(tracker.balances.map(b => ({ id: b.member_id, name: b.display_name, net: b.net })));
    const upi = new Map(tracker.members.map(m => [m.id, m.upi_id]));
    setData({
      transfers: t.map(x => ({
        ...x,
        from_display_name: tracker.balances.find(b => b.member_id === x.from_member_id)?.display_name ?? "?",
        to_display_name:   tracker.balances.find(b => b.member_id === x.to_member_id)?.display_name ?? "?",
        to_upi_id:         upi.get(x.to_member_id) ?? null,
      })),
    });
  }, [tracker]);

  if (!data || data.transfers.length === 0) return null;
  const involvingMe = data.transfers.filter(t => t.from_member_id === tracker.me.id || t.to_member_id === tracker.me.id);
  if (involvingMe.length === 0) return null;

  return (
    <section>
      <SectionTitle>Settle up</SectionTitle>
      <div className="rounded-2xl border border-violet-500/25 bg-violet-500/5 mt-2 p-3 flex flex-col gap-2">
        {involvingMe.map((t, i) => {
          const youOwe = t.from_member_id === tracker.me.id;
          const upi = youOwe && t.to_upi_id
            ? `upi://pay?pa=${encodeURIComponent(t.to_upi_id)}&pn=${encodeURIComponent(t.to_display_name)}&am=${t.amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent("Tracker settlement")}`
            : null;
          return (
            <div key={i} className="flex items-center gap-2 px-2 py-2 rounded-lg bg-zinc-900/80 border border-zinc-800">
              <span className="text-sm text-zinc-200 flex-1 truncate">
                {youOwe
                  ? <>You pay <strong>{t.to_display_name}</strong></>
                  : <><strong>{t.from_display_name}</strong> pays you</>}
              </span>
              <span className="num text-sm text-zinc-100 shrink-0">{inr(t.amount)}</span>
              {upi
                ? <a href={upi}
                     title={`Open your UPI app pre-filled to pay ${t.to_display_name} ₹${t.amount.toFixed(2)}`}
                     className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md border border-violet-500/40 text-violet-200 text-xs"><ExternalLink size={11} /> UPI</a>
                : (youOwe
                    ? <span title="The recipient hasn't set their UPI ID, so we can't open a UPI app for you. You can still pay them by other means."
                            className="text-[11px] text-zinc-600 px-1">no UPI</span>
                    : null)
              }
            </div>
          );
        })}
      </div>
    </section>
  );
}

function greedy(rows: { id: string; name: string; net: number }[]) {
  const cred = rows.filter(r => r.net > 0.005).map(r => ({ ...r })).sort((a, b) => b.net - a.net);
  const debt = rows.filter(r => r.net < -0.005).map(r => ({ ...r, net: -r.net })).sort((a, b) => b.net - a.net);
  const out: { from_member_id: string; to_member_id: string; amount: number }[] = [];
  let i = 0, j = 0;
  while (i < cred.length && j < debt.length) {
    const amt = +Math.min(cred[i].net, debt[j].net).toFixed(2);
    out.push({ from_member_id: debt[j].id, to_member_id: cred[i].id, amount: amt });
    cred[i].net = +(cred[i].net - amt).toFixed(2);
    debt[j].net = +(debt[j].net - amt).toFixed(2);
    if (cred[i].net < 0.01) i++;
    if (debt[j].net < 0.01) j++;
  }
  return out;
}

/* ── Guest expense sheet — add + edit ── */

function ExpenseSheetGuest({
  tracker, token, existing, onClose, onSaved,
}: {
  tracker: TrackerDetail & { me: TrackerMember };
  token: string;
  existing?: TrackerExpense;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const initial = useMemo(() => {
    if (!existing) {
      return {
        description: "",
        amount: "",
        date: new Date().toISOString().slice(0, 10),
        included: new Set(tracker.members.map(m => m.id)),
        paymentKind: "single" as const,
        singlePayer: tracker.me.id,
        paid: {} as Record<string, string>,
      };
    }
    const includedIds = new Set(existing.splits.map(s => s.member_id));
    const paidRec: Record<string, string> = {};
    (existing.payments ?? []).forEach(p => { paidRec[p.member_id] = String(p.amount); });
    const isMulti = (existing.payments?.length ?? 0) > 1;
    return {
      description: existing.description,
      amount: String(existing.amount),
      date: existing.expense_date,
      included: includedIds,
      paymentKind: (isMulti ? "partial" : "single") as "single" | "partial",
      singlePayer: existing.payer_id,
      paid: paidRec,
    };
  }, [existing, tracker.members, tracker.me.id]);

  const [description, setDescription] = useState(initial.description);
  const [amount, setAmount]           = useState(initial.amount);
  const [date, setDate]               = useState(initial.date);
  const [included, setIncluded]       = useState<Set<string>>(initial.included);
  const [paymentKind, setPaymentKind] = useState<"single" | "partial">(initial.paymentKind);
  const [singlePayer, setSinglePayer] = useState<string>(initial.singlePayer);
  const [paid, setPaid]               = useState<Record<string, string>>(initial.paid);
  const [saving, setSaving]           = useState(false);

  const amt = Number(amount) || 0;
  const paidTotal = Object.values(paid).reduce((s, v) => s + (Number(v) || 0), 0);
  const paidDrift = +(amt - paidTotal).toFixed(2);
  const paidValid = paymentKind === "single"
    ? !!singlePayer
    : Math.abs(paidDrift) <= 0.5 && paidTotal > 0;

  async function save(ev?: React.FormEvent) {
    ev?.preventDefault();
    if (!description.trim() || !amt || saving) return;
    if (!paidValid) {
      alert(paymentKind === "partial"
        ? `Sum of partial payments (₹${paidTotal}) must equal amount (₹${amt}).`
        : "Pick who paid.");
      return;
    }
    setSaving(true);
    try {
      let splits: TrackerExpenseSplit[] | undefined;
      let kind: "equal" | "custom" = "equal";
      if (included.size !== tracker.members.length) {
        kind = "custom";
        const ids = [...included];
        const per = +(amt / ids.length).toFixed(2);
        const tot = +(per * ids.length).toFixed(2);
        const drift = +(amt - tot).toFixed(2);
        splits = ids.map((id, i) => ({ member_id: id, share: i === 0 ? +(per + drift).toFixed(2) : per }));
      }

      let payments: { member_id: string; amount: number }[] | undefined;
      let primaryPayerId = singlePayer;
      if (paymentKind === "partial") {
        payments = Object.entries(paid)
          .map(([member_id, raw]) => ({ member_id, amount: Number(raw) || 0 }))
          .filter(p => p.amount > 0);
        if (payments.length > 0) {
          primaryPayerId = payments.reduce((max, p) => (p.amount > max.amount ? p : max)).member_id;
        }
      } else {
        payments = [{ member_id: primaryPayerId, amount: amt }];
      }

      const payload = {
        payer_id: primaryPayerId,
        description: description.trim(),
        amount: amt,
        expense_date: date,
        split_kind: kind,
        splits,
        payments,
      };
      if (existing) {
        await api.guestUpdateTrackerExpense(token, existing.id, payload);
      } else {
        await api.guestAddTrackerExpense(token, payload);
      }
      await onSaved();
    } catch (e) { alert((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <Sheet onClose={onClose} title={existing ? "Edit expense" : "Add expense"}>
      <form onSubmit={save} className="flex flex-col gap-3">
        <Field label="What was it?">
          <input className={inputCls} placeholder="Dinner at Beach Cafe" autoFocus
                 value={description} onChange={e => setDescription(e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <Field label="Amount (₹)">
            <input className={inputCls} type="number" inputMode="decimal" placeholder="0"
                   value={amount} onChange={e => setAmount(e.target.value)} />
          </Field>
          <Field label="Date">
            <input className={inputCls} type="date"
                   value={date} onChange={e => setDate(e.target.value)} />
          </Field>
        </div>

        <Field label="Paid by" hint="Who actually paid the bill. Use Partial when more than one person chipped in.">
          <div className="flex items-center gap-1 mb-2">
            <SegBtn active={paymentKind === "single"}  onClick={() => setPaymentKind("single")}
                    title="One person paid the entire bill">Single</SegBtn>
            <SegBtn active={paymentKind === "partial"} onClick={() => setPaymentKind("partial")}
                    title="Multiple people contributed — set how much each one paid">Partial</SegBtn>
          </div>
          {paymentKind === "single" ? (
            <select className={inputCls} value={singlePayer} onChange={e => setSinglePayer(e.target.value)}>
              {tracker.members.map(m => (<option key={m.id} value={m.id}>{m.display_name}</option>))}
            </select>
          ) : (
            <div className="flex flex-col gap-1">
              {tracker.members.map(m => {
                const checked = !!paid[m.id];
                return (
                  <label key={m.id} className="flex items-center gap-3 py-1.5 px-2 -mx-2 rounded hover:bg-zinc-800/30">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={e => {
                        setPaid(p => {
                          const n = { ...p };
                          if (e.target.checked) n[m.id] = n[m.id] ?? "";
                          else delete n[m.id];
                          return n;
                        });
                      }}
                      className="accent-violet-500"
                    />
                    <span className="text-sm text-zinc-200 flex-1">{m.display_name}</span>
                    {checked && (
                      <input
                        className={cn(inputCls, "w-24 text-right")}
                        type="number" inputMode="decimal" placeholder="0"
                        value={paid[m.id] ?? ""}
                        onChange={e => setPaid(p => ({ ...p, [m.id]: e.target.value }))}
                      />
                    )}
                  </label>
                );
              })}
              <div className={cn(
                "flex items-center justify-between text-[11px] mt-1 num",
                Math.abs(paidDrift) <= 0.5 ? "text-zinc-500" : "text-amber-400",
              )}>
                <span>paid {inrCompact(paidTotal)} of {inrCompact(amt)}</span>
                {Math.abs(paidDrift) > 0.5 && (
                  <span>{paidDrift > 0 ? `${inrCompact(paidDrift)} short` : `${inrCompact(-paidDrift)} extra`}</span>
                )}
              </div>
            </div>
          )}
        </Field>

        <Field label="Split equally between" hint="Uncheck anyone who shouldn't share this expense — the cost is divided equally between everyone left checked.">
          <div className="flex flex-col gap-1">
            {tracker.members.map(m => (
              <label key={m.id} className="flex items-center gap-3 py-1.5 px-2 -mx-2 rounded hover:bg-zinc-800/30">
                <input
                  type="checkbox" checked={included.has(m.id)}
                  onChange={e => {
                    const next = new Set(included);
                    e.target.checked ? next.add(m.id) : next.delete(m.id);
                    setIncluded(next);
                  }}
                  className="accent-violet-500"
                />
                <span className="text-sm text-zinc-200">{m.display_name}</span>
              </label>
            ))}
          </div>
        </Field>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800/60 mt-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200">Cancel</button>
          <button type="submit" disabled={saving}
                  className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium disabled:opacity-50">
            {saving ? "Saving…" : existing ? "Save changes" : "Save expense"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

function SegBtn({ active, onClick, title, children }: { active: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "px-3 py-1 rounded-md text-xs font-medium transition-colors",
        active ? "bg-violet-500/15 text-violet-200 border border-violet-500/30" : "text-zinc-400 hover:text-zinc-200 border border-transparent",
      )}
    >{children}</button>
  );
}

function EditMeSheet({
  token, me, onClose, onSaved,
}: {
  token: string;
  me: TrackerMember;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(me.display_name);
  const [upi,  setUpi]  = useState(me.upi_id ?? "");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api.guestUpdateMe(token, { display_name: name.trim(), upi_id: upi.trim() || undefined });
      await onSaved();
    } catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <Sheet title="Your details" onClose={onClose}>
      <p className="text-xs text-zinc-500">
        Set your UPI ID so others can send you settlement payments with one tap.
      </p>
      <Field label="Display name"><input className={inputCls} value={name} onChange={e => setName(e.target.value)} /></Field>
      <Field label="UPI VPA (e.g. name@okhdfcbank)"><input className={inputCls} placeholder="optional" value={upi} onChange={e => setUpi(e.target.value)} /></Field>
      <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800/60 mt-2">
        <button onClick={onClose} className="px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200">Cancel</button>
        <button onClick={save} disabled={busy}
                className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </Sheet>
  );
}

/* ── tiny primitives ── */

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-8">{children}</div>;
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs uppercase tracking-wider font-semibold text-zinc-500">{children}</h2>;
}
const inputCls = "w-full bg-zinc-950 border border-zinc-700/70 rounded px-2.5 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/60";
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium flex items-center gap-1.5">
        {label}
        {hint && (
          <span
            title={hint}
            className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-zinc-700 text-[9px] text-zinc-500 cursor-help normal-case tracking-normal"
          >?</span>
        )}
      </span>
      {children}
    </label>
  );
}
function Sheet({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full sm:w-[min(92vw,520px)] max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-zinc-800 bg-zinc-900 p-5 flex flex-col gap-3"
           onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
        {children}
      </div>
    </div>
  );
}
