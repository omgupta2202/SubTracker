import {
  Wallet, TrendingDown, TrendingUp, CreditCard, CalendarClock, HandCoins,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { inrCompact } from "@/lib/tokens";
import type { DashboardSummary } from "@/modules/subtracker/types";

/**
 * Top-of-dashboard "today at a glance" strip.
 *
 * Six tightly packed KPI tiles surfacing the most-asked questions ("how
 * much liquid?", "what do I owe on cards?", "what's due this week?") so
 * the user gets value even with most cards collapsed or hidden. Pulls
 * straight off the existing /dashboard summary — no new endpoints.
 *
 * Tiles intentionally compact (one-line label, one-line big number) to
 * stay scannable on mobile.
 */
export function DashboardPulse({ summary, loading }: {
  summary: DashboardSummary | null;
  loading: boolean;
}) {
  // Derive "this week" snapshot from upcoming_dues_7d (already on summary).
  const weekDues = summary?.upcoming_dues_7d ?? [];
  const weekTotal = weekDues.reduce((s, d) => s + Number(d.balance_due ?? d.amount_due ?? 0), 0);
  const burnTrend = summary?.monthly_burn_trend_pct ?? null;
  const liquid    = summary?.total_liquid ?? 0;
  const ccOut     = summary?.total_cc_outstanding ?? 0;
  const ccMin     = summary?.total_cc_minimum_due ?? 0;
  const burn      = summary?.monthly_burn ?? 0;
  const recv      = summary?.total_receivables_30d ?? 0;
  const netAfter  = summary?.net_after_cc ?? 0;
  const utilPct   = summary?.credit_utilization_pct;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
      <Tile
        loading={loading}
        label="Liquid"
        hint="Total across your bank/wallet/cash accounts right now"
        icon={<Wallet size={13} className="text-emerald-300" />}
        value={inrCompact(liquid)}
        valueClassName="text-zinc-100"
        sub={netAfter !== liquid ? `${inrCompact(netAfter)} after CC` : "after CC: same"}
      />

      <Tile
        loading={loading}
        label="Owed on cards"
        hint="Sum of credit card outstanding balances"
        icon={<CreditCard size={13} className="text-rose-300" />}
        value={inrCompact(ccOut)}
        valueClassName={ccOut > 0 ? "text-rose-300" : "text-zinc-100"}
        sub={ccMin > 0 ? `min ${inrCompact(ccMin)}` : "no minimum due"}
      />

      <Tile
        loading={loading}
        label="Monthly burn"
        hint="Recurring spend (subs + EMIs + rent + projected card spend) for this month"
        icon={<TrendingDown size={13} className="text-violet-300" />}
        value={inrCompact(burn)}
        valueClassName="text-zinc-100"
        sub={burnTrend !== null
          ? <span className={cn("inline-flex items-center gap-0.5",
              burnTrend > 0 ? "text-amber-300" : burnTrend < 0 ? "text-emerald-300" : "text-zinc-500")}>
              {burnTrend > 0 ? <TrendingUp size={10} /> : burnTrend < 0 ? <TrendingDown size={10} /> : null}
              {burnTrend > 0 ? "+" : ""}{burnTrend.toFixed(1)}% vs avg
            </span>
          : "trend N/A"}
      />

      <Tile
        loading={loading}
        label="Due this week"
        hint="Subscriptions, EMIs, rent and card statements due in the next 7 days"
        icon={<CalendarClock size={13} className="text-amber-300" />}
        value={inrCompact(weekTotal)}
        valueClassName={weekDues.length > 0 ? "text-amber-300" : "text-zinc-100"}
        sub={`${weekDues.length} item${weekDues.length === 1 ? "" : "s"}`}
      />

      <Tile
        loading={loading}
        label="To collect"
        hint="Receivables you're expecting in the next 30 days"
        icon={<HandCoins size={13} className="text-emerald-300" />}
        value={inrCompact(recv)}
        valueClassName={recv > 0 ? "text-emerald-300" : "text-zinc-100"}
        sub={recv > 0 ? "in next 30d" : "nothing pending"}
      />

      <Tile
        loading={loading}
        label="Card utilisation"
        hint="Outstanding ÷ total credit limit. Below 30% is healthy."
        icon={<CreditCard size={13} className="text-fuchsia-300" />}
        value={utilPct == null ? "—" : `${utilPct.toFixed(0)}%`}
        valueClassName={
          utilPct == null            ? "text-zinc-100" :
          utilPct >= 70              ? "text-rose-300" :
          utilPct >= 30              ? "text-amber-300":
                                       "text-emerald-300"
        }
        sub={utilPct == null ? "no limits set" :
             utilPct >= 70 ? "high — pay down" :
             utilPct >= 30 ? "moderate" :
                             "healthy"}
      />
    </div>
  );
}

function Tile({
  loading, label, hint, icon, value, valueClassName, sub,
}: {
  loading: boolean;
  label: string;
  hint: string;
  icon: React.ReactNode;
  value: string;
  valueClassName?: string;
  sub: React.ReactNode;
}) {
  return (
    <div
      title={hint}
      className="rounded-2xl border border-zinc-800/70 bg-zinc-900/60 backdrop-blur-sm px-3.5 py-3 flex flex-col gap-1.5 hover:border-violet-500/30 hover:bg-zinc-900/80 transition-colors"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500">{label}</span>
        {icon}
      </div>
      <div className={cn("num text-lg sm:text-xl font-semibold tracking-tight", valueClassName)}>
        {loading ? <span className="inline-block w-14 h-5 rounded bg-zinc-800/80 animate-pulse" /> : value}
      </div>
      <div className="text-[10.5px] text-zinc-500 truncate">
        {loading ? <span className="inline-block w-20 h-3 rounded bg-zinc-800/60 animate-pulse" /> : sub}
      </div>
    </div>
  );
}
