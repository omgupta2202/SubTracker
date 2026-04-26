import { useState } from "react";
import type { Subscription, EMI, CreditCard, UpcomingObligation } from "@/modules/subtracker/types";
import { nextDueDate, daysUntil, cn } from "@/lib/utils";
import { CalendarClock, Check, Loader2 } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Stat } from "@/components/ui/Stat";
import { inrCompact, relativeDay } from "@/lib/tokens";
import * as api from "@/modules/subtracker/services/api";

interface HorizonItem {
  /** Occurrence id (when row came from the unified obligations endpoint).
   *  Cards don't have one. */
  occurrenceId?: string;
  label: string;
  amount: number;
  daysLeft: number;
  type: "subscription" | "emi" | "card" | "rent";
}

interface Props {
  upcomingDues?: UpcomingObligation[];
  subscriptions?: Subscription[];
  emis?: EMI[];
  cards?: CreditCard[];
  onHide?: () => void;
  /** Called after a quick "mark paid" so the parent can refetch. */
  onPaid?: () => void;
}

const TYPE_DOT: Record<HorizonItem["type"], string> = {
  subscription: "bg-violet-400",
  emi:          "bg-sky-400",
  card:         "bg-emerald-400",
  rent:         "bg-amber-400",
};

const TYPE_LABEL: Record<HorizonItem["type"], string> = {
  subscription: "sub",
  emi:          "EMI",
  card:         "card",
  rent:         "rent",
};

export function SevenDayHorizonCard({ upcomingDues, subscriptions = [], emis = [], cards = [], onHide, onPaid }: Props) {
  let items: HorizonItem[] = [];

  if (upcomingDues && upcomingDues.length >= 0) {
    items = upcomingDues.map(d => ({
      // Occurrence id from the unified obligations endpoint — used to
      // POST /obligations/occurrences/<id>/pay. Cards don't have one
      // (they go through the billing-cycle pay flow instead) so it's
      // optional on the row level.
      occurrenceId: d.id,
      label:    d.name,
      amount:   d.amount_due,
      daysLeft: d.days_until_due ?? d.days_until ?? 0,
      type:     (d.type ?? d.obligation_type) === "rent"
        ? "rent"
        : ((d.type ?? d.obligation_type) as "subscription" | "emi"),
    }));
  } else {
    subscriptions.forEach(s => {
      const d = daysUntil(nextDueDate(s.due_day));
      if (d >= 0 && d <= 7) items.push({ label: s.name, amount: s.amount, daysLeft: d, type: "subscription" });
    });
    emis.forEach(e => {
      const d = daysUntil(nextDueDate(e.due_day));
      if (d >= 0 && d <= 7) items.push({ label: `${e.name} EMI`, amount: e.amount, daysLeft: d, type: "emi" });
    });
    cards.forEach(c => {
      const d = c.due_date_offset;
      if (d >= 0 && d <= 7) items.push({
        label: c.last4 ? `${c.name} ···· ${c.last4}` : c.name,
        amount: c.minimum_due, daysLeft: d, type: "card",
      });
    });
  }

  items.sort((a, b) => a.daysLeft - b.daysLeft);
  const totalDue = items.reduce((s, i) => s + i.amount, 0);

  return (
    <Card variant="hero" className="flex flex-col gap-3" onHide={onHide}>
      <CardHeader>
        <CardTitle icon={<CalendarClock size={14} />}>7-day horizon</CardTitle>
        {items.length > 0 && (
          <Stat value={totalDue} size="sm" align="right" tone="neutral" format="compact" />
        )}
      </CardHeader>

      {items.length === 0 ? (
        <p className="text-sm text-zinc-500 text-center py-6">Nothing due in the next 7 days.</p>
      ) : (
        <div className="flex flex-col">
          {items.map((it, i) => (
            <HorizonRow key={it.occurrenceId ?? i} item={it} onPaid={onPaid} />
          ))}
        </div>
      )}
    </Card>
  );
}

/** Single horizon row. Has its own state for the in-flight pay action so
 *  rows don't all spin together. */
function HorizonRow({ item, onPaid }: { item: HorizonItem; onPaid?: () => void }) {
  const [paying, setPaying] = useState(false);
  const tone =
    item.daysLeft === 0 ? "text-red-400" :
    item.daysLeft <= 3  ? "text-amber-400" :
                          "text-zinc-500";
  return (
    <div className="flex items-center gap-3 py-2 group">
      <span className={cn("h-2 w-2 rounded-full shrink-0", TYPE_DOT[item.type])} />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-zinc-200 truncate">{item.label}</div>
        <div className="text-[11px] text-zinc-600 flex items-center gap-2">
          <span className="uppercase tracking-wider">{TYPE_LABEL[item.type]}</span>
          <span className={cn("num", tone)}>{relativeDay(item.daysLeft)}</span>
        </div>
      </div>
      {item.occurrenceId && onPaid && (
        <button
          onClick={async () => {
            const partial = window.prompt(
              `Mark "${item.label}" as paid? Leave blank for the full amount, or type a partial amount:`,
              "",
            );
            if (partial == null) return;
            const amt = partial.trim() ? Number(partial) : undefined;
            if (amt !== undefined && (!Number.isFinite(amt) || amt < 0)) { alert("Bad amount"); return; }
            setPaying(true);
            try {
              await api.payObligationOccurrence(item.occurrenceId!, amt !== undefined ? { amount_paid: amt } : undefined);
              onPaid();
            } catch (err) { alert((err as Error).message); }
            finally { setPaying(false); }
          }}
          title="Mark this occurrence as paid (full or partial). Doesn't post to ledger — for that, use the Pay flow."
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity px-1.5 py-0.5 rounded text-[11px] text-emerald-300 hover:bg-emerald-500/15 inline-flex items-center gap-1"
        >
          {paying ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
          paid
        </button>
      )}
      <span className={cn("num text-sm shrink-0", tone === "text-zinc-500" ? "text-zinc-200" : tone)}>
        {inrCompact(item.amount)}
      </span>
    </div>
  );
}
