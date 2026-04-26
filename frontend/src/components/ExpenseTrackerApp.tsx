import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  X, Plus, Users, ArrowLeft, ArrowRight, Mail, Trash2, Receipt,
  Sparkles, Check, Loader2, ExternalLink, Copy, Send,
  Search, Pencil, Download, Settings2, BarChart3, ListChecks,
  TrendingUp, TrendingDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { inrCompact, inr, relativeTime, fullTimestamp } from "@/lib/tokens";
import { navigate } from "@/lib/router";
import { AppSwitcher } from "@/components/AppSwitcher";
import * as api from "@/services/api";
import type {
  TrackerSummary, TrackerDetail, TrackerMember, TrackerExpense, TrackerExpenseSplit,
  TrackerSettlement, TrackerTransfer,
} from "@/services/api";

/**
 * Full-screen "Expense Tracker" app (formerly "Trackers"). Three views in
 * one component:
 *   - list   → all your trackers (trackers, daily-expense groups, etc.)
 *   - detail → expenses, balances, members for one tracker
 *   - settle → minimum-transfers settlement plan
 *
 * The instance-noun is still "tracker" inside identifiers + DB; only the
 * surface labels changed.
 */
type View = "list" | "detail" | "settle";

interface Props {
  /** Overlay-mode prop — when false, the component renders nothing.
   *  Standalone mode (driven by URL routing) ignores this and is always open. */
  open?: boolean;
  /** When true, this is the page itself (URL route) — internal navigation
   *  also pushes URL changes so back/forward + bookmarks work. */
  standalone?: boolean;
  /** Initial tracker id from the URL: e.g. /trackers/<id> */
  initialTrackerId?: string | null;
  onClose: () => void;
}

