import { useState } from "react";
import type { SmartAllocationResponse } from "@/types";
import type { PeriodSummary } from "@/services/api";
import { formatINR } from "@/lib/utils";
import { ArrowRight, AlertTriangle, CheckCircle2, Banknote, EyeOff, Calendar } from "lucide-react";

interface Props {
  data: SmartAllocationResponse | null;
  loading: boolean;
  periodSummary?: PeriodSummary | null;
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
};

function CashFlowRow({ row, isOff, toggle, isFirstBold }: { row: Row; isOff: boolean; toggle: (key: string) => void; isFirstBold?: boolean }) {
  return (
    <div
      key={row.label}
      className={`flex items-center justify-between py-1.5 group ${
        row.bold ? "border-t border-zinc-700/60 mt-1 pt-2" : ""
      } ${!row.bold && !isFirstBold ? "border-b border-zinc-800/60" : ""} ${
        isOff ? "opacity-35" : ""
      }`}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className={`text-xs font-mono w-3 text-center shrink-0 ${
          row.sign === "+" ? "text-emerald-500" : row.sign === "−" ? "text-red-500" : "text-zinc-500"
        }`}>{row.sign}</span>
        <span className={`text-sm truncate ${row.bold ? "font-semibold text-zinc-100" : "text-zinc-400"}`}>
          {row.label}
        </span>
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
            <div className="w-5" /> // Placeholder for alignment
          )}
        </div>
      </div>
    </div>
  );
}

