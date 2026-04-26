import { useEffect, useState } from "react";
import { Sparkles, X, Check, Loader2 } from "lucide-react";
import { getRecurringSuggestions, type RecurringSuggestion } from "@/modules/gmail";
import * as api from "@/modules/subtracker/services/api";
import { inrCompact } from "@/lib/tokens";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "recurring-suggestions-dismissed-v1";

function loadDismissed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "[]")); }
  catch { return new Set(); }
}

interface Props {
  /** Called after a suggestion is converted into a tracked subscription. */
  onConverted?: () => void;
}

/** Map detector cadence → recurring_obligations.frequency enum the backend expects. */
function cadenceToFreq(cadence: RecurringSuggestion["frequency"]): string {
  // The detector emits weekly | monthly | quarterly | yearly.
  // recurring_obligations.frequency accepts the same set.
  return cadence;
}

export function RecurringSuggestionsStrip({ onConverted }: Props) {
  const [suggestions, setSuggestions] = useState<RecurringSuggestion[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed);
  const [pending,   setPending]   = useState<string | null>(null);
  const [converted, setConverted] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await getRecurringSuggestions({ lookbackDays: 180, minOccurrences: 2 });
        if (alive) setSuggestions(res);
      } catch {
        // silently swallow — suggestions are non-critical
      }
    })();
    return () => { alive = false; };
  }, []);

  function dismiss(key: string) {
    const next = new Set(dismissed);
    next.add(key);
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...next]));
    setDismissed(next);
  }

  async function track(s: RecurringSuggestion) {
    setPending(s.merchant_key);
    try {
      await api.createObligation({
        type:       "subscription",
        name:       s.display_name,
        amount:     s.average_amount,
        frequency:  cadenceToFreq(s.frequency) as any,
        due_day:    new Date(s.last_seen).getDate() || 1,
        category:   "Subscription",
      });
      // Mark as converted locally so the chip flips to "✓ tracked" and we
      // don't double-create on a fast double-click.
      setConverted(prev => {
        const n = new Set(prev); n.add(s.merchant_key); return n;
      });
      onConverted?.();
    } catch (e) {
      alert("Could not track this subscription: " + (e as Error).message);
    } finally {
      setPending(null);
    }
  }

  const visible = suggestions.filter(s => !dismissed.has(s.merchant_key)).slice(0, 6);
  if (visible.length === 0) return null;

  return (
    <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 px-4 py-3 mb-6 flex items-center gap-3 overflow-hidden">
      <Sparkles size={14} className="text-violet-300 shrink-0" />
      <span className="text-[11px] uppercase tracking-wider font-semibold text-violet-300 shrink-0">
        Detected · {visible.length}
      </span>
      <div className="flex-1 flex items-center gap-2 overflow-x-auto">
        {visible.map(s => {
          const isPending   = pending === s.merchant_key;
          const isConverted = converted.has(s.merchant_key);
          return (
            <div
              key={s.merchant_key}
              className={cn(
                "shrink-0 flex items-center gap-2 pl-3 pr-1.5 py-1 rounded-lg border transition-colors",
                isConverted
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
                  : "bg-zinc-900/80 border-zinc-800 text-zinc-300 hover:border-zinc-700",
              )}
              title={`${s.occurrences} charges · ${s.frequency} · last seen ${s.last_seen}`}
            >
              <span className="font-medium text-xs">{s.display_name}</span>
              <span className="num text-[11px] text-zinc-500">{inrCompact(s.average_amount)}</span>
              <span className="text-[10px] uppercase tracking-wider text-violet-300/80">{s.frequency}</span>

              {isConverted ? (
                <span className="text-[11px] text-emerald-300 inline-flex items-center gap-1 px-2">
                  <Check size={11} /> tracked
                </span>
              ) : (
                <button
                  onClick={() => track(s)}
                  disabled={isPending}
                  className="text-[11px] font-semibold px-2 py-0.5 rounded
                             bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50
                             inline-flex items-center gap-1"
                >
                  {isPending ? <Loader2 size={11} className="animate-spin" /> : "Track"}
                </button>
              )}

              <button
                aria-label="Dismiss"
                onClick={() => dismiss(s.merchant_key)}
                className="text-zinc-600 hover:text-zinc-200 px-1"
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
