import { useState, useMemo } from "react";
import { Wallet, ChevronDown, ChevronUp, CreditCard as CardIcon, Pencil } from "lucide-react";
import { Card, CardHeader, CardTitle, CardAction, CardDivider } from "@/components/ui/Card";
import { Stat, Row } from "@/components/ui/Stat";
import { Sparkline } from "@/components/ui/Sparkline";
import { EditList, Field, FieldGrid, inputCls } from "@/components/ui/EditList";
import { inrCompact } from "@/lib/tokens";
import { cn } from "@/lib/utils";
import { useDailyLogs } from "@/modules/subtracker/hooks/useDailyLogs";
import * as api from "@/modules/subtracker/services/api";

interface LiquidAccount {
  id: string;
  name: string;
  balance: number;
  bank?: string;
}

interface CreditCardSnapshot {
  id: string;
  name: string;
  bank?: string;
  last4?: string | null;
  outstanding: number;
  minimum_due: number;
  due_date_offset?: number;
  due_day?: number | null;
}

interface Props {
  accounts: LiquidAccount[];
  cards: CreditCardSnapshot[];
  rent?: number;
  rentDueDay?: number;
  onRefetch: () => void;
  onHide?: () => void;
  /** Tap a CC row to open the per-card detail drawer (statements + pay flow). */
  onOpenCard?: (card: CreditCardSnapshot) => void;
}

const BANK_DOT: Record<string, string> = {
  HDFC: "bg-sky-400",
  Axis: "bg-violet-400",
  SBI:  "bg-amber-400",
  Cash: "bg-emerald-400",
  Slice:"bg-rose-400",
};
const dot = (b?: string) => BANK_DOT[b ?? ""] ?? "bg-zinc-500";

