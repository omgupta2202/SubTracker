import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { getRecurringSuggestions, type RecurringSuggestion } from "@/modules/gmail";
import { inrCompact } from "@/lib/tokens";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "recurring-suggestions-dismissed-v1";

function loadDismissed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "[]")); }
  catch { return new Set(); }
}

interface Props {
  onConvert?: (s: RecurringSuggestion) => void;
}

export function RecurringSuggestionsStrip({ onConvert }: Props) {
  const [suggestions, setSuggestions] = useState<RecurringSuggestion[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed);

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

  const visible = suggestions.filter(s => !dismissed.has(s.merchant_key)).slice(0, 4);
  if (visible.length === 0) return null;

  return (
    <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3 mb-6 flex items-center gap-3 overflow-hidden">
      <Sparkles size={14} className="text-violet-300 shrink-0" />
      <span className="text-[11px] uppercase tracking-wider font-semibold text-violet-300 shrink-0">
        {visible.length} detected
      </span>
      <div className="flex-1 flex items-center gap-2 overflow-x-auto scrollbar-thin">
        {visible.map(s => (
          <button
            key={s.merchant_key}
            onClick={() => onConvert?.(s)}
            className={cn(
              "shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg",
              "bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800",
              "text-xs text-zinc-300 hover:text-zinc-100 transition-colors",
            )}
            title={`${s.occurrences} charges · ${s.frequency} · last seen ${s.last_seen}`}
          >
            <span className="font-medium">{s.display_name}</span>
            <span className="num text-zinc-500">{inrCompact(s.average_amount)}</span>
            <span className="text-[10px] uppercase tracking-wider text-violet-300">{s.frequency}</span>
            <span
              role="button"
              aria-label="Dismiss"
              onClick={(e) => { e.stopPropagation(); dismiss(s.merchant_key); }}
              className="text-zinc-600 hover:text-zinc-300 -mr-1 ml-1 cursor-pointer"
            >
              <X size={11} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