export function ExpenseTrackerApp({ open, standalone = false, initialTrackerId = null, onClose }: Props) {
  const isOpen = standalone || !!open;

  const [view, setView]         = useState<View>(initialTrackerId ? "detail" : "list");
  const [trackers, setTrackers]       = useState<TrackerSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initialTrackerId);
  const [detail, setDetail]     = useState<TrackerDetail | null>(null);
  const [settlement, setSettlement] = useState<TrackerSettlement | null>(null);
  const [loading, setLoading]   = useState(false);
  const [creating, setCreating] = useState(false);

  // Reset / fetch when (re)opened or when the URL-driven id changes.
  useEffect(() => {
    if (!isOpen) return;
    setSettlement(null);
    void refreshList();
    if (initialTrackerId) {
      setActiveId(initialTrackerId);
      setView("detail");
      void loadDetail(initialTrackerId);
    } else {
      setActiveId(null);
      setView("list");
      setDetail(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialTrackerId]);

  async function refreshList() {
    setLoading(true);
    try { setTrackers(await api.listTrackers()); }
    finally { setLoading(false); }
  }

  async function loadDetail(id: string) {
    setLoading(true);
    try { setDetail(await api.getTracker(id)); }
    finally { setLoading(false); }
  }

  async function openTracker(id: string) {
    setActiveId(id);
    setView("detail");
    if (standalone) navigate(`/trackers/${id}`);
    await loadDetail(id);
  }

  function backToList() {
    setView("list");
    setActiveId(null);
    setDetail(null);
    if (standalone) navigate("/trackers");
  }

  async function reloadDetail() {
    if (!activeId) return;
    setDetail(await api.getTracker(activeId));
  }

  async function openSettlement() {
    if (!activeId) return;
    setLoading(true);
    try {
      setSettlement(await api.getTrackerSettlement(activeId));
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
            {view === "list"  && "Expense Tracker"}
            {view === "detail" && (detail?.name ?? "Tracker")}
            {view === "settle" && "Settlement plan"}
          </h1>
          <div className="flex-1" />
          <AppSwitcher current="trackers" />
          <button onClick={onClose}
                  title="Close trackers and go back to SubTracker"
                  className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/70" aria-label="Close">
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="max-w-[960px] mx-auto px-5 py-6">
        {view === "list" && (
          <ListView
            trackers={trackers}
            loading={loading}
            creating={creating}
            onCreate={async (name) => {
              setCreating(true);
              try {
                const tracker = await api.createTracker({ name });
                await refreshList();
                openTracker(tracker.id);
              } finally { setCreating(false); }
            }}
            onOpen={openTracker}
          />
        )}
        {view === "detail" && detail && (
          <DetailView
            tracker={detail}
            loading={loading}
            onChange={reloadDetail}
            onSettle={openSettlement}
            onDeleted={() => { void refreshList(); backToList(); }}
          />
        )}
        {view === "settle" && settlement && detail && (
          <SettleView
            tracker={detail}
            settlement={settlement}
            onClose={async () => {
              await api.updateTracker(detail.id, { status: "settled" });
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
  trackers, loading, creating, onCreate, onOpen,
}: {
  trackers: TrackerSummary[];
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

  // Aggregate view-level totals so the user lands on something meaningful
  // even before opening a specific tracker.
  const overall = useMemo(() => {
    const tot = trackers.reduce((s, t) => s + Number(t.total_spent ?? 0), 0);
    const owe = trackers.reduce((s, t) => s + (Number(t.my_balance ?? 0) < 0 ? -Number(t.my_balance ?? 0) : 0), 0);
    const owed = trackers.reduce((s, t) => s + (Number(t.my_balance ?? 0) > 0 ?  Number(t.my_balance ?? 0) : 0), 0);
    const active = trackers.filter(t => t.status === "active").length;
    return { tot, owe, owed, active };
  }, [trackers]);

  return (
    <div className="flex flex-col gap-6 pb-10">
      {/* Hero — overall snapshot across all of your trackers */}
      <div className="relative overflow-hidden rounded-3xl border border-zinc-800/60 bg-gradient-to-br from-violet-500/10 via-zinc-900 to-zinc-950 p-6">
        <div aria-hidden className="pointer-events-none absolute -top-20 -right-20 w-56 h-56 rounded-full bg-violet-500/15 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-20 -left-10 w-56 h-56 rounded-full bg-fuchsia-500/10 blur-3xl" />
        <div className="relative">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-400 mb-1">Expense Tracker</div>
          <h2 className="text-zinc-100 text-2xl sm:text-3xl font-semibold tracking-tight max-w-xl">
            Trackers, daily spends, dinner clubs — split fairly, settle in two taps.
          </h2>
          <p className="text-sm text-zinc-400 mt-2 max-w-2xl">
            One place for any group ledger: a Goa tracker, your roommate utilities, the Friday-night
            dinner crew. Every payment, every share, who owes whom — and the minimum number of
            transfers to clear it all.
          </p>
          <div className="mt-5 flex flex-wrap gap-3 text-[11px] text-zinc-500">
            <Stat label="Active trackers" value={String(overall.active)} />
            <Stat label="Total tracked" value={inrCompact(overall.tot)} />
            {overall.owed > 0.01 && <Stat label="You're owed" value={`+${inrCompact(overall.owed)}`} accent="emerald" />}
            {overall.owe  > 0.01 && <Stat label="You owe"     value={inrCompact(overall.owe)}        accent="red" />}
          </div>
        </div>
      </div>

      {/* Create */}
      <form
        onSubmit={submit}
        className="rounded-2xl border border-zinc-800/60 bg-zinc-900 p-4 sm:p-5 flex items-center gap-3"
      >
        <Sparkles size={16} className="text-violet-400 shrink-0" />
        <input
          ref={inputRef}
          className="flex-1 bg-zinc-950 border border-zinc-700/70 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/60"
          placeholder="New tracker (e.g. Goa Apr 2026, Roommate utilities, Dinner club)"
          value={newName}
          onChange={e => setNewName(e.target.value)}
        />
        <button
          type="submit"
          disabled={creating}
          title="Create a new tracker — invite members by email and start logging shared expenses"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium disabled:opacity-50"
        >
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create
        </button>
      </form>

      {/* List */}
      <div className="flex flex-col">
        {loading && trackers.length === 0 ? (
          <div className="text-center py-12 text-zinc-500"><Loader2 size={20} className="text-violet-400 animate-spin mx-auto" /></div>
        ) : trackers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 p-12 text-center text-sm text-zinc-500 max-w-xl mx-auto">
            <Users size={20} className="mx-auto mb-3 text-violet-400" />
            <p className="text-zinc-300 font-medium mb-1">No trackers yet.</p>
            <p>Create one above to split a tracker's costs, your roommate utilities, or anything else with shared bills.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {trackers.map(t => {
              const myBal = Number(t.my_balance ?? 0);
              const tone =
                myBal >  0.01 ? "emerald" :
                myBal < -0.01 ? "red"     :
                                "zinc";
              return (
                <button
                  key={t.id}
                  onClick={() => onOpen(t.id)}
                  className="text-left rounded-2xl border border-zinc-800/60 bg-zinc-900 hover:border-violet-500/40 hover:bg-zinc-900/80 p-5 transition-colors group"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-base font-semibold text-zinc-100 truncate group-hover:text-violet-100">{t.name}</h3>
                    <span className={cn(
                      "text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0",
                      t.status === "settled"  ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/30" :
                      t.status === "archived" ? "text-zinc-400 bg-zinc-800/50 border-zinc-700"            :
                                                "text-violet-300 bg-violet-500/10 border-violet-500/30",
                    )}>{t.status}</span>
                  </div>
                  {(t.start_date || t.end_date) && (
                    <p className="text-[11px] text-zinc-500 mt-1 num">
                      {t.start_date} {t.end_date && `– ${t.end_date}`}
                    </p>
                  )}

                  {/* Stat row — total spent, members, your balance */}
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <MiniStat label="Spent"   value={inrCompact(Number(t.total_spent ?? 0))} />
                    <MiniStat label="Members" value={String(t.members_count ?? 0)} />
                    <MiniStat
                      label="Your balance"
                      value={
                        Math.abs(myBal) < 0.01 ? "settled" :
                        myBal > 0           ? `+${inrCompact(myBal)}` :
                                              `${inrCompact(myBal)}`
                      }
                      tone={tone}
                    />
                  </div>

                  {(t.expenses_count ?? 0) > 0 && (
                    <p className="text-[11px] text-zinc-600 mt-3">
                      {t.expenses_count} expense{t.expenses_count === 1 ? "" : "s"} logged · open to view
                    </p>
                  )}
                  {t.note && <p className="text-xs text-zinc-500 mt-2 line-clamp-2">{t.note}</p>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "emerald" | "red" }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2 backdrop-blur">
      <div className="text-[9px] uppercase tracking-wider font-semibold text-zinc-500">{label}</div>
      <div className={cn(
        "num text-sm font-semibold",
        accent === "emerald" ? "text-emerald-300" :
        accent === "red"     ? "text-red-300"     :
                               "text-zinc-100",
      )}>{value}</div>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "red" | "zinc" }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</span>
      <span className={cn(
        "num text-sm font-medium",
        tone === "emerald" ? "text-emerald-400" :
        tone === "red"     ? "text-red-400"     :
                             "text-zinc-100",
      )}>{value}</span>
    </div>
  );
}

/* ────────────────────────── DETAIL ────────────────────────── */

function DetailView({
  tracker, loading, onChange, onSettle, onDeleted,
}: {
  tracker: TrackerDetail;
  loading: boolean;
  onChange: () => Promise<void>;
  onSettle: () => void;
  onDeleted: () => void;
}) {
  const [showSheet, setShowSheet]   = useState<TrackerExpense | "new" | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [showInfo, setShowInfo]     = useState(false);
  const [tab, setTab]               = useState<"activity" | "stats">("activity");
  const [search, setSearch]         = useState("");

  const totalSpent = useMemo(
    () => tracker.expenses.reduce((s, e) => s + Number(e.amount || 0), 0),
    [tracker.expenses],
  );

  const memberStats = useMemo(() => buildMemberStats(tracker), [tracker]);
  const greedyTransfers = useMemo(() => greedyDebt(tracker.balances), [tracker.balances]);

  const filteredExpenses = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tracker.expenses;
    return tracker.expenses.filter(e => {
      if (e.description.toLowerCase().includes(q)) return true;
      const payerNames = (e.payments?.length ? e.payments.map(p => p.member_id) : [e.payer_id])
        .map(id => tracker.members.find(m => m.id === id)?.display_name?.toLowerCase() ?? "");
      return payerNames.some(n => n.includes(q));
    });
  }, [search, tracker.expenses, tracker.members]);

  const filteredTotal = filteredExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const groupedExpenses = useMemo(() => groupByDate(filteredExpenses), [filteredExpenses]);

  return (
    <div className="flex flex-col gap-5 pb-24">
      {/* Hero — gradient with subtle radial glow, larger numbers, sticky-ish action row. */}
      <div className="relative overflow-hidden rounded-3xl border border-zinc-800/60 bg-gradient-to-br from-violet-500/10 via-zinc-900 to-zinc-950 p-6">
        <div aria-hidden className="pointer-events-none absolute -top-20 -right-20 w-56 h-56 rounded-full bg-violet-500/15 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-20 -left-10 w-56 h-56 rounded-full bg-fuchsia-500/10 blur-3xl" />
        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-zinc-400">Total spent</span>
              {tracker.status !== "active" && (
                <span className={cn(
                  "text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border",
                  tracker.status === "settled"  ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/30" :
                                               "text-zinc-400 bg-zinc-800/50 border-zinc-700",
                )}>{tracker.status}</span>
              )}
            </div>
            <div className="num text-4xl sm:text-5xl font-semibold text-zinc-100 tracking-tight">{inrCompact(totalSpent)}</div>
            <div className="text-xs text-zinc-500 mt-2">
              {tracker.expenses.length} expense{tracker.expenses.length !== 1 ? "s" : ""} · {tracker.members.length} member{tracker.members.length !== 1 ? "s" : ""}
              {(tracker.start_date || tracker.end_date) && <span className="ml-1.5 text-zinc-600 num">· {tracker.start_date}{tracker.end_date && ` – ${tracker.end_date}`}</span>}
            </div>
            {tracker.note && <p className="text-xs text-zinc-500 mt-2 max-w-xl line-clamp-2">{tracker.note}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowInfo(true)}
              title="Edit tracker name, dates, notes — or delete it"
              className="p-2 rounded-lg border border-zinc-700/70 hover:bg-zinc-800/60 text-zinc-300"
            ><Settings2 size={14} /></button>
            <button
              onClick={() => exportTrackerCsv(tracker)}
              title="Download all expenses as a CSV file"
              className="p-2 rounded-lg border border-zinc-700/70 hover:bg-zinc-800/60 text-zinc-300"
            ><Download size={14} /></button>
            <button
              onClick={() => setShowInvite(true)}
              title="Invite someone by email"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-zinc-700/70 hover:bg-zinc-800/60 text-zinc-300 text-sm"
            >
              <Mail size={14} /> Invite
            </button>
            <button
              onClick={onSettle}
              title="Compute the minimum number of payments to clear all balances"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium shadow-lg shadow-violet-600/20"
            >
              <Sparkles size={14} /> Settle
            </button>
          </div>
        </div>
      </div>

      {/* Member chips with their net balance + creator-only remove */}
      <section>
        <SectionTitle>Members</SectionTitle>
        <div className="flex flex-wrap gap-2 mt-2">
          {tracker.members.map(m => {
            const bal = tracker.balances.find(b => b.member_id === m.id);
            const net = bal?.net ?? 0;
            // We show the remove (×) chip on every member except the creator
            // — the backend enforces the creator-only check anyway, and also
            // refuses if the member has any expense activity (would break
            // the math). The chip is hidden if the API would reject.
            const isCreator = m.invite_status === "creator";
            const hasActivity = (bal?.paid ?? 0) > 0 || (bal?.owed ?? 0) > 0;
            const canRemove = !isCreator && !hasActivity;
            const memberTip =
              net > 0.01  ? `${m.display_name} is owed ${inr(net)} overall`  :
              net < -0.01 ? `${m.display_name} owes ${inr(-net)} overall`    :
                            `${m.display_name} is settled — paid and owes the same amount`;
            return (
              <div key={m.id}
                   title={memberTip}
                   className="group rounded-full border border-zinc-800 bg-zinc-900/80 backdrop-blur px-3 py-1.5 flex items-center gap-2">
                <span className="text-sm text-zinc-200">{m.display_name}</span>
                {m.invite_status === "pending" && (
                  <span title="This member hasn't opened their invite link yet"
                        className="text-[10px] uppercase tracking-wider text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-1.5">pending</span>
                )}
                {isCreator && (
                  <span title="Creator of this tracker — can't be removed"
                        className="text-[10px] uppercase tracking-wider text-violet-300 bg-violet-500/10 border border-violet-500/30 rounded px-1.5">creator</span>
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
                {canRemove && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!confirm(`Remove ${m.display_name} from this tracker? They have no expenses, so balances stay intact.`)) return;
                      try {
                        await api.removeTrackerMember(tracker.id, m.id);
                        await onChange();
                      } catch (err) { alert((err as Error).message); }
                    }}
                    title={`Remove ${m.display_name} from this tracker`}
                    className="ml-0.5 -mr-1.5 w-5 h-5 rounded-full text-zinc-500 hover:text-red-300 hover:bg-red-500/10 inline-flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                  >
                    <X size={11} />
                  </button>
                )}
                {!canRemove && hasActivity && !isCreator && (
                  <span
                    title="Can't be removed — they're already on at least one expense. Delete those first."
                    className="ml-0.5 -mr-1 text-[10px] text-zinc-600 cursor-help"
                  >locked</span>
                )}
              </div>
            );
          })}
          <button
            onClick={() => setShowInvite(true)}
            title="Invite another member to this tracker"
            className="rounded-full border border-dashed border-zinc-700 px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-200 hover:border-zinc-500"
          >
            + invite
          </button>
        </div>
      </section>

      {/* Tabs */}
      <div className="inline-flex rounded-xl border border-zinc-800 bg-zinc-900 p-1 self-start">
        <TabBtn active={tab === "activity"} onClick={() => setTab("activity")} icon={<ListChecks size={13} />}>Activity</TabBtn>
        <TabBtn active={tab === "stats"}    onClick={() => setTab("stats")}    icon={<BarChart3 size={13} />}>Stats</TabBtn>
      </div>

      {tab === "activity" && (
        <section className="flex flex-col gap-3">
          {/* Search */}
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

          {search && (
            <div className="text-[11px] text-zinc-500 num">
              {filteredExpenses.length} match{filteredExpenses.length !== 1 ? "es" : ""} · {inrCompact(filteredTotal)}
            </div>
          )}

          {/* Grouped expenses */}
          {filteredExpenses.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-8 rounded-2xl border border-dashed border-zinc-800">
              {search
                ? "No expenses match that search."
                : "No expenses yet. Tap \"Add expense\" to record the first one."}
            </p>
          ) : (
            <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 overflow-hidden">
              {groupedExpenses.map(g => (
                <div key={g.date}>
                  <div className="px-4 py-2 border-b border-zinc-800/40 bg-zinc-900/80 backdrop-blur sticky top-0 flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500">
                      {formatDayHeader(g.date)}
                    </span>
                    <span className="text-[11px] num text-zinc-500">{inrCompact(g.total)}</span>
                  </div>
                  {g.items.map(e => (
                    <ExpenseRow
                      key={e.id}
                      expense={e}
                      members={tracker.members}
                      onEdit={() => setShowSheet(e)}
                      onDelete={async () => {
                        if (!confirm("Delete this expense?")) return;
                        await api.deleteTrackerExpense(tracker.id, e.id);
                        await onChange();
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "stats" && (
        <StatsPanel tracker={tracker} stats={memberStats} transfers={greedyTransfers} />
      )}

      {/* Sticky bottom action bar — primary "Add expense" always within thumb reach */}
      <div className="fixed bottom-4 inset-x-0 z-[40] pointer-events-none">
        <div className="max-w-[960px] mx-auto px-5 flex justify-end">
          <button
            onClick={() => setShowSheet("new")}
            title="Record a shared expense"
            className="pointer-events-auto inline-flex items-center gap-2 px-4 py-3 rounded-full bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium shadow-2xl shadow-violet-900/40 ring-1 ring-violet-400/30"
          >
            <Plus size={16} /> Add expense
          </button>
        </div>
      </div>

      {showSheet && (
        <ExpenseSheet
          tracker={tracker}
          existing={showSheet === "new" ? undefined : showSheet}
          onClose={() => setShowSheet(null)}
          onSaved={async () => { setShowSheet(null); await onChange(); }}
        />
      )}
      {showInvite && (
        <InviteSheet
          tracker={tracker}
          onClose={() => setShowInvite(false)}
          onInvited={async () => { await onChange(); }}
        />
      )}
      {showInfo && (
        <TrackerInfoSheet
          tracker={tracker}
          onClose={() => setShowInfo(false)}
          onSaved={async () => { setShowInfo(false); await onChange(); }}
          onDeleted={() => { setShowInfo(false); onDeleted(); }}
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
  expense, members, onEdit, onDelete,
}: {
  expense: TrackerExpense;
  members: TrackerMember[];
  onEdit?: () => void;
  onDelete: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const payer = members.find(m => m.id === expense.payer_id);
  const multi = (expense.payments?.length ?? 0) > 1;
  const paidLabel = multi ? `${expense.payments.length} paid` : `${payer?.display_name ?? "?"} paid`;
  return (
    <div className="border-b border-zinc-800/40 last:border-b-0 hover:bg-zinc-800/20 transition-colors">
      <div className="px-3 sm:px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
          title="Click to see split details"
        >
          <span className="h-8 w-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-300 shrink-0">
            <Receipt size={14} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-zinc-100 truncate">{expense.description}</div>
            <div className="text-[11px] text-zinc-500 truncate">
              {paidLabel} · {expense.split_kind === "equal" ? `split ${expense.splits.length}` : "custom split"}
              <span className="ml-1 text-zinc-600" title={`Added ${fullTimestamp(expense.created_at)}`}>
                · {relativeTime(expense.created_at)}
              </span>
            </div>
          </div>
          <span className="num text-sm font-medium text-zinc-100 shrink-0">{inrCompact(expense.amount)}</span>
        </button>
        {onEdit && (
          <button onClick={onEdit}
                  title="Edit this expense"
                  className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/70">
            <Pencil size={12} />
          </button>
        )}
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
                  title="Permanently remove this expense — recalculates balances for everyone"
                  className="self-start mt-1 inline-flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300">
            <Trash2 size={11} /> Delete expense
          </button>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────── ADD / EDIT EXPENSE ──────────────────────────
   Single sheet handles both add and edit. When `existing` is provided, state
   is hydrated from it and Save calls updateTrackerExpense; otherwise it's a
   blank create form. Keeping one sheet avoids drift between the two flows.
   ───────────────────────────────────────────────────────────────────── */

function ExpenseSheet({
  tracker, existing, onClose, onSaved,
}: {
  tracker: TrackerDetail;
  /** Optional — when set, the sheet edits this expense in place. */
  existing?: TrackerExpense;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  // Hydrate from existing on first render. The `splits` array determines who
  // was included; if every member has a split, it's effectively "equal".
  const initial = useMemo(() => {
    if (!existing) {
      return {
        description: "",
        amount: "",
        date: new Date().toISOString().slice(0, 10),
        splitKind: "equal" as const,
        included: new Set(tracker.members.map(m => m.id)),
        shares: {} as Record<string, string>,
        paymentKind: "single" as const,
        singlePayer: tracker.members[0]?.id ?? "",
        paid: {} as Record<string, string>,
      };
    }
    const includedIds = new Set(existing.splits.map(s => s.member_id));
    const sharesRec: Record<string, string> = {};
    existing.splits.forEach(s => { sharesRec[s.member_id] = String(s.share); });
    const paidRec: Record<string, string> = {};
    (existing.payments ?? []).forEach(p => { paidRec[p.member_id] = String(p.amount); });
    const isMulti = (existing.payments?.length ?? 0) > 1;
    return {
      description: existing.description,
      amount: String(existing.amount),
      date: existing.expense_date,
      splitKind: existing.split_kind,
      included: includedIds,
      shares: sharesRec,
      paymentKind: (isMulti ? "partial" : "single") as "single" | "partial",
      singlePayer: existing.payer_id,
      paid: paidRec,
    };
  }, [existing, tracker.members]);

  const [description, setDescription] = useState(initial.description);
  const [amount, setAmount]           = useState(initial.amount);
  const [date, setDate]               = useState(initial.date);
  const [splitKind, setSplitKind]     = useState<"equal" | "custom">(initial.splitKind);
  const [included, setIncluded]       = useState<Set<string>>(initial.included);
  const [shares, setShares]           = useState<Record<string, string>>(initial.shares);
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

  // Share drift for the custom-split case so users can see when their inputs
  // don't add up.
  const shareTotal = useMemo(() => {
    if (splitKind !== "custom") return 0;
    return [...included].reduce((s, id) => s + (Number(shares[id]) || 0), 0);
  }, [splitKind, included, shares]);
  const shareDrift = +(amt - shareTotal).toFixed(2);

  async function save(ev?: React.FormEvent) {
    ev?.preventDefault();
    if (!description.trim() || !amt || saving) return;
    if (!paidValid) {
      alert(paymentKind === "partial"
        ? `Sum of partial payments (₹${paidTotal}) must equal amount (₹${amt}).`
        : "Pick who paid.");
      return;
    }
    if (splitKind === "custom" && Math.abs(shareDrift) > 0.5) {
      alert(`Custom shares total ₹${shareTotal} but the expense is ₹${amt}.`);
      return;
    }
    setSaving(true);
    try {
      // ── Splits side ───────────────────────────────────────────────────
      let splits: TrackerExpenseSplit[] | undefined;
      let splitKindToSend: "equal" | "custom" = "equal";
      if (splitKind === "equal") {
        if (included.size === tracker.members.length) {
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
        splits = tracker.members
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
      } else {
        // Materialize a single-payer payment row on edit too, so legacy
        // expenses get a proper payments record after their first edit.
        payments = [{ member_id: primaryPayerId, amount: amt }];
      }

      const payload = {
        payer_id: primaryPayerId,
        description: description.trim(),
        amount: amt,
        expense_date: date,
        split_kind: splitKindToSend,
        splits,
        payments,
      };
      if (existing) {
        await api.updateTrackerExpense(tracker.id, existing.id, payload);
      } else {
        await api.addTrackerExpense(tracker.id, payload);
      }
      await onSaved();
    } catch (e) {
      alert((e as Error).message);
    } finally { setSaving(false); }
  }

  return (
    <Sheet onClose={onClose} title={existing ? "Edit expense" : "Add expense"}>
      <form onSubmit={save} className="flex flex-col gap-3">
        <Field label="What was it?">
          <input className={inputCls} placeholder="Dinner at Beach Cafe" autoFocus
                 value={description} onChange={e => setDescription(e.target.value)} />
        </Field>

        <FieldGrid>
          <Field label="Amount (₹)">
            <input className={inputCls} type="number" inputMode="decimal" placeholder="0"
                   value={amount} onChange={e => setAmount(e.target.value)} />
          </Field>
          <Field label="Date">
            <input className={inputCls} type="date"
                   value={date} onChange={e => setDate(e.target.value)} />
          </Field>
        </FieldGrid>

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

        <Field label="Split" hint="Who owes a share of this expense. Uncheck anyone who shouldn't be billed for it.">
          <div className="flex items-center gap-1 mb-2">
            <SegBtn active={splitKind === "equal"}  onClick={() => setSplitKind("equal")}
                    title="Divide the amount equally between the included members">Equal</SegBtn>
            <SegBtn active={splitKind === "custom"} onClick={() => setSplitKind("custom")}
                    title="Type each person's exact share — total must add up to the amount">Custom</SegBtn>
          </div>
          <div className="flex flex-col gap-1">
            {tracker.members.map(m => (
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
            {splitKind === "custom" && (
              <div className={cn(
                "flex items-center justify-between text-[11px] mt-1 num",
                Math.abs(shareDrift) <= 0.5 ? "text-zinc-500" : "text-amber-400",
              )}>
                <span>shares {inrCompact(shareTotal)} of {inrCompact(amt)}</span>
                {Math.abs(shareDrift) > 0.5 && (
                  <span>{shareDrift > 0 ? `${inrCompact(shareDrift)} short` : `${inrCompact(-shareDrift)} extra`}</span>
                )}
              </div>
            )}
          </div>
        </Field>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800/60 mt-1">
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

/* ────────────────────────── INVITE ────────────────────────── */

function InviteSheet({
  tracker, onClose, onInvited,
}: {
  tracker: TrackerDetail;
  onClose: () => void;
  onInvited: () => Promise<void>;
}) {
  const [email, setEmail]   = useState("");
  const [name,  setName]    = useState("");
  const [busy,  setBusy]    = useState(false);
  const [last,  setLast]    = useState<TrackerMember | null>(null);
  const [resending, setResending] = useState<string | null>(null);
  const [resentAt,  setResentAt]  = useState<Record<string, number>>({});

  async function send() {
    if (!email.includes("@") || !name.trim()) return;
    setBusy(true);
    try {
      const m = await api.inviteTrackerMember(tracker.id, { email: email.trim(), display_name: name.trim() });
      setLast(m);
      setEmail(""); setName("");
      await onInvited();
    } catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  }

  async function resend(memberId: string) {
    setResending(memberId);
    try {
      await api.resendTrackerInvite(tracker.id, memberId);
      setResentAt(s => ({ ...s, [memberId]: Date.now() }));
      await onInvited();
    } catch (e) { alert((e as Error).message); }
    finally { setResending(null); }
  }

  function copyLink(token: string) {
    const url = `${window.location.origin}/trackers/guest/${token}`;
    navigator.clipboard.writeText(url).catch(() => {});
  }

  return (
    <Sheet onClose={onClose} title="Invite member">
      <p className="text-xs text-zinc-500">
        We'll email a sign-in-free link to join the tracker. They can also use the link directly — no SubTracker account needed.
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
      {tracker.members.filter(m => m.invite_status === "pending" && m.invite_token).length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Pending invites</p>
          {tracker.members.filter(m => m.invite_status === "pending" && m.invite_token).map(m => {
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
  tracker, settlement, onClose,
}: {
  tracker: TrackerDetail;
  settlement: TrackerSettlement;
  onClose: () => void;
}) {
  const transfers = settlement.transfers;
  if (transfers.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900 p-8 text-center">
        <Check size={28} className="mx-auto text-emerald-400" />
        <h2 className="text-lg font-semibold text-zinc-100 mt-3">Already settled ✓</h2>
        <p className="text-sm text-zinc-500 mt-1">Everyone's even. No transfers needed.</p>
        {tracker.status !== "settled" && (
          <button onClick={onClose} className="mt-5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium">
            Mark as settled
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
        Mark as settled
      </button>
    </div>
  );
}

function TransferRow({ transfer }: { transfer: TrackerTransfer }) {
  const upi = transfer.to_upi_id
    ? `upi://pay?pa=${encodeURIComponent(transfer.to_upi_id)}&pn=${encodeURIComponent(transfer.to_display_name)}&am=${transfer.amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent("Tracker settlement")}`
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

/* ────────────────────────── STATS ────────────────────────── */

interface MemberStat {
  member_id: string;
  display_name: string;
  paid: number;        // total they actually shelled out
  share: number;       // total they're billed for (their splits)
  net: number;         // paid − share (positive = owed money back)
  expenses_count: number;
  share_pct: number;   // their share of total tracker cost (0..1)
}

function buildMemberStats(tracker: TrackerDetail): MemberStat[] {
  const totalCost = tracker.expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  return tracker.members.map(m => {
    let paid = 0;
    let share = 0;
    let count = 0;
    for (const e of tracker.expenses) {
      // Paid: prefer per-expense payments, else fall back to the single payer.
      if (e.payments?.length) {
        const myPay = e.payments.find(p => p.member_id === m.id);
        if (myPay) paid += Number(myPay.amount);
      } else if (e.payer_id === m.id) {
        paid += Number(e.amount);
      }
      // Share: from the splits table.
      const myShare = e.splits.find(s => s.member_id === m.id);
      if (myShare) {
        share += Number(myShare.share);
        count += 1;
      }
    }
    return {
      member_id: m.id,
      display_name: m.display_name,
      paid: +paid.toFixed(2),
      share: +share.toFixed(2),
      net: +(paid - share).toFixed(2),
      expenses_count: count,
      share_pct: totalCost > 0 ? +(share / totalCost).toFixed(4) : 0,
    };
  });
}

function StatsPanel({ tracker, stats, transfers }: {
  tracker: TrackerDetail;
  stats: MemberStat[];
  transfers: { from: string; to: string; amount: number }[];
}) {
  const sortedBySpend = [...stats].sort((a, b) => b.paid - a.paid);
  const maxPaid = Math.max(1, ...stats.map(s => s.paid));
  const nameOf = (id: string) => tracker.members.find(m => m.id === id)?.display_name ?? "?";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Per-member breakdown */}
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-zinc-100">Who spent how much</h3>
          <span className="text-[11px] text-zinc-500">paid · share · net</span>
        </div>
        <div className="flex flex-col gap-3">
          {sortedBySpend.map(s => {
            const trend = s.net > 0.01 ? "up" : s.net < -0.01 ? "down" : "flat";
            return (
              <div key={s.member_id}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm text-zinc-100 truncate">{s.display_name}</span>
                  <span className="num text-sm text-zinc-100">{inrCompact(s.paid)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-400"
                    style={{ width: `${(s.paid / maxPaid) * 100}%` }}
                  />
                </div>
                <div className="flex items-center justify-between mt-1.5 text-[11px] text-zinc-500 num">
                  <span>share {inrCompact(s.share)} ({(s.share_pct * 100).toFixed(0)}%)</span>
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
      </div>

      {/* Who owes whom — pending transfers */}
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-zinc-100">Who owes whom</h3>
          <span className="text-[11px] text-zinc-500">pending</span>
        </div>
        {transfers.length === 0 ? (
          <div className="text-sm text-zinc-500 py-6 text-center">
            <Check size={20} className="text-emerald-400 mx-auto mb-2" />
            Everyone's settled. No pending transfers.
          </div>
        ) : (
          <div className="flex flex-col">
            {transfers.map((t, i) => (
              <div key={i} className="flex items-center gap-2 py-2 border-b border-zinc-800/40 last:border-b-0">
                <span className="text-sm text-zinc-200 truncate flex-1">{nameOf(t.from)}</span>
                <ArrowRight size={12} className="text-zinc-600" />
                <span className="text-sm text-zinc-200 truncate flex-1">{nameOf(t.to)}</span>
                <span className="num text-sm font-medium text-zinc-100 shrink-0">{inr(t.amount)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between mt-3 text-[11px] text-zinc-500 num">
              <span>{transfers.length} transfer{transfers.length !== 1 ? "s" : ""} to clear all balances</span>
              <span>total {inrCompact(transfers.reduce((s, t) => s + t.amount, 0))}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────── TRACKER INFO ────────────────────────── */

function TrackerInfoSheet({
  tracker, onClose, onSaved, onDeleted,
}: {
  tracker: TrackerDetail;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onDeleted: () => void;
}) {
  const [name, setName]     = useState(tracker.name);
  const [start, setStart]   = useState(tracker.start_date ?? "");
  const [end, setEnd]       = useState(tracker.end_date ?? "");
  const [note, setNote]     = useState(tracker.note ?? "");
  const [busy, setBusy]     = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function save(ev?: React.FormEvent) {
    ev?.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await api.updateTracker(tracker.id, {
        name: name.trim(),
        start_date: start || undefined,
        end_date: end || undefined,
        note: note.trim() || undefined,
      });
      await onSaved();
    } catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  }

  async function destroy() {
    // Two-step confirm: typing the name avoids accidental deletion of a
    // tracker with real money behind it. Backend cascades all child rows.
    const typed = window.prompt(
      `This permanently deletes "${tracker.name}" — all expenses, splits, and balances. Type the name to confirm:`,
      "",
    );
    if (typed == null) return;
    if (typed.trim() !== tracker.name.trim()) {
      alert("Name didn't match. Nothing deleted.");
      return;
    }
    setDeleting(true);
    try {
      await api.deleteTracker(tracker.id);
      onDeleted();
    } catch (e) { alert((e as Error).message); }
    finally { setDeleting(false); }
  }

  return (
    <Sheet onClose={onClose} title="Tracker details">
      <form onSubmit={save} className="flex flex-col gap-3">
        <Field label="Name">
          <input className={inputCls} value={name} onChange={e => setName(e.target.value)} autoFocus />
        </Field>
        <FieldGrid>
          <Field label="Start date">
            <input className={inputCls} type="date" value={start ?? ""} onChange={e => setStart(e.target.value)} />
          </Field>
          <Field label="End date">
            <input className={inputCls} type="date" value={end ?? ""} onChange={e => setEnd(e.target.value)} />
          </Field>
        </FieldGrid>
        <Field label="Notes" hint="Visible to all members. Anything you want to remember about this tracker.">
          <textarea
            className={cn(inputCls, "min-h-[88px] resize-y")}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Goa house code: 4827. Rented bikes Sat–Mon."
          />
        </Field>
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800/60 mt-1">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200">Cancel</button>
          <button type="submit" disabled={busy}
                  className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium disabled:opacity-50">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>

      {/* Danger zone — separate visual block so users don't fat-finger it */}
      <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/5 p-3">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-red-300 mb-1">Danger zone</div>
        <p className="text-xs text-zinc-400 mb-2">
          Deleting removes the tracker, every expense, every split, every payment. There's no undo.
        </p>
        <button
          type="button"
          onClick={destroy}
          disabled={deleting}
          title="Permanently delete this tracker — only the creator can do this"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-500/40 text-red-300 hover:bg-red-500/10 text-xs font-medium disabled:opacity-50"
        >
          {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
          {deleting ? "Deleting…" : "Delete tracker"}
        </button>
      </div>
    </Sheet>
  );
}

/* ────────────────────────── helpers ────────────────────────── */

function groupByDate(expenses: TrackerExpense[]): { date: string; total: number; items: TrackerExpense[] }[] {
  const groups: Record<string, TrackerExpense[]> = {};
  for (const e of expenses) {
    (groups[e.expense_date] ??= []).push(e);
  }
  return Object.keys(groups)
    .sort((a, b) => (a < b ? 1 : -1)) // descending date
    .map(date => ({
      date,
      total: groups[date].reduce((s, e) => s + Number(e.amount || 0), 0),
      items: groups[date],
    }));
}

function formatDayHeader(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that  = new Date(d); that.setHours(0, 0, 0, 0);
  const days  = Math.round((today.getTime() - that.getTime()) / 86400000);
  if (days === 0) return "Today · " + d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  if (days === 1) return "Yesterday · " + d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: days > 200 ? "numeric" : undefined });
}

/** Greedy debt simplification — same algo as backend's compute_settlement,
 *  used here so the Stats panel can show pending transfers without an
 *  extra round-tracker. */
function greedyDebt(balances: { member_id: string; net: number }[]): { from: string; to: string; amount: number }[] {
  const cred = balances.filter(b => b.net > 0.005).map(b => ({ ...b })).sort((a, b) => b.net - a.net);
  const debt = balances.filter(b => b.net < -0.005).map(b => ({ ...b, net: -b.net })).sort((a, b) => b.net - a.net);
  const out: { from: string; to: string; amount: number }[] = [];
  let i = 0, j = 0;
  while (i < cred.length && j < debt.length) {
    const amt = +Math.min(cred[i].net, debt[j].net).toFixed(2);
    out.push({ from: debt[j].member_id, to: cred[i].member_id, amount: amt });
    cred[i].net = +(cred[i].net - amt).toFixed(2);
    debt[j].net = +(debt[j].net - amt).toFixed(2);
    if (cred[i].net < 0.01) i++;
    if (debt[j].net < 0.01) j++;
  }
  return out;
}

/** Trigger a CSV download of the tracker's expenses + per-member breakdown. */
function exportTrackerCsv(tracker: TrackerDetail): void {
  const nameOf = (id: string) => tracker.members.find(m => m.id === id)?.display_name ?? "?";
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows: string[] = [];
  rows.push(["Date", "Description", "Amount", "Paid by", "Split between", "Note"].join(","));
  for (const e of tracker.expenses) {
    const paidBy = (e.payments?.length ? e.payments : [{ member_id: e.payer_id, amount: e.amount }])
      .map(p => `${nameOf(p.member_id)}:${Number(p.amount).toFixed(2)}`)
      .join(" + ");
    const splitBy = e.splits.map(s => `${nameOf(s.member_id)}:${Number(s.share).toFixed(2)}`).join(" + ");
    rows.push([e.expense_date, e.description, Number(e.amount).toFixed(2), paidBy, splitBy, e.note ?? ""].map(esc).join(","));
  }
  rows.push("");
  rows.push(["Member", "Paid", "Share", "Net"].join(","));
  for (const s of buildMemberStats(tracker)) {
    rows.push([s.display_name, s.paid.toFixed(2), s.share.toFixed(2), s.net.toFixed(2)].map(esc).join(","));
  }
  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${tracker.name.replace(/[^a-z0-9]+/gi, "_")}_expenses.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
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

function TabBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors inline-flex items-center gap-1.5",
        active
          ? "bg-zinc-800 text-zinc-100 shadow-sm shadow-black/20"
          : "text-zinc-400 hover:text-zinc-200",
      )}
    >{icon}{children}</button>
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
