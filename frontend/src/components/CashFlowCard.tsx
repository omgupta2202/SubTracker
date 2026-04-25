import { useState } from "react";
import type { DashboardSummary, SmartAllocationResponse } from "@/types";
import type { PeriodSummary } from "@/services/api";
import {
  ArrowRight, AlertTriangle, CheckCircle2, Banknote, EyeOff,
  Calendar, Loader2, Info,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDivider } from "@/components/ui/Card";
import { inrCompact, inr } from "@/lib/tokens";
import { cn } from "@/lib/utils";

interface Props {
  dashboardSummary: DashboardSummary | null;
  dashboardLoading: boolean;
  allocation?: SmartAllocationResponse | null;
  periodSummary?: PeriodSummary | null;
  periodLoading?: boolean;
  onHide?: () => void;
}

const STORAGE_KEY = "cashflow-disabled";

function loadDisabled(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")); }
  catch { return new Set(); }
}

type Row = {
  key: string | null;
  label: string;
  value: number;
  sign: "+" | "−" | "=";
  tone: "neutral" | "good" | "bad" | "warn" | "muted";
  bold?: boolean;
  tag?: string;
  info?: string;
};

const TONE_CLASS: Record<Row["tone"], string> = {
  neutral: "text-zinc-200",
  good:    "text-emerald-400",
  bad:     "text-red-400",
  warn:    "text-amber-400",
  muted:   "text-zinc-400",
};

const SIGN_CLASS: Record<Row["sign"], string> = {
  "+": "text-emerald-500",
  "−": "text-red-500",
  "=": "text-zinc-500",
};

function CashFlowRow({ row, isOff, toggle }: { row: Row; isOff: boolean; toggle: (k: string) => void }) {
  return (
    <div className={cn(
      "group flex items-center gap-2 py-1.5",
      row.bold && "border-t border-zinc-800 mt-1 pt-2",
      isOff && "opacity-40",
    )}>
      <span className={cn("num text-sm w-3 text-center shrink-0", SIGN_CLASS[row.sign])}>
        {row.sign}
      </span>
      <span className={cn("text-sm flex-1 min-w-0 truncate", row.bold ? "text-zinc-100 font-semibold" : "text-zinc-400")}>
        {row.label}
      </span>
      {row.info && (
        <span title={row.info} className="text-zinc-600 hover:text-zinc-300 cursor-help" aria-label={`${row.label} info`}>
          <Info size={11} />
        </span>
      )}
      {row.tag && (
        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
          {row.tag}
        </span>
      )}
      <span className={cn("num text-sm shrink-0 w-24 text-right", row.bold && "font-semibold", TONE_CLASS[row.tone])}>
        {inrCompact(row.value)}
      </span>
      {row.key ? (
        <button
          onClick={() => toggle(row.key!)}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 -mr-1 rounded text-zinc-600 hover:text-zinc-300"
          title={isOff ? "Include" : "Exclude"}
        >
          <EyeOff size={11} />
        </button>
      ) : (
        <span className="w-5 shrink-0" />
      )}
    </div>
  );
}

function SpinnerBlock() {
  return (
    <Card className="h-64 flex items-center justify-center">
      <Loader2 size={20} className="text-violet-400 animate-spin" />
    </Card>
  );
}

