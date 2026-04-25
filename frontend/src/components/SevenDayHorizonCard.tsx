import type { Subscription, EMI, CreditCard, UpcomingObligation } from "@/types";
import { nextDueDate, daysUntil, cn } from "@/lib/utils";
import { CalendarClock } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Stat } from "@/components/ui/Stat";
import { inrCompact, relativeDay } from "@/lib/tokens";

interface HorizonItem {
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

export function SevenDayHorizonCard({ upcomingDues, subscriptions = [], emis = [], cards = [], onHide }: Props) {
  let items: HorizonItem[] = [];

  if (upcomingDues && upcomingDues.length >= 0) {
    items = upcomingDues.map(d => ({
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
          {items.map((it, i) => {
            const tone =
              it.daysLeft === 0   ? "text-red-400" :
              it.daysLeft <= 3    ? "text-amber-400" :
              "text-zinc-500";
            return (
              <div key={i} className="flex items-center gap-3 py-2">
                <span className={cn("h-2 w-2 rounded-full shrink-0", TYPE_DOT[it.type])} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-zinc-200 truncate">{it.label}</div>
                  <div className="text-[11px] text-zinc-600 flex items-center gap-2">
                    <span className="uppercase tracking-wider">{TYPE_LABEL[it.type]}</span>
                    <span className={cn("num", tone)}>{relativeDay(it.daysLeft)}</span>
                  </div>
                </div>
                <span className={cn("num text-sm shrink-0", tone === "text-zinc-500" ? "text-zinc-200" : tone)}>
                  {inrCompact(it.amount)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
