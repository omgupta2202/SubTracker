import type { Subscription, EMI, CreditCard } from "@/types";
import { formatINR, nextDueDate, daysUntil } from "@/lib/utils";
import { CalendarClock } from "lucide-react";

interface HorizonItem {
  label: string;
  amount: number;
  daysLeft: number;
  type: "subscription" | "emi" | "card";
}

interface Props {
  subscriptions: Subscription[];
  emis: EMI[];
  cards: CreditCard[];
}

const TYPE_COLOR: Record<HorizonItem["type"], string> = {
  subscription: "bg-violet-500/20 text-violet-300 border-violet-500/30",
  emi:          "bg-blue-500/20 text-blue-300 border-blue-500/30",
  card:         "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
};

export function SevenDayHorizonCard({ subscriptions, emis, cards }: Props) {
  const items: HorizonItem[] = [];

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

  items.sort((a, b) => a.daysLeft - b.daysLeft);

  return (
    <div className="bg-zinc-900 p-6 flex flex-col gap-4 backdrop-blur-sm">
      <div className="flex items-center gap-2 text-zinc-400 text-sm font-medium">
        <CalendarClock size={16} className="text-violet-400" />
        7-Day Horizon
      </div>

      {items.length === 0 ? (
        <p className="text-zinc-500 text-sm py-4 text-center">Nothing due in the next 7 days</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-xl bg-zinc-800/50 px-4 py-3 border border-zinc-700/50"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-zinc-200 font-medium">{item.label}</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full border w-fit ${TYPE_COLOR[item.type]}`}
                >
                  {item.daysLeft === 0 ? "Today" : `in ${item.daysLeft}d`}
                </span>
              </div>
              <span className="font-mono text-zinc-100 font-semibold">
                {formatINR(item.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
