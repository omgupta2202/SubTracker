import { useState, useEffect } from "react";
import { X, History, GitCompare, Camera, TrendingUp, TrendingDown } from "lucide-react";
import { getDailyLogs, captureDailyLog, compareDailyLogs } from "@/modules/subtracker/services/api";
import type { DailyLogMeta, DailyLogComparison, DiffValue, DiffEntity } from "@/modules/subtracker/types";
import { formatINR } from "@/lib/utils";
import { cn } from "@/lib/utils";

type View = "history" | "compare";

interface Props {
  open: boolean;
  onClose: () => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function DeltaCell({ dv }: { dv: DiffValue }) {
  if (dv.delta === 0) {
    return <span className="text-zinc-600 font-mono text-xs">—</span>;
  }
  const absAmt = formatINR(Math.abs(dv.delta));
  const sign   = dv.delta > 0 ? "+" : "−";
  const pctStr = dv.pct !== null ? ` (${dv.delta > 0 ? "+" : "−"}${Math.abs(dv.pct)}%)` : "";

  let colorCls = "text-amber-400";
  if (dv.positive_is_good === true)  colorCls = dv.delta > 0 ? "text-emerald-400" : "text-red-400";
  if (dv.positive_is_good === false) colorCls = dv.delta > 0 ? "text-red-400"     : "text-emerald-400";

  const Icon = dv.delta > 0 ? TrendingUp : TrendingDown;
  return (
    <span className={cn("flex items-center gap-1 font-mono text-xs font-semibold", colorCls)}>
      <Icon size={11} />
      {sign}{absAmt}{pctStr}
    </span>
  );
}

function MonoAmt({ v }: { v: number | null }) {
  if (v === null) return <span className="text-zinc-600 text-xs">—</span>;
  return <span className="font-mono text-xs text-zinc-200">{formatINR(v)}</span>;
}

const SUMMARY_LABELS: [string, string][] = [
  ["total_liquid",         "Total Liquid"],
  ["total_cc_outstanding", "CC Outstanding"],
  ["rent",                 "Rent"],
  ["net_after_cc",         "Net (after CC & Rent)"],
  ["total_receivables",    "Total Receivables"],
  ["total_capex",          "Total CapEx"],
  ["cash_flow_gap",        "Cash Flow Gap"],
];

const SECTION_CONFIG: { key: keyof DailyLogComparison; label: string; fields: [string, string][] }[] = [
  { key: "accounts",      label: "Bank Accounts",  fields: [["balance",      "Balance"]] },
  { key: "cards",         label: "Credit Cards",   fields: [["outstanding",  "Outstanding"], ["minimum_due", "Min Due"]] },
  { key: "emis",          label: "EMIs",           fields: [["paid_months",  "Months Paid"], ["amount",      "EMI"]] },
  { key: "subscriptions", label: "Subscriptions",  fields: [["amount",       "Amount"]] },
  { key: "receivables",   label: "Receivables",    fields: [["amount",       "Amount"]] },
  { key: "capex",         label: "CapEx",          fields: [["amount",       "Amount"]] },
];

const STATUS_BADGE: Record<DiffEntity["status"], string> = {
  changed:   "bg-amber-500/15 text-amber-400 border-amber-500/30",
  added:     "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  removed:   "bg-red-500/15 text-red-400 border-red-500/30",
  unchanged: "bg-zinc-800 text-zinc-500 border-zinc-700",
};

// ── Log History View ─────────────────────────────────────────────────────────

function HistoryView({
  logs, loading, capturing,
  onCapture,
}: {
  logs: DailyLogMeta[];
  loading: boolean;
  capturing: boolean;
  onCapture: () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-8 py-5 border-b border-zinc-800 shrink-0">
        <div>
          <h3 className="text-base font-bold text-zinc-100">Log History</h3>
          <p className="text-xs text-zinc-500">{logs.length} snapshot{logs.length !== 1 ? "s" : ""} recorded</p>
        </div>
        <button
          onClick={onCapture}
          disabled={capturing}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
        >
          <Camera size={14} />
          {capturing ? "Capturing…" : "Capture Today"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {loading && (
          <div className="text-zinc-500 text-sm text-center py-12">Loading…</div>
        )}
        {!loading && logs.length === 0 && (
          <div className="text-center py-16">
            <History size={32} className="text-zinc-700 mx-auto mb-3" />
            <p className="text-zinc-500 text-sm">No logs yet.</p>
            <p className="text-zinc-600 text-xs mt-1">Hit "Capture Today" to save your first snapshot.</p>
          </div>
        )}
        {!loading && logs.length > 0 && (
          <div className="flex flex-col gap-2">
            {logs.map((log) => {
              const s = log.summary;
              return (
                <div
                  key={log.id}
                  className="rounded-2xl bg-zinc-900/60 border border-zinc-800 hover:border-zinc-700 transition-colors p-4"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-bold text-zinc-100">{fmtDate(log.log_date)}</span>
                    <span className="text-xs text-zinc-600 font-mono">{log.log_date}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Metric label="Total Liquid"   value={s.total_liquid}         />
                    <Metric label="CC Debt"        value={s.total_cc_outstanding} bad />
                    <Metric label="Net (after CC)" value={s.net_after_cc}         />
                    <Metric label="Cash Flow Gap"  value={s.cash_flow_gap}        />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  const color = bad
    ? value > 0 ? "text-red-400" : "text-emerald-400"
    : value >= 0 ? "text-zinc-100" : "text-red-400";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-zinc-600 uppercase tracking-wide">{label}</span>
      <span className={cn("font-mono text-sm font-bold", color)}>{formatINR(value)}</span>
    </div>
  );
}

// ── Compare View ─────────────────────────────────────────────────────────────

function CompareView({ logs }: { logs: DailyLogMeta[] }) {
  const [dateA, setDateA] = useState("");
  const [dateB, setDateB] = useState("");
  const [result, setResult] = useState<DailyLogComparison | null>(null);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState("");

  async function runCompare() {
    if (!dateA || !dateB || dateA === dateB) {
      setError("Select two different dates.");
      return;
    }
    setComparing(true);
    setError("");
    try {
      const data = await compareDailyLogs(dateA, dateB);
      setResult(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setComparing(false);
    }
  }

  const selectCls =
    "bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-zinc-100 " +
    "focus:outline-none focus:border-violet-500 transition-all";

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="px-8 py-5 border-b border-zinc-800 shrink-0">
        <h3 className="text-base font-bold text-zinc-100 mb-4">Compare Snapshots</h3>
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex flex-col gap-1.5 flex-1 min-w-[160px]">
            <label className="text-xs text-zinc-500 uppercase tracking-wide font-semibold">Base Date</label>
            <select className={selectCls} value={dateA} onChange={e => setDateA(e.target.value)}>
              <option value="">— select —</option>
              {logs.map(l => (
                <option key={l.log_date} value={l.log_date}>{fmtDate(l.log_date)}</option>
              ))}
            </select>
          </div>
          <div className="text-zinc-600 pb-2.5 font-bold">vs</div>
          <div className="flex flex-col gap-1.5 flex-1 min-w-[160px]">
            <label className="text-xs text-zinc-500 uppercase tracking-wide font-semibold">Compare Date</label>
            <select className={selectCls} value={dateB} onChange={e => setDateB(e.target.value)}>
              <option value="">— select —</option>
              {logs.map(l => (
                <option key={l.log_date} value={l.log_date}>{fmtDate(l.log_date)}</option>
              ))}
            </select>
          </div>
          <button
            onClick={runCompare}
            disabled={comparing || !dateA || !dateB}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors shrink-0"
          >
            <GitCompare size={14} />
            {comparing ? "Comparing…" : "Compare"}
          </button>
        </div>
        {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {!result && !comparing && (
          <div className="text-center py-16">
            <GitCompare size={32} className="text-zinc-700 mx-auto mb-3" />
            <p className="text-zinc-500 text-sm">Select two dates above and click Compare.</p>
          </div>
        )}

        {result && (
          <div className="flex flex-col gap-8">
            {/* Column headers */}
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-6 items-center pb-2 border-b border-zinc-800">
              <span className="text-xs text-zinc-600 uppercase tracking-widest">Metric / Item</span>
              <span className="text-xs text-zinc-500 font-mono w-28 text-right">{fmtDate(result.date_a)}</span>
              <span className="text-xs text-zinc-500 font-mono w-28 text-right">{fmtDate(result.date_b)}</span>
              <span className="text-xs text-zinc-500 uppercase tracking-widest w-40 text-right">Change</span>
            </div>

            {/* Summary section */}
            <Section title="Summary Metrics">
              {SUMMARY_LABELS.map(([key, label]) => {
                const dv = result.summary[key];
                if (!dv) return null;
                return (
                  <TableRow key={key} label={label}>
                    <MonoAmt v={dv.a} />
                    <MonoAmt v={dv.b} />
                    <DeltaCell dv={dv} />
                  </TableRow>
                );
              })}
            </Section>

            {/* Entity sections */}
            {SECTION_CONFIG.map(({ key, label, fields }) => {
              const entities = result[key] as DiffEntity[];
              if (!entities || entities.length === 0) return null;
              return (
                <Section key={key} title={label}>
                  {entities.map(entity => (
                    <EntityRows key={entity.id} entity={entity} fields={fields} />
                  ))}
                </Section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">{title}</p>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function TableRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-6 items-center px-3 py-2 rounded-lg hover:bg-zinc-800/40 transition-colors">
      <span className="text-sm text-zinc-300">{label}</span>
      {children}
    </div>
  );
}

function EntityRows({
  entity, fields,
}: {
  entity: DiffEntity;
  fields: [string, string][];
}) {
  const multiField = fields.length > 1;

  if (!multiField) {
    const [fieldKey] = fields[0];
    const dv = entity.fields[fieldKey];
    return (
      <TableRow
        label={
          <span className="flex items-center gap-2">
            {entity.name}
            <span className={cn(
              "text-xs px-1.5 py-0.5 rounded-full border capitalize",
              STATUS_BADGE[entity.status]
            )}>
              {entity.status !== "unchanged" ? entity.status : null}
            </span>
          </span>
        }
      >
        <span className="w-28 flex justify-end">
          {dv ? <MonoAmt v={dv.a} /> : <span className="text-zinc-600 text-xs">—</span>}
        </span>
        <span className="w-28 flex justify-end">
          {dv ? <MonoAmt v={dv.b} /> : <span className="text-zinc-600 text-xs">—</span>}
        </span>
        <span className="w-40 flex justify-end">
          {dv ? <DeltaCell dv={dv} /> : <span className="text-zinc-600 text-xs">—</span>}
        </span>
      </TableRow>
    );
  }

  return (
    <>
      <div className="px-3 py-1.5">
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-zinc-200">{entity.name}</span>
          <span className={cn(
            "text-xs px-1.5 py-0.5 rounded-full border capitalize",
            STATUS_BADGE[entity.status]
          )}>
            {entity.status !== "unchanged" ? entity.status : null}
          </span>
        </span>
      </div>
      {fields.map(([fieldKey, fieldLabel]) => {
        const dv = entity.fields[fieldKey];
        return (
          <TableRow key={fieldKey} label={<span className="text-zinc-500 text-xs pl-4">{fieldLabel}</span>}>
            <span className="w-28 flex justify-end">
              {dv ? <MonoAmt v={dv.a} /> : <span className="text-zinc-600 text-xs">—</span>}
            </span>
            <span className="w-28 flex justify-end">
              {dv ? <MonoAmt v={dv.b} /> : <span className="text-zinc-600 text-xs">—</span>}
            </span>
            <span className="w-40 flex justify-end">
              {dv ? <DeltaCell dv={dv} /> : <span className="text-zinc-600 text-xs">—</span>}
            </span>
          </TableRow>
        );
      })}
    </>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────

const NAV = [
  { id: "history" as View, label: "Log History",  icon: <History size={16} />,    desc: "Captured snapshots" },
  { id: "compare" as View, label: "Compare",      icon: <GitCompare size={16} />, desc: "Side-by-side analysis" },
];

export function HistoryPanel({ open, onClose }: Props) {
  const [view, setView]         = useState<View>("history");
  const [logs, setLogs]         = useState<DailyLogMeta[]>([]);
  const [loading, setLoading]   = useState(false);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (open) fetchLogs();
  }, [open]);

  async function fetchLogs() {
    setLoading(true);
    try {
      setLogs(await getDailyLogs());
    } finally {
      setLoading(false);
    }
  }

  async function handleCapture() {
    setCapturing(true);
    try {
      await captureDailyLog();
      await fetchLogs();
    } finally {
      setCapturing(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 m-auto w-full max-w-5xl h-[90vh] bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl flex overflow-hidden">

        {/* ── Sidebar ── */}
        <div className="w-56 shrink-0 bg-zinc-900/80 border-r border-zinc-800 flex flex-col">
          <div className="px-5 py-5 border-b border-zinc-800">
            <h2 className="text-base font-bold text-zinc-100">History</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Daily snapshots & trends</p>
          </div>
          <nav className="flex-1 overflow-y-auto py-3 px-2 flex flex-col gap-0.5">
            {NAV.map(n => (
              <button
                key={n.id}
                onClick={() => setView(n.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors",
                  view === n.id
                    ? "bg-violet-600/20 text-violet-300 border border-violet-500/30"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 border border-transparent"
                )}
              >
                <span className={view === n.id ? "text-violet-400" : "text-zinc-500"}>{n.icon}</span>
                <div>
                  <p className="text-xs font-semibold leading-tight">{n.label}</p>
                  <p className="text-xs text-zinc-600 leading-tight mt-0.5">{n.desc}</p>
                </div>
              </button>
            ))}
          </nav>

          {/* Log count badge */}
          {logs.length > 0 && (
            <div className="px-5 py-4 border-t border-zinc-800">
              <p className="text-xs text-zinc-600">
                <span className="text-violet-400 font-bold">{logs.length}</span> snapshots total
              </p>
              {logs[0] && (
                <p className="text-xs text-zinc-700 mt-0.5">Latest: {fmtDate(logs[0].log_date)}</p>
              )}
            </div>
          )}
        </div>

        {/* ── Content ── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Close button strip */}
          <div className="absolute top-4 right-4 z-20">
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {view === "history" && (
            <HistoryView
              logs={logs}
              loading={loading}
              capturing={capturing}
              onCapture={handleCapture}
            />
          )}
          {view === "compare" && <CompareView logs={logs} />}
        </div>
      </div>
    </div>
  );
}