export function CashFlowCard({
  dashboardSummary, dashboardLoading, allocation,
  periodSummary, periodLoading = false, onHide,
}: Props) {
  const [disabled, setDisabled] = useState<Set<string>>(loadDisabled);
  function toggle(key: string) {
    setDisabled(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  }
  const off = (k: string) => disabled.has(k);

  if (dashboardLoading && !dashboardSummary) return <SpinnerBlock />;
  if (periodLoading   && !periodSummary)     return <SpinnerBlock />;

  // ── Period view ───────────────────────────────────────────────────────
  if (periodSummary) {
    const p = periodSummary;
    const cc      = off("cc")      ? 0 : p.cc_total;
    const subs    = off("subs")    ? 0 : p.subs_total;
    const emis    = off("emis")    ? 0 : p.emis_total;
    const rent    = off("rent")    ? 0 : p.rent_total;
    const inflows = off("inflows") ? 0 : p.receivables_total;
    const capex   = off("capex")   ? 0 : p.capex_total;
    const netAfterCC = p.total_liquid - cc - rent;
    const gap = netAfterCC + inflows - capex - subs - emis;
    const isDeficit = gap < 0;

    const rows: Row[] = [
      { key: null,       label: "Liquid",          value: p.total_liquid,      sign: "+", tone: "neutral", info: "Bank, wallet, cash." },
      { key: "cc",       label: "CC outstanding",  value: p.cc_total,          sign: "−", tone: "bad", tag: p.cc_source === "transactions" ? "txns" : "bal" },
      { key: "subs",     label: "Subscriptions",   value: p.subs_total,        sign: "−", tone: "muted" },
      { key: "emis",     label: "EMIs",            value: p.emis_total,        sign: "−", tone: "muted" },
      { key: "rent",     label: "Rent",            value: p.rent_total,        sign: "−", tone: "muted" },
      { key: null,       label: "Net after CC",    value: netAfterCC,          sign: "=", tone: netAfterCC >= 0 ? "good" : "bad", bold: true },
      { key: "inflows",  label: "Expected inflows",value: p.receivables_total, sign: "+", tone: "good" },
      { key: "capex",    label: "Planned CapEx",   value: p.capex_total,       sign: "−", tone: "warn" },
    ];

    return (
      <Card className="flex flex-col gap-3" onHide={onHide}>
        <CardHeader>
          <CardTitle icon={<Banknote size={14} />}>
            Cash flow
            <span className="ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-500/25">
              <Calendar size={10} /> period
            </span>
          </CardTitle>
          <GapBadge gap={gap} deficit={isDeficit} />
        </CardHeader>
        <div className="flex flex-col">
          {rows.map(r => <CashFlowRow key={r.label} row={r} isOff={r.key ? off(r.key) : false} toggle={toggle} />)}
        </div>
      </Card>
    );
  }

  // ── Default ledger view ───────────────────────────────────────────────
  const s = dashboardSummary;
  if (!s) return <SpinnerBlock />;

  const cc          = off("cc")      ? 0 : s.total_cc_outstanding;
  const inflows     = off("inflows") ? 0 : s.total_receivables_30d;
  const obligations = off("oblig")   ? 0 : s.upcoming_obligations_30d;
  const capex30     = off("capex")   ? 0 : (s.total_capex_due_30d ?? 0);
  const netAfterCC  = s.total_liquid - cc;
  const gap = s.total_liquid + inflows - cc - obligations - capex30;
  const isDeficit = gap < 0;

  const rows: Row[] = [
    { key: null,      label: "Liquid",            value: s.total_liquid,             sign: "+", tone: "neutral", info: "Bank, wallet, cash." },
    { key: "cc",      label: "CC outstanding",    value: s.total_cc_outstanding,     sign: "−", tone: "bad", tag: "ledger" },
    { key: null,      label: "Net after CC",      value: netAfterCC,                 sign: "=", tone: netAfterCC >= 0 ? "good" : "bad", bold: true },
    { key: "inflows", label: "Expected inflows",  value: s.total_receivables_30d,    sign: "+", tone: "good", tag: "30d" },
    { key: "oblig",   label: "Obligations",       value: s.upcoming_obligations_30d, sign: "−", tone: "muted", tag: "30d" },
    { key: "capex",   label: "CapEx (30d)",       value: capex30,                    sign: "−", tone: "warn", info: "Capex with target_date in next 30 days." },
  ];

  const allocations = allocation?.allocations ?? [];
  const totalSavedMonthly = allocations.reduce((s, a) => s + (a.interest_saved_monthly ?? 0), 0);
  const urgent = allocations.filter(a =>
    typeof a.days_left === "number"
      ? a.days_left <= 7
      : Math.ceil((new Date(a.due_date).getTime() - Date.now()) / 86_400_000) <= 7,
  );

  return (
    <Card className="flex flex-col gap-3" onHide={onHide}>
      <CardHeader>
        <CardTitle icon={<Banknote size={14} />}>Cash flow</CardTitle>
        <GapBadge gap={gap} deficit={isDeficit} />
      </CardHeader>

      <div className="flex flex-col">
        {rows.map(r => <CashFlowRow key={r.label} row={r} isOff={r.key ? off(r.key) : false} toggle={toggle} />)}
      </div>

      {s.credit_utilization_pct !== null && (
        <>
          <CardDivider />
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500 shrink-0 w-28">CC utilization</span>
            <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-[width]",
                  s.credit_utilization_pct > 80 ? "bg-red-500"
                  : s.credit_utilization_pct > 50 ? "bg-amber-500"
                  : "bg-emerald-500",
                )}
                style={{ width: `${Math.min(s.credit_utilization_pct, 100)}%` }}
              />
            </div>
            <span className={cn(
              "num text-xs shrink-0",
              s.credit_utilization_pct > 80 ? "text-red-400"
              : s.credit_utilization_pct > 50 ? "text-amber-400"
              : "text-emerald-400",
            )}>
              {s.credit_utilization_pct}%
            </span>
          </div>
        </>
      )}

      {/* Smart pay plan — flat list, no nested boxes */}
      {allocations.length > 0 && (
        <>
          <CardDivider />
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500">
              Smart pay plan
            </span>
            {totalSavedMonthly > 0 && (
              <span className="text-[10px] num text-emerald-400">
                save ~{inrCompact(totalSavedMonthly)}/mo interest
              </span>
            )}
          </div>
          <div className="flex flex-col">
            {allocations.slice(0, 5).map((a, i) => {
              const days = a.days_left ?? Math.ceil((new Date(a.due_date).getTime() - Date.now()) / 86_400_000);
              const urgentTone = days <= 3 ? "text-red-400" : days <= 7 ? "text-amber-400" : "text-zinc-500";
              return (
                <div key={i} className="flex items-center gap-2 py-1.5">
                  <span className={cn("h-1.5 w-1.5 rounded-full shrink-0",
                    days <= 3 ? "bg-red-500" : days <= 7 ? "bg-amber-500" : "bg-zinc-600",
                  )} />
                  <span className="text-sm text-zinc-300 flex-1 truncate">
                    {a.card_name ?? a.card ?? "Card"}
                  </span>
                  <span className="text-[11px] text-zinc-600 hidden md:inline-flex items-center gap-1">
                    {a.from_account_name ?? a.pay_from ?? "—"} <ArrowRight size={9} />
                  </span>
                  <span className={cn("text-[11px] num shrink-0 w-12 text-right", urgentTone)}>
                    {days <= 0 ? "today" : `${days}d`}
                  </span>
                  <span className="num text-sm text-zinc-100 shrink-0 w-20 text-right">
                    {inrCompact(a.allocatable ?? a.amount ?? 0)}
                  </span>
                </div>
              );
            })}
            {allocations.length > 5 && (
              <span className="text-[11px] text-zinc-600 mt-1">+{allocations.length - 5} more cards</span>
            )}
          </div>
        </>
      )}

      {urgent.length > 0 && (
        <div className="rounded-xl bg-amber-500/8 border border-amber-500/20 px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={12} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-amber-300 font-semibold uppercase tracking-wider">Due within 7 days</p>
            <p className="text-xs text-zinc-400 truncate">
              {urgent.map(a => a.card_name ?? a.card).filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
      )}

      <p className="text-[10px] text-zinc-600 text-right num">{s.as_of}</p>
    </Card>
  );
}

function GapBadge({ gap, deficit }: { gap: number; deficit: boolean }) {
  return (
    <div className={cn(
      "flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs num font-semibold",
      deficit
        ? "bg-red-500/10 border-red-500/30 text-red-300"
        : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
    )}>
      {deficit ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
      {deficit ? "−" : "+"}{inr(Math.abs(gap)).slice(1)}
    </div>
  );
}