export function CashFlowCard({ data, loading, periodSummary }: Props) {
  const [disabled, setDisabled] = useState<Set<string>>(loadDisabled);

  if (loading || !data) {
    return <div className="bg-zinc-900 p-6 h-64 animate-pulse" />;
  }

  const { allocations, post_balances } = data;

  function toggle(key: string) {
    setDisabled(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  const off = (key: string) => disabled.has(key);

  // ── Period mode (filters active) ──────────────────────────────────────────
  if (periodSummary) {
    const p = periodSummary;
    const cc      = off("cc")      ? 0 : p.cc_total;
    const subs    = off("subs")    ? 0 : p.subs_total;
    const emis    = off("emis")    ? 0 : p.emis_total;
    const rent    = off("rent")    ? 0 : p.rent_total;
    const inflows = off("inflows") ? 0 : p.receivables_total;
    const capex   = off("capex")   ? 0 : p.capex_total;

    const netAfterCC  = p.total_liquid - cc - rent;
    const gap         = netAfterCC + inflows - capex - subs - emis;
    const isDeficit   = gap < 0;

    const rows: Row[] = [
      { key: null,      label: "Total Liquid",      value: p.total_liquid,      sign: "+", color: "text-zinc-200" },
      { key: "cc",      label: "CC Outstanding",    value: p.cc_total,          sign: "−", color: "text-red-400",
        tag: p.cc_source === "transactions" ? "txns" : "balance" },
      { key: "subs",    label: "Subscriptions Due", value: p.subs_total,        sign: "−", color: "text-red-400/70" },
      { key: "emis",    label: "EMIs Due",           value: p.emis_total,        sign: "−", color: "text-red-400/70" },
      { key: "rent",    label: "Rent",               value: p.rent_total,        sign: "−", color: "text-red-400/70" },
      { key: null,      label: "Net After CC",       value: netAfterCC,          sign: "=", color: netAfterCC >= 0 ? "text-emerald-400" : "text-red-400", bold: true },
      { key: "inflows", label: "Expected Inflows",   value: p.receivables_total, sign: "+", color: "text-emerald-400" },
      { key: "capex",   label: "Planned CapEx",      value: p.capex_total,       sign: "−", color: "text-amber-400" },
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
          {rows.map((row, i) => (
            <CashFlowRow
              key={row.label}
              row={row}
              isOff={row.key ? off(row.key) : false}
              toggle={toggle}
              isFirstBold={row.bold && (i === 0 || !rows[i - 1].bold)}
            />
          ))}
        </div>
      </div>
    );
  }

  // ── Default mode ──────────────────────────────────────────────────────────
  const { summary } = data;
  const cc      = off("cc")      ? 0 : summary.total_cc_outstanding;
  const rent    = off("rent")    ? 0 : summary.rent;
  const inflows = off("inflows") ? 0 : summary.total_receivables;
  const capex   = off("capex")   ? 0 : summary.total_capex;

  const netAfterCC = summary.total_liquid - cc - rent;
  const gap        = netAfterCC + inflows - capex;
  const isDeficit  = gap < 0;

  const rows: Row[] = [
    { key: null,      label: "Total Liquid",     value: summary.total_liquid,         sign: "+", color: "text-zinc-200" },
    { key: "cc",      label: "CC Outstanding",   value: summary.total_cc_outstanding, sign: "−", color: "text-red-400" },
    { key: "rent",    label: "Rent",             value: summary.rent,                 sign: "−", color: "text-red-400/70" },
    { key: null,      label: "Net After CC",     value: netAfterCC,                   sign: "=", color: netAfterCC >= 0 ? "text-emerald-400" : "text-red-400", bold: true },
    { key: "inflows", label: "Expected Inflows", value: summary.total_receivables,    sign: "+", color: "text-emerald-400" },
    { key: "capex",   label: "Planned CapEx",    value: summary.total_capex,          sign: "−", color: "text-amber-400" },
  ];

  const urgent = allocations.filter(a => a.days_left <= 7);

  return (
    <div className="bg-zinc-900 p-6 flex flex-col gap-5 backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-zinc-400 text-sm font-medium">
          <Banknote size={16} className="text-violet-400" />
          Cash Flow
        </div>
        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-mono font-semibold ${
          isDeficit ? "bg-red-500/10 border-red-500/30 text-red-400" : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
        }`}>
          {isDeficit ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
          {isDeficit ? "−" : "+"}{formatINR(Math.abs(gap))}
        </div>
      </div>

      <div className="flex flex-col gap-0">
        {rows.map((row, i) => (
          <CashFlowRow
            key={row.label}
            row={row}
            isOff={row.key ? off(row.key) : false}
            toggle={toggle}
            isFirstBold={row.bold && (i === 0 || !rows[i - 1].bold)}
          />
        ))}
      </div>

      {urgent.length > 0 && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3 flex flex-col gap-1">
          <p className="text-xs text-amber-400 font-semibold">⚠ Due within 7 days</p>
          {urgent.map((a, i) => (
            <div key={i} className="flex justify-between text-xs text-zinc-300">
              <span>{a.card}</span>
              <span className="font-mono">{formatINR(a.amount)} · {a.due_date}</span>
            </div>
          ))}
        </div>
      )}

      <div>
        <p className="text-xs text-zinc-500 mb-2 font-medium uppercase tracking-wide">Smart Pay Plan</p>
        <div className="flex flex-col gap-1.5">
          {allocations.map((a, i) => (
            <div key={i} className={`flex items-center gap-3 rounded-lg px-3 py-2 border ${
              a.days_left <= 3 ? "bg-red-500/10 border-red-500/20"
              : a.days_left <= 7 ? "bg-amber-500/10 border-amber-500/20"
              : "bg-zinc-800/40 border-zinc-700/40"
            }`}>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-200 font-medium truncate">{a.card}</p>
                <div className="flex items-center gap-1 text-xs text-zinc-500">
                  <span>{a.pay_from}</span>
                  <ArrowRight size={10} />
                  <span>{a.days_left === 0 ? "Today" : `${a.days_left}d left`}</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="font-mono text-xs font-semibold text-zinc-200">{formatINR(a.amount)}</p>
                {!a.feasible && <p className="text-xs text-red-400">insufficient</p>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs text-zinc-500 mb-2 font-medium uppercase tracking-wide">After All Payments</p>
        <div className="grid grid-cols-3 gap-2">
          {post_balances.map(b => (
            <div key={b.account} className="rounded-lg bg-zinc-800/60 px-3 py-2 text-center">
              <p className="text-xs text-zinc-500 truncate">{b.account}</p>
              <p className={`font-mono text-sm font-semibold mt-0.5 ${b.remaining < 0 ? "text-red-400" : "text-zinc-200"}`}>
                {formatINR(b.remaining)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
