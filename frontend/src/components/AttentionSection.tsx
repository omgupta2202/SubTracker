import { BellRing, Loader2 } from "lucide-react";
import type { AttentionItem } from "@/types";
import { formatINR } from "@/lib/utils";

interface Props {
  items: AttentionItem[];
  loading?: boolean;
}

function dueLabel(days: number) {
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `in ${days}d`;
}

export function AttentionSection({ items, loading = false }: Props) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 mb-4 shadow-2xl">
      <div className="flex items-center gap-2 mb-3">
        <BellRing size={15} className="text-amber-400" />
        <p className="text-sm font-semibold text-zinc-200">Needs Attention</p>
      </div>

      {loading ? (
        <div className="h-20 flex items-center justify-center">
          <Loader2 size={18} className="text-violet-400 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-zinc-500">No urgent items right now.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((it) => (
            <div key={it.id} className="rounded-xl border border-zinc-700/60 bg-zinc-800/40 px-3 py-2 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-sm text-zinc-100 truncate">{it.title}</p>
                <p className="text-xs text-zinc-500">
                  {new Date(it.due_date).toLocaleDateString("en-IN")} · {dueLabel(it.days_until_due)}
                </p>
              </div>
              <div className="text-right ml-3 shrink-0">
                <p className="font-mono text-sm text-amber-300">{formatINR(it.amount)}</p>
                <p className="text-[11px] text-zinc-500">{it.kind === "credit_card_due" ? "CC Bill" : "Obligation"}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