export function NetWorthCard({ accounts, cards, rent = 0, rentDueDay, onRefetch, onHide, onOpenCard }: Props) {
  const [editing, setEditing] = useState(false);
  const [showCards, setShowCards] = useState(false);
  const [rentEditing, setRentEditing] = useState(false);
  const [rentDraft, setRentDraft] = useState({ amount: rent, due_day: rentDueDay ?? 1 });
  const [rentSaving, setRentSaving] = useState(false);

  // Keep draft in sync when external rent changes (after save / refetch).
  // Only resync when not actively editing to avoid clobbering user input.
  if (!rentEditing && (rentDraft.amount !== rent || rentDraft.due_day !== (rentDueDay ?? 1))) {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    setRentDraft({ amount: rent, due_day: rentDueDay ?? 1 });
  }

  async function saveRent() {
    setRentSaving(true);
    try {
      await api.updateRent({ amount: Number(rentDraft.amount || 0), due_day: Number(rentDraft.due_day || 1) });
      setRentEditing(false);
      onRefetch();
    } finally {
      setRentSaving(false);
    }
  }

  const totalLiquid = accounts.reduce((s, a) => s + a.balance, 0);
  const totalCC     = cards.reduce((s, c) => s + c.outstanding, 0);
  const netAfterCC  = totalLiquid - totalCC - rent;

  const { logs } = useDailyLogs(30);
  const sparkData = useMemo(
    () => logs
      .map(l => ({ x: l.log_date, y: (l.summary?.total_liquid ?? 0) - (l.summary?.total_cc_outstanding ?? 0) }))
      .filter(p => Number.isFinite(p.y)),
    [logs],
  );

  const monthDelta = useMemo(() => {
    if (sparkData.length < 2) return null;
    const first = sparkData[0].y;
    const last  = sparkData[sparkData.length - 1].y;
    if (!first) return null;
    return ((last - first) / Math.abs(first)) * 100;
  }, [sparkData]);

  const trendColor = (monthDelta ?? 0) >= 0 ? "rgb(52 211 153)" : "rgb(248 113 113)";

  return (
    <Card variant="hero" className="flex flex-col gap-4" onHide={onHide}>
      <CardHeader>
        <CardTitle icon={<Wallet size={14} />}>Net Worth</CardTitle>
        <CardAction
          onClick={() => { setEditing(v => !v); setShowCards(true); }}
          className="inline-flex items-center gap-1"
        >
          <Pencil size={11} /> {editing ? "Done" : "Edit"}
        </CardAction>
      </CardHeader>

      <div className="flex items-end justify-between gap-4">
        <Stat
          value={netAfterCC}
          size="hero"
          tone={netAfterCC >= 0 ? "good" : "bad"}
          delta={monthDelta}
          helper="net after CC + rent"
        />
        <div className="flex-1 max-w-[180px] -mb-2">
          <Sparkline data={sparkData} stroke={trendColor} height={56} filled />
        </div>
      </div>

      <CardDivider />

      <div className="flex flex-col">
        <Row label="Liquid"       value={inrCompact(totalLiquid)} dot="bg-emerald-400"
             helper={`${accounts.length} acct${accounts.length === 1 ? "" : "s"}`} />
        <Row label="Credit cards" value={`− ${inrCompact(totalCC)}`} valueClassName="text-red-400"
             dot="bg-red-500" helper={`${cards.length} card${cards.length === 1 ? "" : "s"}`} />
        {/* Rent row — inline editable when global edit mode is on, or via row-level edit */}
        {editing ? (
          rentEditing ? (
            <div className="my-1 -mx-2 px-3 py-2.5 rounded-lg bg-zinc-800/40 border border-zinc-700/60 flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium shrink-0">Rent</span>
              <input
                className={cn(inputCls, "max-w-[120px]")} type="number"
                value={String(rentDraft.amount)}
                onChange={e => setRentDraft({ ...rentDraft, amount: Number(e.target.value) })}
                placeholder="amount"
              />
              <input
                className={cn(inputCls, "max-w-[70px]")} type="number" min={1} max={31}
                value={String(rentDraft.due_day)}
                onChange={e => setRentDraft({ ...rentDraft, due_day: Number(e.target.value) })}
                placeholder="day"
              />
              <button onClick={saveRent} disabled={rentSaving}
                      className="px-2 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-medium disabled:opacity-50">
                {rentSaving ? "…" : "Save"}
              </button>
              <button onClick={() => { setRentEditing(false); setRentDraft({ amount: rent, due_day: rentDueDay ?? 1 }); }}
                      className="px-1.5 py-1 text-[11px] text-zinc-500 hover:text-zinc-300">×</button>
            </div>
          ) : (
            <button onClick={() => setRentEditing(true)} className="w-full text-left -mx-2 px-2 py-0.5 rounded-md hover:bg-zinc-800/30 transition-colors">
              <Row label="Rent" value={rent > 0 ? `− ${inrCompact(rent)}` : "set rent"}
                   valueClassName={rent > 0 ? "text-red-400/80" : "text-violet-400"}
                   dot="bg-red-400/60"
                   helper={rent > 0 ? `day ${rentDueDay ?? 1}` : "tap to set"} />
            </button>
          )
        ) : rent > 0 && (
          <Row label="Rent" value={`− ${inrCompact(rent)}`}
               valueClassName="text-red-400/80" dot="bg-red-400/60"
               helper={rentDueDay ? `day ${rentDueDay}` : "monthly"} />
        )}
      </div>

      <button
        onClick={() => setShowCards(v => !v)}
        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors mt-1"
      >
        <CardIcon size={12} />
        {showCards ? "Hide" : "Show"} {accounts.length + cards.length} accounts
        {showCards ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {showCards && (
        <div className="flex flex-col gap-3 pt-1">
          {/* Bank / wallet / cash */}
          <div>
            <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 mb-1">Accounts</div>
            {editing ? (
              <EditList<LiquidAccount>
                items={accounts}
                getKey={a => a.id}
                addLabel="Add account"
                emptyDraft={() => ({ name: "", bank: "", balance: 0 })}
                onSave={async (draft, original) => {
                  if (original) await api.updateAccount(original.id, draft as any);
                  else          await api.createAccount(draft as any);
                  onRefetch();
                }}
                onDelete={async (a) => { await api.deleteAccount(a.id); onRefetch(); }}
                renderView={a => (
                  <Row
                    label={a.name}
                    dot={dot(a.bank)}
                    value={inrCompact(a.balance)}
                    helper={a.bank}
                  />
                )}
                renderEditForm={(d, set) => (
                  <>
                    <FieldGrid>
                      <Field label="Name">
                        <input className={inputCls} value={d.name ?? ""} onChange={e => set({ ...d, name: e.target.value })} />
                      </Field>
                      <Field label="Bank">
                        <input className={inputCls} value={d.bank ?? ""} onChange={e => set({ ...d, bank: e.target.value })} />
                      </Field>
                    </FieldGrid>
                    <Field label="Balance (₹)">
                      <input className={inputCls} type="number" value={String(d.balance ?? 0)}
                             onChange={e => set({ ...d, balance: Number(e.target.value) })} />
                    </Field>
                  </>
                )}
              />
            ) : (
              accounts.map(a => (
                <Row key={a.id} label={a.name} dot={dot(a.bank)} value={inrCompact(a.balance)} helper={a.bank} />
              ))
            )}
          </div>

          {/* Credit cards */}
          <div>
            <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 mb-1">Credit cards</div>
            {editing ? (
              <EditList<CreditCardSnapshot>
                items={cards}
                getKey={c => c.id}
                addLabel="Add card"
                emptyDraft={() => ({ name: "", bank: "", last4: "", outstanding: 0, minimum_due: 0, due_day: 1 })}
                onSave={async (draft, original) => {
                  if (original) {
                    await api.updateCard(original.id, draft as any);
                    // sync current open billing cycle
                    try {
                      const overview = await api.getBillingCycleOverview(original.id);
                      const o = Number((draft as any).outstanding ?? 0);
                      const m = Number((draft as any).minimum_due ?? 0);
                      if (overview.current_cycle) {
                        await api.updateBillingCycle(overview.current_cycle.id, {
                          total_billed: o, minimum_due: m,
                        });
                      } else if (o !== 0 || m !== 0) {
                        await api.createBillingCycleForCard(original.id, {
                          statement_period: "current",
                          total_billed: o, minimum_due: m,
                        });
                      }
                    } catch { /* non-fatal */ }
                  } else {
                    await api.createCard(draft as any);
                  }
                  onRefetch();
                }}
                onDelete={async (c) => { await api.deleteCard(c.id); onRefetch(); }}
                renderView={c => {
                  const due = c.due_date_offset ?? 999;
                  const urgent = due <= 3;
                  return (
                    <Row
                      dot="bg-red-500/60"
                      label={
                        <span className="flex items-center gap-1.5">
                          <span>{c.name}</span>
                          {c.last4 && <span className="text-[10px] text-zinc-500 num">···· {c.last4}</span>}
                        </span>
                      }
                      value={`− ${inrCompact(c.outstanding)}`}
                      valueClassName="text-red-400"
                      helper={due <= 30 ? (
                        <span className={cn(urgent && "text-amber-400 font-medium")}>
                          {due === 0 ? "due today" : `${due}d`}
                        </span>
                      ) : null}
                    />
                  );
                }}
                renderEditForm={(d, set) => (
                  <>
                    <FieldGrid>
                      <Field label="Name">
                        <input className={inputCls} value={d.name ?? ""} onChange={e => set({ ...d, name: e.target.value })} />
                      </Field>
                      <Field label="Bank">
                        <input className={inputCls} value={d.bank ?? ""} onChange={e => set({ ...d, bank: e.target.value })} />
                      </Field>
                      <Field label="Last 4">
                        <input className={inputCls} maxLength={4} inputMode="numeric" value={d.last4 ?? ""}
                               onChange={e => set({ ...d, last4: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
                      </Field>
                      <Field label="Statement day">
                        <input className={inputCls} type="number" min={1} max={31}
                               value={String(d.due_day ?? 1)} onChange={e => set({ ...d, due_day: Number(e.target.value) })} />
                      </Field>
                      <Field label="Outstanding (₹)">
                        <input className={inputCls} type="number" value={String(d.outstanding ?? 0)}
                               onChange={e => set({ ...d, outstanding: Number(e.target.value) })} />
                      </Field>
                      <Field label="Min due (₹)">
                        <input className={inputCls} type="number" value={String(d.minimum_due ?? 0)}
                               onChange={e => set({ ...d, minimum_due: Number(e.target.value) })} />
                      </Field>
                    </FieldGrid>
                  </>
                )}
              />
            ) : (
              cards.map(c => {
                const due = c.due_date_offset ?? 999;
                const urgent = due <= 3;
                return (
                  <Row
                    key={c.id}
                    onClick={onOpenCard ? () => onOpenCard(c) : undefined}
                    dot="bg-red-500/60"
                    label={
                      <span className="flex items-center gap-1.5">
                        <span>{c.name}</span>
                        {c.last4 && <span className="text-[10px] text-zinc-500 num">···· {c.last4}</span>}
                      </span>
                    }
                    value={`− ${inrCompact(c.outstanding)}`}
                    valueClassName="text-red-400"
                    helper={due <= 30 ? (
                      <span className={cn(urgent && "text-amber-400 font-medium")}>
                        {due === 0 ? "due today" : `${due}d`}
                      </span>
                    ) : null}
                  />
                );
              })
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
