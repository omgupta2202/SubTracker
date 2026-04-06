import type { Subscription, EMI, CreditCard, UpcomingObligation } from "@/types";
import { formatINR, nextDueDate, daysUntil } from "@/lib/utils";
import { CalendarClock } from "lucide-react";

interface HorizonItem {
  label: string;
  amount: number;
  daysLeft: number;
  type: "subscription" | "emi" | "card" | "rent";
}

interface Props {
  /** Ledger-derived upcoming dues from /api/dashboard/summary */
  upcomingDues?: UpcomingObligation[];
  /** Legacy fallback data (used when upcomingDues is not available) */
  subscriptions?: Subscription[];
  emis?: EMI[];
  cards?: CreditCard[];
}

const TYPE_COLOR: Record<HorizonItem["type"], string> = {
  subscription: "bg-violet-500/20 text-violet-300 border-violet-500/30",
  emi:          "bg-blue-500/20 text-blue-300 border-blue-500/30",
  card:         "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  rent:         "bg-amber-500/20 text-amber-300 border-amber-500/30",
};

const TYPE_LABEL: Record<HorizonItem["type"], string> = {
  subscription: "sub",
  emi:          "EMI",
  card:         "card",
  rent:         "rent",
};

export function SevenDayHorizonCard({ upcomingDues, subscriptions = [], emis = [], cards = [] }: Props) {
  let items: HorizonItem[] = [];

  if (upcomingDues && upcomingDues.length >= 0) {
    // Ledger-derived path: use obligation occurrences from backend
    items = upcomingDues.map(d => ({
      label:    d.name,
      amount:   d.amount_due,
      daysLeft: d.days_until_due ?? d.days_until ?? 0,
      type:     (d.type ?? d.obligation_type) === "rent" ? "rent" : ((d.type ?? d.obligation_type) as "subscription" | "emi"),
    }));
  } else {
    // Legacy fallback: compute from due_day fields
    subscriptions.forEach((s) => {
      const d = daysUntil(nextDueDate(s.due_day));
      if (d >= 0 && d <= 7)
        items.push({ label: s.name, amount: s.amount, daysLeft: d, type: "subscription" });
    });
    emis.forEach((e) => {
      const d = daysUntil(nextDueDate(e.due_day));
      if (d >= 0 && d <= 7)
        items.push({ label: `${e.name} EMI`, amount: e.amount, daysLeft: d, type: "emi" });
    });
    cards.forEach((c) => {
      const d = c.due_date_offset;
      if (d >= 0 && d <= 7)
        items.push({
          label: c.last4 ? `${c.name} ···· ${c.last4}` : c.name,
          amount: c.minimum_due, daysLeft: d, type: "card",
        });
    });
  }

  items.sort((a, b) => a.daysLeft - b.daysLeft);

  const totalDue = items.reduce((s, i) => s + i.amount, 0);

  return (
    <div className="relative overflow-hidden bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 p-6 flex flex-col gap-4 backdrop-blur-sm border border-zinc-700/60">
      <div className="absolute -bottom-16 -left-12 w-48 h-48 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-zinc-400 text-sm font-medium">
          <CalendarClock size={16} className="text-violet-400" />
          7-Day Horizon
        </div>
        {items.length > 0 && (
          <span className="font-mono text-sm font-semibold text-zinc-200">{formatINR(totalDue)}</span>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-zinc-500 text-sm py-4 text-center">Nothing due in the next 7 days</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item, i) => (
            <div key={i} className="relative">
              <div className="absolute left-2 top-0 bottom-0 w-px bg-zinc-700/60" />
              <div className={`ml-3 flex items-center justify-between rounded-xl px-4 py-3 border ${
                item.daysLeft === 0
                  ? "bg-red-500/10 border-red-500/20"
                  : item.daysLeft <= 3
                  ? "bg-amber-500/10 border-amber-500/20"
                  : "bg-zinc-800/50 border-zinc-700/50"
              }`}>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-zinc-200 font-medium">{item.label}</span>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full border ${TYPE_COLOR[item.type]}`}>
                      {TYPE_LABEL[item.type]}
                    </span>
                    <span className={`text-xs ${item.daysLeft === 0 ? "text-red-400 font-semibold" : item.daysLeft <= 3 ? "text-amber-400" : "text-zinc-500"}`}>
                      {item.daysLeft === 0 ? "Today" : `in ${item.daysLeft}d`}
                    </span>
                  </div>
                </div>
                <span className="font-mono text-zinc-100 font-semibold">
                  {formatINR(item.amount)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
