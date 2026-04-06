import { useState } from "react";
import type { DashboardSummary, SmartAllocationResponse } from "@/types";
import type { PeriodSummary } from "@/services/api";
import { formatINR } from "@/lib/utils";
import { ArrowRight, AlertTriangle, CheckCircle2, Banknote, EyeOff, Calendar, TrendingUp, TrendingDown, Loader2, Info } from "lucide-react";

interface Props {
  dashboardSummary: DashboardSummary | null;
  dashboardLoading: boolean;
  allocation?: SmartAllocationResponse | null;
  periodSummary?: PeriodSummary | null;
  periodLoading?: boolean;
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
  color: string;
  bold?: boolean;
  tag?: string;
  info?: string;
};

function CashFlowRow({ row, isOff, toggle }: { row: Row; isOff: boolean; toggle: (key: string) => void }) {
  return (
    <div className={`flex items-center justify-between py-1.5 group ${
      row.bold ? "border-t border-zinc-700/60 mt-1 pt-2" : "border-b border-zinc-800/60"
    } ${isOff ? "opacity-35" : ""}`}>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className={`text-xs font-mono w-3 text-center shrink-0 ${
          row.sign === "+" ? "text-emerald-500" : row.sign === "−" ? "text-red-500" : "text-zinc-500"
        }`}>{row.sign}</span>
        <span className={`text-sm truncate ${row.bold ? "font-semibold text-zinc-100" : "text-zinc-400"}`}>
          {row.label}
        </span>
        {row.info && (
          <span title={row.info} className="text-zinc-500 hover:text-zinc-300 transition-colors cursor-help" aria-label={`${row.label} info`}>
            <Info size={12} />
          </span>
        )}
        {row.tag && (
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-zinc-700/60 text-zinc-500 border border-zinc-600/40 shrink-0">
            {row.tag}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={`font-mono text-sm ${row.bold ? "font-bold" : ""} ${row.color}`}>
          {formatINR(row.value)}
        </span>
        <div className="w-6 flex justify-center">
          {row.key ? (
            <button
              onClick={() => toggle(row.key!)}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-zinc-600 hover:text-zinc-300"
              title={isOff ? "Include" : "Exclude from calculation"}
            >
              <EyeOff size={12} />
            </button>
          ) : (
            <div className="w-5" />
          )}
        </div>
      </div>
    </div>
  );
}

function SpinnerBlock() {
  return (
    <div className="bg-zinc-900 p-6 h-64 flex items-center justify-center">
      <Loader2 size={22} className="text-violet-400 animate-spin" />
    </div>
  );
}

export function CashFlowCard({ dashboardSummary, dashboardLoading, allocation, periodSummary, periodLoading = false }: Props) {
  const [disabled, setDisabled] = useState<Set<string>>(loadDisabled);

  if (dashboardLoading && !dashboardSummary) {
    return <SpinnerBlock />;
  }

  function toggle(key: string) {
    setDisabled(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  const off = (key: string) => disabled.has(key);

  // ── Period mode (legacy filters active) ───────────────────────────────────
  if (periodLoading && !periodSummary) {
    return <SpinnerBlock />;
  }
  if (periodSummary) {
    const p = periodSummary;
    const cc      = off("cc")      ? 0 : p.cc_total;
    const subs    = off("subs")    ? 0 : p.subs_total;
    const emis    = off("emis")    ? 0 : p.emis_total;
    const rent    = off("rent")    ? 0 : p.rent_total;
    const inflows = off("inflows") ? 0 : p.receivables_total;
    const capex   = off("capex")   ? 0 : p.capex_total;
    const netAfterCC = p.total_liquid - cc - rent;
    const gap        = netAfterCC + inflows - capex - subs - emis;
    const isDeficit  = gap < 0;

    const rows: Row[] = [
      { key: null,      label: "Total Liquid",      value: p.total_liquid,      sign: "+", color: "text-zinc-200", info: "Sum of active bank, wallet, and cash balances." },
      { key: "cc",      label: "CC Outstanding",    value: p.cc_total,          sign: "−", color: "text-red-400",
        tag: `${p.cc_source === "transactions" ? "txns" : "balance"}${p.billed_statement_status && p.billed_statement_status !== "all" ? ` · ${p.billed_statement_status}` : ""}`,
        info: "Unpaid credit card dues included in this view." },
      { key: "subs",    label: "Subscriptions Due", value: p.subs_total,        sign: "−", color: "text-red-400/70", info: "Recurring subscription payments due in selected period." },
      { key: "emis",    label: "EMIs Due",           value: p.emis_total,        sign: "−", color: "text-red-400/70", info: "Loan installment payments due in selected period." },
      { key: "rent",    label: "Rent",               value: p.rent_total,        sign: "−", color: "text-red-400/70", info: "Scheduled rent outflow for the selected period." },
      { key: null,      label: "Net After CC",       value: netAfterCC,          sign: "=", color: netAfterCC >= 0 ? "text-emerald-400" : "text-red-400", bold: true, info: "Total liquid balance minus credit card outstanding." },
      { key: "inflows", label: "Expected Inflows",   value: p.receivables_total, sign: "+", color: "text-emerald-400", info: "Receivables expected to be collected." },
      { key: "capex",   label: "Planned CapEx",      value: p.capex_total,       sign: "−", color: "text-amber-400", info: "Planned one-time capital spends." },
    ];

    return (
      <div className="bg-zinc-900 p-6 flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-zinc-400 text-sm font-medium">
            <Banknote size={16} className="text-violet-400" />
            Cash Flow
            <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/20">
              <Calendar size={10} /> Period view
            </span>
          </div>
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-mono font-semibold ${
            isDeficit ? "bg-red-500/10 border-red-500/30 text-red-400" : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
          }`}>
            {isDeficit ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
            {isDeficit ? "−" : "+"}{formatINR(Math.abs(gap))}
          </div>
        </div>
        <div className="flex flex-col gap-0">
          {rows.map(row => (
            <CashFlowRow key={row.label} row={row} isOff={row.key ? off(row.key) : false} toggle={toggle} />
          ))}
        </div>
      </div>
    );
  }

  // ── Default mode — ledger-derived dashboard summary ────────────────────────
  const s = dashboardSummary;
  if (!s) return <SpinnerBlock />;

  const cc           = off("cc")      ? 0 : s.total_cc_outstanding;
  const inflows      = off("inflows") ? 0 : s.total_receivables_30d;
  const obligations  = off("oblig")   ? 0 : s.upcoming_obligations_30d;
  const capex        = off("capex")   ? 0 : s.total_capex_planned;
  const netAfterCC   = s.total_liquid - cc;
  const gap          = s.total_liquid + inflows - cc - obligations - capex;
  const isDeficit    = gap < 0;

  const rows: Row[] = [
    { key: null,     label: "Total Liquid",        value: s.total_liquid,            sign: "+", color: "text-zinc-200", info: "Sum of active bank, wallet, and cash balances." },
    { key: "cc",     label: "CC Outstanding",      value: s.total_cc_outstanding,    sign: "−", color: "text-red-400", tag: "ledger", info: "Unpaid credit card dues across all cards." },
    { key: null,     label: "Net After CC",         value: netAfterCC,                sign: "=", color: netAfterCC >= 0 ? "text-emerald-400" : "text-red-400", bold: true, info: "Total liquid balance minus credit card outstanding." },
    { key: "inflows",label: "Expected Inflows",     value: s.total_receivables_30d,   sign: "+", color: "text-emerald-400", info: "Expected receivables due in next 30 days." },
    { key: "oblig",  label: "Obligations (30d)",    value: s.upcoming_obligations_30d,sign: "−", color: "text-red-400/70", tag: "30d", info: "Upcoming recurring obligations due in next 30 days." },
    { key: "capex",  label: "Planned CapEx",        value: s.total_capex_planned,     sign: "−", color: "text-amber-400", info: "Planned one-time capital spends." },
  ];

  const allocations  = allocation?.allocations ?? [];
  const postBalances = allocation?.post_balances ?? [];
  const urgent = allocations.filter(a => {
    if (typeof a.days_left === "number") return a.days_left <= 7;
    const due = new Date(a.due_date);
    const days = Math.ceil((due.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    return days <= 7;
  });

  return (
    <div className="bg-zinc-900 p-6 flex flex-col gap-5 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-zinc-400 text-sm font-medium">
          <Banknote size={16} className="text-violet-400" />
          Cash Flow
        </div>
        <div className="flex items-center gap-2">
          {s.monthly_burn_trend_pct !== null && (
            <span className={`flex items-center gap-0.5 text-xs font-mono ${s.monthly_burn_trend_pct > 0 ? "text-red-400" : "text-emerald-400"}`}>
              {s.monthly_burn_trend_pct > 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
              {Math.abs(s.monthly_burn_trend_pct)}%
            </span>
          )}
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-mono font-semibold ${
            isDeficit ? "bg-red-500/10 border-red-500/30 text-red-400" : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
          }`}>
            {isDeficit ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
            {isDeficit ? "−" : "+"}{formatINR(Math.abs(gap))}
          </div>
        </div>
      </div>

      {/* Cash Flow Waterfall */}
      <div className="flex flex-col gap-0">
        {rows.map(row => (
          <CashFlowRow key={row.label} row={row} isOff={row.key ? off(row.key) : false} toggle={toggle} />
        ))}
      </div>

      {/* Credit utilization */}
      {s.credit_utilization_pct !== null && (
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-500 shrink-0">CC Utilization</span>
          <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${s.credit_utilization_pct > 80 ? "bg-red-500" : s.credit_utilization_pct > 50 ? "bg-amber-500" : "bg-emerald-500"}`}
              style={{ width: `${Math.min(s.credit_utilization_pct, 100)}%` }}
            />
          </div>
          <span className={`text-xs font-mono shrink-0 ${s.credit_utilization_pct > 80 ? "text-red-400" : s.credit_utilization_pct > 50 ? "text-amber-400" : "text-emerald-400"}`}>
            {s.credit_utilization_pct}%
          </span>
        </div>
      )}

      {/* Urgent dues */}
      {urgent.length > 0 && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3 flex flex-col gap-1">
          <p className="text-xs text-amber-400 font-semibold">Due within 7 days</p>
          {urgent.map((a, i) => (
            <div key={i} className="flex justify-between text-xs text-zinc-300">
              <span>{a.card_name ?? a.card ?? "Card"}</span>
              <span className="font-mono">{formatINR(a.allocatable ?? a.amount ?? a.balance_due ?? 0)} · {a.due_date}</span>
            </div>
          ))}
        </div>
      )}

      {/* Smart Pay Plan (from allocation engine) */}
      {allocations.length > 0 && (
        <div>
          <p className="text-xs text-zinc-500 mb-2 font-medium uppercase tracking-wide">Smart Pay Plan</p>
          <div className="flex flex-col gap-1.5">
            {allocations.map((a, i) => (
              <div key={i} className={`flex items-center gap-3 rounded-lg px-3 py-2 border ${
                (a.days_left ?? 99) <= 3 ? "bg-red-500/10 border-red-500/20"
                : (a.days_left ?? 99) <= 7 ? "bg-amber-500/10 border-amber-500/20"
                : "bg-zinc-800/40 border-zinc-700/40"
              }`}>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-zinc-200 font-medium truncate">{a.card_name ?? a.card ?? "Card"}</p>
                  <div className="flex items-center gap-1 text-xs text-zinc-500">
                    <span>{a.from_account_name ?? a.pay_from ?? "Account"}</span>
                    <ArrowRight size={10} />
                    <span>
                      {(a.days_left ?? 0) === 0 ? "Today" : `${a.days_left ?? 0}d left`}
                    </span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-mono text-xs font-semibold text-zinc-200">{formatINR(a.allocatable ?? a.amount ?? 0)}</p>
                  {!(a.feasible ?? a.can_pay_minimum ?? true) && <p className="text-xs text-red-400">insufficient</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Post-payment balances */}
      {postBalances.length > 0 && (
        <div>
          <p className="text-xs text-zinc-500 mb-2 font-medium uppercase tracking-wide">After All Payments</p>
          <div className="grid grid-cols-3 gap-2">
            {postBalances.map(b => (
              <div key={b.account_name ?? b.account} className="rounded-lg bg-zinc-800/60 px-3 py-2 text-center">
                <p className="text-xs text-zinc-500 truncate">{b.account_name ?? b.account}</p>
                <p className={`font-mono text-sm font-semibold mt-0.5 ${(b.after ?? b.remaining ?? 0) < 0 ? "text-red-400" : "text-zinc-200"}`}>
                  {formatINR(b.after ?? b.remaining ?? 0)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-zinc-600 text-right">as of {s.as_of}</p>
    </div>
  );
}
