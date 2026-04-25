import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  X, Plus, Users, ArrowLeft, ArrowRight, Mail, Trash2, Receipt,
  Sparkles, Check, Loader2, ExternalLink, Copy, Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { inrCompact, inr, relativeTime, fullTimestamp } from "@/lib/tokens";
import { navigate } from "@/lib/router";
import * as api from "@/services/api";
import type {
  TripSummary, TripDetail, TripMember, TripExpense, TripExpenseSplit,
  TripSettlement, TripTransfer,
} from "@/services/api";

/**
 * Full-screen "Trips" app overlay. Mounted from the Apps launcher in the
 * dashboard header. Three views in one component:
 *   - list   → all trips, with quick "create new"
 *   - detail → expenses, balances, members
 *   - settle → minimum-transfers settlement plan
 *
 * Closing the overlay returns the user to the dashboard untouched.
 */
type View = "list" | "detail" | "settle";

interface Props {
  /** Overlay-mode prop — when false, the component renders nothing.
   *  Standalone mode (driven by URL routing) ignores this and is always open. */
  open?: boolean;
  /** When true, this is the page itself (URL route) — internal navigation
   *  also pushes URL changes so back/forward + bookmarks work. */
  standalone?: boolean;
  /** Initial trip id from the URL: e.g. /trips/<id> */
  initialTripId?: string | null;
  onClose: () => void;
}

