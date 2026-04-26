import { useEffect, useMemo, useState } from "react";
import { BellRing, Loader2, X, ChevronRight, CreditCard, Repeat } from "lucide-react";
import type { AttentionItem } from "@/modules/subtracker/types";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { inrCompact, relativeDay } from "@/lib/tokens";
import { cn } from "@/lib/utils";
import { dismiss, isDismissed, pruneOld } from "@/lib/notificationDismiss";
import { snoozeAttention } from "@/modules/subtracker/services/api";

interface Props {
  items: AttentionItem[];
  loading?: boolean;
  /** Compact dropdown variant (no outer card chrome). */
  embedded?: boolean;
  /** Click handlers — wired by Dashboard so each notification opens the
      right thing (card detail, monthly-burn edit, …). */
  onOpenCard?: (accountId: string, title: string) => void;
  onOpenObligations?: (type: "subscriptions" | "emis" | "rent") => void;
  /** Close the parent popover after a navigation action. */
  onActed?: () => void;
}

export function AttentionSection({
  items, loading = false, embedded = false,
  onOpenCard, onOpenObligations, onActed,
}: Props) {
  // Prune old dismissals on mount so the store doesn't grow forever.
  useEffect(() => { pruneOld(); }, []);

  // Local dismiss state — re-renders this component as the user clears items.
  const [version, setVersion] = useState(0);
  const visible = useMemo(
    () => items.filter(it => !isDismissed(it.id, it.due_date)),
    // version is the dependency that bumps after a dismiss.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, version],
  );
  const top = visible.slice(0, 6);
  const hiddenCount = items.length - visible.length;

  function clear(it: AttentionItem) {
    // Local immediate UX: hide the row instantly via the dismiss store.
    dismiss(it.id, it.due_date);
    setVersion(v => v + 1);
    // Server-side: persist a 3-day snooze keyed by the same item id.
    // Failure is non-fatal — the local dismiss already hid the row, and
    // pruneOld eventually cleans the local store regardless.
    snoozeAttention(it.id, 3).catch(() => {});
  }

  function act(it: AttentionItem) {
    if (it.kind === "credit_card_due" && it.account_id && onOpenCard) {
      onOpenCard(it.account_id, it.title);
    } else if (it.kind === "obligation_due" && onOpenObligations) {
      const t = it.obligation_type;
      const tab: "subscriptions" | "emis" | "rent" =
        t === "emi"  ? "emis" :
        t === "rent" ? "rent" :
        "subscriptions";
      onOpenObligations(tab);
    }
    onActed?.();
  }

  const body = loading ? (
    <div className="h-20 flex items-center justify-center">
      <Loader2 size={18} className="text-violet-400 animate-spin" />
    </div>
  ) : top.length === 0 ? (
    <div className="py-4 text-center">
      <p className="text-sm text-zinc-500">
        {items.length === 0 ? "All clear." : "All caught up."}
      </p>
      {hiddenCount > 0 && (
        <p className="text-[11px] text-zinc-600 mt-1">
          {hiddenCount} dismissed
        </p>
      )}
    </div>
  ) : (
    <div className="flex flex-col">
      {top.map(it => {
        const days  = it.days_until_due ?? 0;
        const tone  =
          days <= 0 ? "text-red-400"   :
          days <= 3 ? "text-amber-400" :
                      "text-zinc-500";
        const dotBg =
          days <= 0 ? "bg-red-500"   :
          days <= 3 ? "bg-amber-400" :
                      "bg-zinc-600";

        return (
          <div
            key={`${it.id}:${it.due_date}`}
            className={cn(
              "group/notif flex items-center gap-2 -mx-2 px-2 py-2 rounded-lg",
              "hover:bg-zinc-800/40 transition-colors",
            )}
          >
            <button
              onClick={() => act(it)}
              className="flex items-center gap-3 flex-1 min-w-0 text-left"
            >
              <span className={cn("h-2 w-2 rounded-full shrink-0", dotBg)} />
              <span className="text-zinc-500 shrink-0">
                {it.kind === "credit_card_due"
                  ? <CreditCard size={13} />
                  : <Repeat size={13} />}
              </span>
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
              <ChevronRight size={13} className="text-zinc-600 group-hover/notif:text-zinc-300 shrink-0 transition-colors" />
            </button>

            {/* Dismiss — keeps a small click target separate from the row's
                main action so users don't accidentally clear when they
                meant to navigate. */}
            <button
              onClick={(e) => { e.stopPropagation(); clear(it); }}
              title="Dismiss"
              aria-label="Dismiss notification"
              className={cn(
                "p-1 rounded-md text-zinc-600 hover:text-zinc-200 hover:bg-zinc-800",
                "opacity-0 group-hover/notif:opacity-100 transition-opacity shrink-0",
              )}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      {visible.length > top.length && (
        <p className="text-[11px] text-zinc-600 text-center pt-2 border-t border-zinc-800/60 mt-1">
          +{visible.length - top.length} more
        </p>
      )}
      {hiddenCount > 0 && (
        <p className="text-[10px] text-zinc-700 text-center mt-1">
          {hiddenCount} dismissed
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
