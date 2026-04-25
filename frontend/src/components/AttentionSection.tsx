import { BellRing, Loader2 } from "lucide-react";
import type { AttentionItem } from "@/types";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { inrCompact, relativeDay } from "@/lib/tokens";
import { cn } from "@/lib/utils";

interface Props {
  items: AttentionItem[];
  loading?: boolean;
  /** When true, renders a compact dropdown variant (no outer card chrome). */
  embedded?: boolean;
}

export function AttentionSection({ items, loading = false, embedded = false }: Props) {
  const top = items.slice(0, 6);

  const body = loading ? (
    <div className="h-20 flex items-center justify-center">
      <Loader2 size={18} className="text-violet-400 animate-spin" />
    </div>
  ) : top.length === 0 ? (
    <p className="text-sm text-zinc-500 py-4 text-center">All clear.</p>
  ) : (
    <div className="flex flex-col">
      {top.map(it => {
        const days = it.days_until_due ?? 0;
        const tone =
          days <= 0 ? "text-red-400"   :
          days <= 3 ? "text-amber-400" :
                      "text-zinc-500";
        return (
          <div key={it.id} className="flex items-center gap-3 py-2">
            <span className={cn(
              "h-2 w-2 rounded-full shrink-0",
              days <= 0 ? "bg-red-500"   :
              days <= 3 ? "bg-amber-400" :
                          "bg-zinc-600",
            )} />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-zinc-200 truncate">{it.title}</div>
              <div className={cn("text-[11px] num", tone)}>
                {relativeDay(days)}
                <span className="text-zinc-700 mx-1">·</span>
                <span className="text-zinc-500">
                  {it.kind === "credit_card_due" ? "card bill" : "obligation"}
                </span>
              </div>
            </div>
            <span className="num text-sm text-amber-300 shrink-0">{inrCompact(it.amount)}</span>
          </div>
        );
      })}
      {items.length > top.length && (
        <p className="text-[11px] text-zinc-600 text-center pt-2 border-t border-zinc-800/60 mt-1">
          +{items.length - top.length} more
        </p>
      )}
    </div>
  );

  if (embedded) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-2xl">
        <div className="flex items-center gap-2 mb-2">
          <BellRing size={13} className="text-amber-400" />
          <span className="text-[11px] uppercase tracking-wider font-semibold text-zinc-400">Needs attention</span>
        </div>
        {body}
      </div>
    );
  }

  return (
    <Card className="flex flex-col gap-2">
      <CardHeader>
        <CardTitle icon={<BellRing size={14} />}>Attention</CardTitle>
      </CardHeader>
      {body}
    </Card>
  );
}
