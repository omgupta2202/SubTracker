import { useEffect, useState } from "react";
import {
  Users, Receipt, Sparkles, Loader2, ExternalLink, Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { inrCompact, inr, relativeTime, fullTimestamp } from "@/lib/tokens";
import * as api from "@/services/api";
import type { TripDetail, TripMember, TripExpenseSplit } from "@/services/api";

/**
 * Guest entry point — opened by anyone holding the magic-link from an
 * invite email at `/trips/guest/<token>`. No SubTracker account needed.
 *
 * Behaviour:
 *   - GET /api/trips/guest/<token>   → returns trip + this guest's row.
 *     Backend auto-promotes invite_status from 'pending' → 'joined'.
 *   - Guest can add expenses, set their UPI VPA, see balances + settlement.
 *   - The token is cached in localStorage so they can revisit by typing
 *     just /trips and we'll route back to the active trip.
 */

const STORAGE_KEY = "subtracker:guest-trip-token";

export function TripGuestRoute({ token }: { token: string }) {
  const [trip, setTrip]     = useState<(TripDetail & { me: TripMember }) | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingMe, setEditingMe] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const t = await api.guestGetTrip(token);
      setTrip(t);
      localStorage.setItem(STORAGE_KEY, token);
    } catch (e) {
      setError((e as Error).message || "Could not load trip");
    } finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); /* eslint-disable-next-line */ }, [token]);

  if (loading && !trip) {
    return <Center><Loader2 size={20} className="text-violet-400 animate-spin" /></Center>;
  }
  if (error) {
    return (
      <Center>
        <div className="text-center max-w-sm">
          <h1 className="text-lg font-semibold text-zinc-100">Couldn't open this trip</h1>
          <p className="text-sm text-zinc-500 mt-2">{error}</p>
        </div>
      </Center>
    );
  }
  if (!trip) return null;

  const myBal = trip.balances.find(b => b.member_id === trip.me.id);

  return (
    <div className="min-h-screen bg-zinc-950">
      <header className="sticky top-0 z-10 backdrop-blur-md bg-zinc-950/85 border-b border-zinc-800/60">
        <div className="max-w-[760px] mx-auto px-5 py-3 flex items-center gap-3">
          <Users size={16} className="text-violet-400" />
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold text-zinc-100 truncate">{trip.name}</h1>
            <p className="text-[11px] text-zinc-500 truncate">
              You're <strong className="text-zinc-300">{trip.me.display_name}</strong>
              {trip.me.upi_id && <span> · UPI <span className="num">{trip.me.upi_id}</span></span>}
              <button onClick={() => setEditingMe(true)}
                      title="Update your display name or UPI ID (so others can pay you with one tap)"
                      className="ml-2 inline-flex items-center gap-1 text-violet-300 hover:text-violet-200">
                <Pencil size={10} /> edit
              </button>
            </p>
          </div>
        </div>
      </header>

      <div className="max-w-[760px] mx-auto px-5 py-6 flex flex-col gap-5">
        {/* My balance */}
        <div className="rounded-2xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-950 p-5"
             title="Net amount across the whole trip: positive means people owe you; negative means you owe.">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-1">Your balance</div>
          {myBal ? (
            <div className={cn(
              "num text-3xl font-semibold",
              myBal.net > 0.01 ? "text-emerald-400" :
              myBal.net < -0.01 ? "text-red-400" :
                                  "text-zinc-100",
            )}>
              {myBal.net > 0.01  ? `+${inr(myBal.net)} you'll receive`  :
               myBal.net < -0.01 ? `${inr(myBal.net)} you owe` :
                                   "settled · ₹0"}
            </div>
          ) : (
            <div className="text-sm text-zinc-500">No expenses involving you yet.</div>
          )}
          <div className="mt-3 text-[11px] text-zinc-500">
            paid <span className="num text-zinc-300">{inrCompact(myBal?.paid ?? 0)}</span>{" · "}
            owe <span className="num text-zinc-300">{inrCompact(myBal?.owed ?? 0)}</span>
          </div>
        </div>

        <button
          onClick={() => setShowAdd(true)}
          title="Record a shared expense — pick who paid and who should split it"
          className="self-start inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium"
        >
          <Sparkles size={14} /> Add expense
        </button>

        {/* Members balances */}
        <section>
          <SectionTitle>Who owes whom</SectionTitle>
          <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900 mt-2">
            {trip.balances.map(b => (
              <div key={b.member_id} className="flex items-center px-4 py-2.5 border-b border-zinc-800/60 last:border-0">
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

        {/* Expenses */}
        <section>
          <SectionTitle>Expenses · {trip.expenses.length}</SectionTitle>
          <div className="mt-2 flex flex-col">
            {trip.expenses.length === 0 ? (
              <p className="text-sm text-zinc-500 text-center py-8 rounded-xl border border-dashed border-zinc-800">
                No expenses yet. Tap "Add expense" to start.
              </p>
            ) : (
              trip.expenses.map(e => {
                const payer = trip.members.find(m => m.id === e.payer_id);
                const multi = (e.payments?.length ?? 0) > 1;
                const payerLabel = multi
                  ? `${e.payments.length} paid`
                  : `${payer?.display_name ?? "?"} paid`;
                return (
                  <div key={e.id} className="flex items-center gap-3 px-2 py-2.5 border-b border-zinc-800/60">
                    <Receipt size={14} className="text-zinc-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-zinc-100 truncate">{e.description}</div>
                      <div className="text-[11px] text-zinc-500 num truncate">
                        {payerLabel} · {e.expense_date}
                        {multi && (
                          <span className="ml-1 text-zinc-600">
                            (
                            {e.payments.map((p, i) => {
                              const m = trip.members.find(mm => mm.id === p.member_id);
                              return (
                                <span key={p.member_id}>
                                  {i > 0 && ", "}
                                  {m?.display_name ?? "?"} {inrCompact(p.amount)}
                                </span>
                              );
                            })}
                            )
                          </span>
                        )}
                        <span className="ml-1 text-zinc-600" title={`Added ${fullTimestamp(e.created_at)}`}>
                          · added {relativeTime(e.created_at)}
                        </span>
                      </div>
                    </div>
                    <span className="num text-sm text-zinc-100 shrink-0">{inrCompact(e.amount)}</span>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Settlement */}
        <SettleStrip trip={trip} />
      </div>

      {showAdd && (
        <AddExpenseSheetGuest
          trip={trip}
          token={token}
          onClose={() => setShowAdd(false)}
          onSaved={async () => { setShowAdd(false); await refresh(); }}
        />
      )}
      {editingMe && (
        <EditMeSheet
          token={token}
          me={trip.me}
          onClose={() => setEditingMe(false)}
          onSaved={async () => { setEditingMe(false); await refresh(); }}
        />
      )}
    </div>
  );
}

/* ── Settle strip — guest sees only transfers involving them, with a UPI button to send. ── */

function SettleStrip({ trip }: { trip: TripDetail & { me: TripMember } }) {
  const [data, setData] = useState<{ transfers: { from_member_id: string; to_member_id: string; amount: number; from_display_name: string; to_display_name: string; to_upi_id: string | null }[] } | null>(null);

  // Recompute whenever trip changes — guest doesn't have access to /settlement
  // (that's owner-side), so we compute locally from the balances.
  useEffect(() => {
    const t = greedy(trip.balances.map(b => ({ id: b.member_id, name: b.display_name, net: b.net })));
    const upi = new Map(trip.members.map(m => [m.id, m.upi_id]));
    setData({
      transfers: t.map(x => ({
        ...x,
        from_display_name: trip.balances.find(b => b.member_id === x.from_member_id)?.display_name ?? "?",
        to_display_name:   trip.balances.find(b => b.member_id === x.to_member_id)?.display_name ?? "?",
        to_upi_id:         upi.get(x.to_member_id) ?? null,
      })),
    });
  }, [trip]);

  if (!data || data.transfers.length === 0) return null;
  const involvingMe = data.transfers.filter(t => t.from_member_id === trip.me.id || t.to_member_id === trip.me.id);
  if (involvingMe.length === 0) return null;

  return (
    <section>
      <SectionTitle>Settle up</SectionTitle>
      <div className="rounded-2xl border border-violet-500/25 bg-violet-500/5 mt-2 p-3 flex flex-col gap-2">
        {involvingMe.map((t, i) => {
          const youOwe = t.from_member_id === trip.me.id;
          const upi = youOwe && t.to_upi_id
            ? `upi://pay?pa=${encodeURIComponent(t.to_upi_id)}&pn=${encodeURIComponent(t.to_display_name)}&am=${t.amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent("Trip settlement")}`
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

/* ── Guest add-expense sheet (subset of the owner one) ── */

function AddExpenseSheetGuest({
  trip, token, onClose, onSaved,
}: {
  trip: TripDetail & { me: TripMember };
  token: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [description, setDescription] = useState("");
  const [amount, setAmount]           = useState("");
  const [included, setIncluded]       = useState<Set<string>>(new Set(trip.members.map(m => m.id)));
  // Mirror of owner-side AddExpenseSheet: single payer or partial (multi-payer).
  const [paymentKind, setPaymentKind] = useState<"single" | "partial">("single");
  const [singlePayer, setSinglePayer] = useState<string>(trip.me.id);
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
      let splits: TripExpenseSplit[] | undefined;
      let kind: "equal" | "custom" = "equal";
      if (included.size !== trip.members.length) {
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
      }

      await api.guestAddTripExpense(token, {
        payer_id: primaryPayerId,
        description: description.trim(),
        amount: amt,
        split_kind: kind,
        splits,
        payments,
      });
      await onSaved();
    } catch (e) { alert((e as Error).message); }
    finally { setSaving(false); }
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

        <Field label="Paid by" hint="Who actually paid the bill. Use Partial when more than one person chipped in.">
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

        <Field label="Split equally between" hint="Uncheck anyone who shouldn't share this expense — the cost is divided equally between everyone left checked.">
          <div className="flex flex-col gap-1">
            {trip.members.map(m => (
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
            {saving ? "Saving…" : "Save expense"}
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
  me: TripMember;
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