export function TripsApp({ open, standalone = false, initialTripId = null, onClose }: Props) {
  const isOpen = standalone || !!open;

  const [view, setView]         = useState<View>(initialTripId ? "detail" : "list");
  const [trips, setTrips]       = useState<TripSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initialTripId);
  const [detail, setDetail]     = useState<TripDetail | null>(null);
  const [settlement, setSettlement] = useState<TripSettlement | null>(null);
  const [loading, setLoading]   = useState(false);
  const [creating, setCreating] = useState(false);

  // Reset / fetch when (re)opened or when the URL-driven id changes.
  useEffect(() => {
    if (!isOpen) return;
    setSettlement(null);
    void refreshList();
    if (initialTripId) {
      setActiveId(initialTripId);
      setView("detail");
      void loadDetail(initialTripId);
    } else {
      setActiveId(null);
      setView("list");
      setDetail(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialTripId]);

  async function refreshList() {
    setLoading(true);
    try { setTrips(await api.listTrips()); }
    finally { setLoading(false); }
  }

  async function loadDetail(id: string) {
    setLoading(true);
    try { setDetail(await api.getTrip(id)); }
    finally { setLoading(false); }
  }

  async function openTrip(id: string) {
    setActiveId(id);
    setView("detail");
    if (standalone) navigate(`/trips/${id}`);
    await loadDetail(id);
  }

  function backToList() {
    setView("list");
    setActiveId(null);
    setDetail(null);
    if (standalone) navigate("/trips");
  }

  async function reloadDetail() {
    if (!activeId) return;
    setDetail(await api.getTrip(activeId));
  }

  async function openSettlement() {
    if (!activeId) return;
    setLoading(true);
    try {
      setSettlement(await api.getTripSettlement(activeId));
      setView("settle");
    } finally { setLoading(false); }
  }

  if (!isOpen) return null;

  // Portal to document.body so the `fixed` overlay isn't trapped inside
  // the dashboard header's `backdrop-filter` containing block.
  return createPortal(
    <div className="fixed inset-0 z-[80] bg-zinc-950 overflow-y-auto">
      {/* Top bar */}
      <header className="sticky top-0 z-10 backdrop-blur-md bg-zinc-950/85 border-b border-zinc-800/60">
        <div className="max-w-[960px] mx-auto px-5 py-3 flex items-center gap-3">
          {view !== "list" && (
            <button
              onClick={() => view === "settle" ? setView("detail") : backToList()}
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/70"
              aria-label="Back"
            ><ArrowLeft size={16} /></button>
          )}
          <Users size={16} className="text-violet-400" />
          <h1 className="text-base font-semibold text-zinc-100">
            {view === "list"  && "Trips"}
            {view === "detail" && (detail?.name ?? "Trip")}
            {view === "settle" && "Settlement plan"}
          </h1>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/70" aria-label="Close">
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="max-w-[960px] mx-auto px-5 py-6">
        {view === "list" && (
          <ListView
            trips={trips}
            loading={loading}
            creating={creating}
            onCreate={async (name) => {
              setCreating(true);
              try {
                const trip = await api.createTrip({ name });
                await refreshList();
                openTrip(trip.id);
              } finally { setCreating(false); }
            }}
            onOpen={openTrip}
          />
        )}
        {view === "detail" && detail && (
          <DetailView
            trip={detail}
            loading={loading}
            onChange={reloadDetail}
            onSettle={openSettlement}
          />
        )}
        {view === "settle" && settlement && detail && (
          <SettleView
            trip={detail}
            settlement={settlement}
            onClose={async () => {
              await api.updateTrip(detail.id, { status: "settled" });
              await reloadDetail();
              setView("detail");
            }}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ────────────────────────── LIST ────────────────────────── */

function ListView({
  trips, loading, creating, onCreate, onOpen,
}: {
  trips: TripSummary[];
  loading: boolean;
  creating: boolean;
  onCreate: (name: string) => Promise<void>;
  onOpen: (id: string) => void;
}) {
  const [newName, setNewName] = useState("");
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // Use a real form so the browser handles Enter + the empty-input case.
  // The button only disables while the request is in flight — clicking it
  // with an empty name focuses the input instead of being a dead button.
  async function submit(ev?: React.FormEvent) {
    ev?.preventDefault();
    const name = newName.trim();
    if (!name) {
      inputRef.current?.focus();
      return;
    }
    await onCreate(name);
    setNewName("");
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Create */}
      <form
        onSubmit={submit}
        className="rounded-2xl border border-zinc-800/60 bg-zinc-900 p-5 flex items-center gap-3"
      >
        <Sparkles size={16} className="text-violet-400 shrink-0" />
        <input
          ref={inputRef}
          className="flex-1 bg-zinc-950 border border-zinc-700/70 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/60"
          placeholder="New trip name (e.g. Goa Apr 2026)"
          value={newName}
          onChange={e => setNewName(e.target.value)}
        />
        <button
          type="submit"
          disabled={creating}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium disabled:opacity-50"
        >
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create
        </button>
      </form>

      {/* List */}
      <div className="flex flex-col">
        {loading && trips.length === 0 ? (
          <div className="text-center py-12 text-zinc-500"><Loader2 size={20} className="text-violet-400 animate-spin mx-auto" /></div>
        ) : trips.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 p-12 text-center text-sm text-zinc-500">
            No trips yet. Create one above to track shared expenses with friends.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {trips.map(t => (
              <button
                key={t.id}
                onClick={() => onOpen(t.id)}
                className="text-left rounded-2xl border border-zinc-800/60 bg-zinc-900 hover:border-zinc-700 p-5 transition-colors"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-base font-semibold text-zinc-100 truncate">{t.name}</h3>
                  <span className={cn(
                    "text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border",
                    t.status === "settled"  ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/30" :
                    t.status === "archived" ? "text-zinc-400 bg-zinc-800/50 border-zinc-700"            :
                                              "text-violet-300 bg-violet-500/10 border-violet-500/30",
                  )}>{t.status}</span>
                </div>
                {(t.start_date || t.end_date) && (
                  <p className="text-xs text-zinc-500 mt-1 num">
                    {t.start_date} {t.end_date && `– ${t.end_date}`}
                  </p>
                )}
                {t.note && <p className="text-xs text-zinc-600 mt-2 line-clamp-2">{t.note}</p>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────── DETAIL ────────────────────────── */

function DetailView({
  trip, loading, onChange, onSettle,
}: {
  trip: TripDetail;
  loading: boolean;
  onChange: () => Promise<void>;
  onSettle: () => void;
}) {
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showInvite, setShowInvite]         = useState(false);
  const totalSpent = useMemo(
    () => trip.expenses.reduce((s, e) => s + Number(e.amount || 0), 0),
    [trip.expenses],
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Hero */}
      <div className="rounded-2xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-950 p-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-1">Total spent</div>
            <div className="num text-3xl font-semibold text-zinc-100">{inrCompact(totalSpent)}</div>
            <div className="text-xs text-zinc-500 mt-1">{trip.expenses.length} expense{trip.expenses.length !== 1 ? "s" : ""} · {trip.members.length} member{trip.members.length !== 1 ? "s" : ""}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowInvite(true)}
              title="Invite someone by email — they'll get a link to join, no signup needed"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-zinc-700 hover:bg-zinc-800/60 text-zinc-300 text-sm"
            >
              <Mail size={14} /> Invite
            </button>
            <button
              onClick={onSettle}
              title="Compute the minimum number of payments to settle everyone up"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium"
            >
              <Sparkles size={14} /> Settle
            </button>
          </div>
        </div>
      </div>

      {/* Members */}
      <section>
        <SectionTitle>Members</SectionTitle>
        <div className="flex flex-wrap gap-2 mt-2">
          {trip.members.map(m => {
            const bal = trip.balances.find(b => b.member_id === m.id);
            const net = bal?.net ?? 0;
            const memberTip =
              net > 0.01  ? `${m.display_name} is owed ${inr(net)} overall`  :
              net < -0.01 ? `${m.display_name} owes ${inr(-net)} overall`    :
                            `${m.display_name} is settled — paid and owes the same amount`;
            return (
              <div key={m.id}
                   title={memberTip}
                   className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5 flex items-center gap-2">
                <span className="text-sm text-zinc-200">{m.display_name}</span>
                {m.invite_status === "pending" && (
                  <span title="This member hasn't opened their invite link yet"
                        className="text-[10px] uppercase tracking-wider text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-1.5">pending</span>
                )}
                <span className={cn(
                  "text-xs num",
                  net > 0.01  ? "text-emerald-400" :
                  net < -0.01 ? "text-red-400" :
                                "text-zinc-500",
                )}>
                  {net > 0.01  ? `+${inrCompact(net)} owed` :
                   net < -0.01 ? `${inrCompact(net)} owes`  :
                                 "settled"}
                </span>
              </div>
            );
          })}
          <button
            onClick={() => setShowInvite(true)}
            title="Invite another member to this trip"
            className="rounded-full border border-dashed border-zinc-700 px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-200 hover:border-zinc-500"
          >
            + invite
          </button>
        </div>
      </section>

      {/* Expenses */}
      <section>
        <div className="flex items-center justify-between">
          <SectionTitle>Expenses</SectionTitle>
          <button
            onClick={() => setShowAddExpense(true)}
            title="Record a shared expense — pick who paid and who it was split between"
            className="text-xs text-violet-400 hover:text-violet-300 inline-flex items-center gap-1"
          >
            <Plus size={12} /> Add expense
          </button>
        </div>
        <div className="mt-2 flex flex-col">
          {trip.expenses.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-8 rounded-xl border border-dashed border-zinc-800">
              No expenses yet. Tap "Add expense" to record the first one.
            </p>
          ) : (
            trip.expenses.map(e => (
              <ExpenseRow
                key={e.id}
                expense={e}
                members={trip.members}
                onDelete={async () => {
                  if (!confirm("Delete this expense?")) return;
                  await api.deleteTripExpense(trip.id, e.id);
                  await onChange();
                }}
              />
            ))
          )}
        </div>
      </section>

      {showAddExpense && (
        <AddExpenseSheet
          trip={trip}
          onClose={() => setShowAddExpense(false)}
          onSaved={async () => { setShowAddExpense(false); await onChange(); }}
        />
      )}
      {showInvite && (
        <InviteSheet
          trip={trip}
          onClose={() => setShowInvite(false)}
          onInvited={async () => { await onChange(); }}
        />
      )}

      {loading && (
        <div className="fixed inset-0 z-[5] flex items-center justify-center bg-zinc-950/40 pointer-events-none">
          <Loader2 size={20} className="text-violet-400 animate-spin" />
        </div>
      )}
    </div>
  );
}

function ExpenseRow({
  expense, members, onDelete,
}: {
  expense: TripExpense;
  members: TripMember[];
  onDelete: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const payer = members.find(m => m.id === expense.payer_id);
  const multi = (expense.payments?.length ?? 0) > 1;
  const paidLabel = multi ? `${expense.payments.length} paid` : `${payer?.display_name ?? "?"} paid`;
  return (
    <div className="border-b border-zinc-800/60 py-3 -mx-2 px-2 hover:bg-zinc-800/20 rounded">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left flex items-center gap-3"
        title="Click to see split details"
      >
        <Receipt size={14} className="text-zinc-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-zinc-100 truncate">{expense.description}</div>
          <div className="text-[11px] text-zinc-500">
            {paidLabel} · {expense.expense_date} · {expense.split_kind === "equal" ? `split ${expense.splits.length}` : "custom split"}
            <span className="ml-1 text-zinc-600" title={`Added ${fullTimestamp(expense.created_at)}`}>
              · added {relativeTime(expense.created_at)}
            </span>
          </div>
        </div>
        <span className="num text-sm text-zinc-100 shrink-0">{inrCompact(expense.amount)}</span>
      </button>
      {open && (
        <div className="ml-7 mt-2 pl-3 border-l border-zinc-800 flex flex-col gap-2">
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
                  title="Permanently remove this expense — recalculates balances for everyone"
                  className="self-start mt-1 inline-flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300">
            <Trash2 size={11} /> Delete expense
          </button>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────── ADD EXPENSE ────────────────────────── */

function AddExpenseSheet({
  trip, onClose, onSaved,
}: {
  trip: TripDetail;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [description, setDescription] = useState("");
  const [amount, setAmount]           = useState("");
  const [splitKind, setSplitKind]     = useState<"equal" | "custom">("equal");
  const [included, setIncluded]       = useState<Set<string>>(new Set(trip.members.map(m => m.id)));
  const [shares, setShares]           = useState<Record<string, string>>({});
  // Payment side — single payer (one dropdown) or partial (multiple members
  // each contribute an amount). Matches the user's "₹40 = A 16 + B 24" case.
  const [paymentKind, setPaymentKind] = useState<"single" | "partial">("single");
  const [singlePayer, setSinglePayer] = useState<string>(trip.members[0]?.id ?? "");
  const [paid, setPaid]               = useState<Record<string, string>>({});
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
      // ── Splits side ───────────────────────────────────────────────────
      let splits: TripExpenseSplit[] | undefined;
      let splitKindToSend: "equal" | "custom" = "equal";
      if (splitKind === "equal") {
        if (included.size === trip.members.length) {
          splitKindToSend = "equal";
          splits = undefined;
        } else {
          splitKindToSend = "custom";
          const ids = [...included];
          const per = +(amt / ids.length).toFixed(2);
          const drift = +(amt - per * ids.length).toFixed(2);
          splits = ids.map((id, i) => ({ member_id: id, share: i === 0 ? +(per + drift).toFixed(2) : per }));
        }
      } else {
        splitKindToSend = "custom";
        splits = trip.members
          .filter(m => included.has(m.id))
          .map(m => ({ member_id: m.id, share: Number(shares[m.id] || 0) }));
      }

      // ── Payments side ─────────────────────────────────────────────────
      let payments: { member_id: string; amount: number }[] | undefined;
      let primaryPayerId = singlePayer;
      if (paymentKind === "partial") {
        payments = Object.entries(paid)
          .map(([member_id, raw]) => ({ member_id, amount: Number(raw) || 0 }))
          .filter(p => p.amount > 0);
        if (payments.length > 0) {
          primaryPayerId = payments.reduce((max, p) => (p.amount > max.amount ? p : max)).member_id;
        }
      }

      await api.addTripExpense(trip.id, {
        payer_id: primaryPayerId,
        description: description.trim(),
        amount: amt,
        split_kind: splitKindToSend,
        splits,
        payments,
      });
      await onSaved();
    } catch (e) {
      alert((e as Error).message);
    } finally { setSaving(false); }
  }

  return (
    <Sheet onClose={onClose} title="Add expense">
      <form onSubmit={save} className="flex flex-col gap-3">
        <Field label="What was it?">
          <input className={inputCls} placeholder="Dinner at Beach Cafe" autoFocus
                 value={description} onChange={e => setDescription(e.target.value)} />
        </Field>

        <Field label="Amount (₹)">
          <input className={inputCls} type="number" inputMode="decimal" placeholder="0"
                 value={amount} onChange={e => setAmount(e.target.value)} />
        </Field>

        {/* Paid by — single payer or partial */}
        <Field label="Paid by" hint="Who actually paid the bill. Use Partial when more than one person chipped in (e.g. ₹40 = A 16 + B 24).">
          <div className="flex items-center gap-1 mb-2">
            <SegBtn active={paymentKind === "single"}  onClick={() => setPaymentKind("single")}
                    title="One person paid the entire bill">Single</SegBtn>
            <SegBtn active={paymentKind === "partial"} onClick={() => setPaymentKind("partial")}
                    title="Multiple people contributed — set how much each one paid">Partial</SegBtn>
          </div>
          {paymentKind === "single" ? (
            <select className={inputCls} value={singlePayer} onChange={e => setSinglePayer(e.target.value)}>
              {trip.members.map(m => (<option key={m.id} value={m.id}>{m.display_name}</option>))}
            </select>
          ) : (
            <div className="flex flex-col gap-1">
              {trip.members.map(m => {
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

        <Field label="Split" hint="Who owes a share of this expense. Uncheck anyone who shouldn't be billed for it.">
          <div className="flex items-center gap-1 mb-2">
            <SegBtn active={splitKind === "equal"}  onClick={() => setSplitKind("equal")}
                    title="Divide the amount equally between the included members">Equal</SegBtn>
            <SegBtn active={splitKind === "custom"} onClick={() => setSplitKind("custom")}
                    title="Type each person's exact share — total must add up to the amount">Custom</SegBtn>
          </div>
          <div className="flex flex-col gap-1">
            {trip.members.map(m => (
              <label key={m.id} className="flex items-center gap-3 py-1.5 px-2 -mx-2 rounded hover:bg-zinc-800/30">
                <input
                  type="checkbox"
                  checked={included.has(m.id)}
                  onChange={e => {
                    const next = new Set(included);
                    e.target.checked ? next.add(m.id) : next.delete(m.id);
                    setIncluded(next);
                  }}
                  className="accent-violet-500"
                />
                <span className="text-sm text-zinc-200 flex-1">{m.display_name}</span>
                {splitKind === "custom" && included.has(m.id) && (
                  <input
                    className={cn(inputCls, "w-24 text-right")}
                    type="number" inputMode="decimal" placeholder="0"
                    value={shares[m.id] ?? ""}
                    onChange={e => setShares(s => ({ ...s, [m.id]: e.target.value }))}
                  />
                )}
              </label>
            ))}
          </div>
        </Field>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800/60 mt-1">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200">Cancel</button>
          <button type="submit" disabled={saving}
                  className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium disabled:opacity-50">
            {saving ? "Saving…" : "Save expense"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/* ────────────────────────── INVITE ────────────────────────── */

function InviteSheet({
  trip, onClose, onInvited,
}: {
  trip: TripDetail;
  onClose: () => void;
  onInvited: () => Promise<void>;
}) {
  const [email, setEmail]   = useState("");
  const [name,  setName]    = useState("");
  const [busy,  setBusy]    = useState(false);
  const [last,  setLast]    = useState<TripMember | null>(null);
  const [resending, setResending] = useState<string | null>(null);
  const [resentAt,  setResentAt]  = useState<Record<string, number>>({});

  async function send() {
    if (!email.includes("@") || !name.trim()) return;
    setBusy(true);
    try {
      const m = await api.inviteTripMember(trip.id, { email: email.trim(), display_name: name.trim() });
      setLast(m);
      setEmail(""); setName("");
      await onInvited();
    } catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  }

  async function resend(memberId: string) {
    setResending(memberId);
    try {
      await api.resendTripInvite(trip.id, memberId);
      setResentAt(s => ({ ...s, [memberId]: Date.now() }));
      await onInvited();
    } catch (e) { alert((e as Error).message); }
    finally { setResending(null); }
  }

  function copyLink(token: string) {
    const url = `${window.location.origin}/trips/guest/${token}`;
    navigator.clipboard.writeText(url).catch(() => {});
  }

  return (
    <Sheet onClose={onClose} title="Invite member">
      <p className="text-xs text-zinc-500">
        We'll email a sign-in-free link to join the trip. They can also use the link directly — no SubTracker account needed.
      </p>
      <FieldGrid>
        <Field label="Display name"><input autoFocus className={inputCls} placeholder="Aman" value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field label="Email">       <input className={inputCls} placeholder="aman@example.com" value={email} onChange={e => setEmail(e.target.value)} /></Field>
      </FieldGrid>
      <button onClick={send} disabled={busy || !email.includes("@") || !name.trim()}
              className="w-full py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium disabled:opacity-50">
        {busy ? "Sending invite…" : "Send invite"}
      </button>

      {last && last.invite_token && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-3 mt-2 flex items-center gap-2">
          <Check size={14} className="text-emerald-400 shrink-0" />
          <span className="text-xs text-zinc-300 flex-1 truncate">
            Invited <strong>{last.display_name}</strong> — copy link if email is slow
          </span>
          <button onClick={() => copyLink(last.invite_token!)}
                  className="inline-flex items-center gap-1 text-[11px] text-violet-300 hover:text-violet-200">
            <Copy size={11} /> copy
          </button>
        </div>
      )}

      {/* Pending invites with resend + copy-link (in case email didn't arrive) */}
      {trip.members.filter(m => m.invite_status === "pending" && m.invite_token).length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Pending invites</p>
          {trip.members.filter(m => m.invite_status === "pending" && m.invite_token).map(m => {
            const justResent = resentAt[m.id] && Date.now() - resentAt[m.id] < 4000;
            return (
              <div key={m.id} className="flex items-center gap-2 py-1.5 text-xs">
                <span className="text-zinc-300 truncate min-w-0 max-w-[120px]">{m.display_name}</span>
                <span className="text-zinc-600 truncate flex-1 min-w-0">{m.email}</span>
                <button
                  onClick={() => resend(m.id)}
                  disabled={resending === m.id}
                  title="Resend the invite email — also generates a fresh link, invalidating the old one"
                  className="inline-flex items-center gap-1 text-violet-300 hover:text-violet-200 disabled:opacity-50"
                >
                  {resending === m.id
                    ? <><Loader2 size={11} className="animate-spin" /> sending</>
                    : justResent
                      ? <><Check size={11} className="text-emerald-400" /> sent</>
                      : <><Send size={11} /> resend</>}
                </button>
                <button onClick={() => copyLink(m.invite_token!)}
                        title="Copy the invite link to your clipboard so you can share it manually (e.g. via WhatsApp)"
                        className="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-200">
                  <Copy size={11} /> link
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}

/* ────────────────────────── SETTLE ────────────────────────── */

function SettleView({
  trip, settlement, onClose,
}: {
  trip: TripDetail;
  settlement: TripSettlement;
  onClose: () => void;
}) {
  const transfers = settlement.transfers;
  if (transfers.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900 p-8 text-center">
        <Check size={28} className="mx-auto text-emerald-400" />
        <h2 className="text-lg font-semibold text-zinc-100 mt-3">Already settled ✓</h2>
        <p className="text-sm text-zinc-500 mt-1">Everyone's even. No transfers needed.</p>
        {trip.status !== "settled" && (
          <button onClick={onClose} className="mt-5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium">
            Mark trip as settled
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-400">
        Minimum {transfers.length} transfer{transfers.length !== 1 ? "s" : ""} to clear all balances:
      </p>
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900">
        {transfers.map((t, i) => (
          <TransferRow key={i} transfer={t} />
        ))}
      </div>
      <button onClick={onClose}
              className="self-end mt-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium">
        Mark trip as settled
      </button>
    </div>
  );
}

function TransferRow({ transfer }: { transfer: TripTransfer }) {
  const upi = transfer.to_upi_id
    ? `upi://pay?pa=${encodeURIComponent(transfer.to_upi_id)}&pn=${encodeURIComponent(transfer.to_display_name)}&am=${transfer.amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent("Trip settlement")}`
    : null;
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800/60 last:border-0">
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className="text-sm text-zinc-200 truncate">{transfer.from_display_name}</span>
        <ArrowRight size={12} className="text-zinc-600" />
        <span className="text-sm text-zinc-200 truncate">{transfer.to_display_name}</span>
      </div>
      <span className="num text-sm font-semibold text-zinc-100 shrink-0">{inr(transfer.amount)}</span>
      {upi ? (
        <a href={upi} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-violet-500/40 text-violet-200 hover:bg-violet-500/10 text-xs">
          <ExternalLink size={11} /> UPI
        </a>
      ) : (
        <span className="text-[11px] text-zinc-600">no UPI on file</span>
      )}
    </div>
  );
}

/* ────────────────────────── primitives ────────────────────────── */

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

function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-3 gap-y-2">{children}</div>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs uppercase tracking-wider font-semibold text-zinc-500">{children}</h2>;
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

function Sheet({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full sm:w-[min(92vw,520px)] max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-zinc-800 bg-zinc-900 p-5 flex flex-col gap-3"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
          <button onClick={onClose} className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/70">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
