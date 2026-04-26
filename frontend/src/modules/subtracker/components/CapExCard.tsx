import { useState } from "react";
import type { CapExItem } from "@/modules/subtracker/types";
import { Target, ChevronDown, ChevronUp, Pencil, ShoppingBag, RotateCcw } from "lucide-react";
import { Card, CardHeader, CardTitle, CardAction } from "@/components/ui/Card";
import { Stat, Row } from "@/components/ui/Stat";
import { EditList, Field, FieldGrid, inputCls } from "@/components/ui/EditList";
import { inrCompact } from "@/lib/tokens";
import { cn } from "@/lib/utils";
import * as api from "@/modules/subtracker/services/api";

interface Props {
  items: CapExItem[];
  availableAfterCC: number;
  onRefetch: () => void;
  onHide?: () => void;
}

const CATEGORY_DOT: Record<string, string> = {
  Home:        "bg-sky-400",
  Personal:    "bg-violet-400",
  "Dev Tools": "bg-amber-400",
  Other:       "bg-zinc-500",
};
const dotFor = (c: string) => CATEGORY_DOT[c] ?? "bg-zinc-500";

export function CapExCard({ items, availableAfterCC, onRefetch, onHide }: Props) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showPurchased, setShowPurchased] = useState(false);

  // Active = not yet bought. Purchased rows have their own toggleable
  // section so the "what do I still owe myself?" total stays clean.
  const active    = items.filter(i => i.status !== "purchased");
  const purchased = items.filter(i => i.status === "purchased");

  const total = active.reduce((s, i) => s + i.amount, 0);
  const gap   = availableAfterCC - total;
  const haveAvail = Math.max(availableAfterCC, 0);
  const fundedPct = total > 0 ? Math.min((haveAvail / total) * 100, 100) : 0;

  const grouped = active.reduce<Record<string, CapExItem[]>>((acc, item) => {
    (acc[item.category] ??= []).push(item);
    return acc;
  }, {});
  const categories = Object.entries(grouped)
    .map(([cat, catItems]) => ({ cat, total: catItems.reduce((s, i) => s + i.amount, 0), items: catItems }))
    .sort((a, b) => b.total - a.total);

  return (
    <Card className="flex flex-col gap-4" onHide={onHide}>
      <CardHeader>
        <CardTitle icon={<Target size={14} />}>Planned CapEx</CardTitle>
        <CardAction onClick={() => { setEditing(v => !v); setExpanded(null); }} className="inline-flex items-center gap-1">
          <Pencil size={11} /> {editing ? "Done" : "Edit"}
        </CardAction>
      </CardHeader>

      <div className="flex items-end justify-between gap-4">
        <Stat value={total} size="lg" label="Planned" tone={gap >= 0 ? "neutral" : "bad"} />
        <Stat value={haveAvail} size="sm" label="Available" align="right" />
      </div>

      <div className="flex flex-col gap-1">
        <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-[width]", gap >= 0 ? "bg-emerald-500" : "bg-red-500")}
            style={{ width: `${fundedPct}%` }}
          />
        </div>
        <div className="flex justify-between text-[11px] num">
          <span className={cn(gap >= 0 ? "text-emerald-400" : "text-red-400")}>
            {gap >= 0 ? `+${inrCompact(gap)} surplus` : `${inrCompact(gap)} short`}
          </span>
          <span className="text-zinc-500">{Math.round(fundedPct)}% funded</span>
        </div>
      </div>

      {editing ? (
        <EditList<CapExItem>
          items={items}
          getKey={x => x.id}
          addLabel="Add capex"
          emptyDraft={() => ({ name: "", amount: 0, category: "Other", target_date: null })}
          onSave={async (draft, original) => {
            if (original) await api.updateCapex(original.id, draft as any);
            else          await api.createCapex(draft as any);
            onRefetch();
          }}
          onDelete={async (it) => { await api.deleteCapex(it.id); onRefetch(); }}
          renderView={item => (
            <Row label={
              <span className="flex items-center gap-2">
                <span className={cn("h-2 w-2 rounded-full shrink-0", dotFor(item.category))} />
                <span>{item.name}</span>
                <span className="text-[10px] text-zinc-600">{item.category}</span>
                {dueChip(item.target_date)}
              </span>
            } value={inrCompact(item.amount)} />
          )}
          renderEditForm={(d, set) => (
            <>
              <Field label="Name">
                <input className={inputCls} value={d.name ?? ""} onChange={e => set({ ...d, name: e.target.value })} />
              </Field>
              <FieldGrid>
                <Field label="Amount (₹)">
                  <input className={inputCls} type="number" value={String(d.amount ?? 0)}
                         onChange={e => set({ ...d, amount: Number(e.target.value) })} />
                </Field>
                <Field label="Category">
                  <select className={inputCls} value={d.category ?? "Other"}
                          onChange={e => set({ ...d, category: e.target.value })}>
                    <option value="Home">Home</option>
                    <option value="Personal">Personal</option>
                    <option value="Dev Tools">Dev Tools</option>
                    <option value="Other">Other</option>
                  </select>
                </Field>
              </FieldGrid>
              <Field label="Target date (optional)">
                <input
                  className={inputCls}
                  type="date"
                  title="When you'd like to buy this. Items due within 30 days bubble up in the dashboard pulse."
                  value={d.target_date ?? ""}
                  onChange={e => set({ ...d, target_date: e.target.value || null })}
                />
              </Field>
              <Field label="Note (optional)">
                <input className={inputCls} value={d.note ?? ""} onChange={e => set({ ...d, note: e.target.value })} />
              </Field>
            </>
          )}
        />
      ) : (
        <div className="flex flex-col">
          {categories.map(({ cat, total: catTotal, items: catItems }) => {
            const isOpen = expanded === cat;
            return (
              <div key={cat}>
                <button
                  onClick={() => setExpanded(isOpen ? null : cat)}
                  className="w-full -mx-2 px-2 py-1.5 rounded-md flex items-center gap-3 hover:bg-zinc-800/30 transition-colors"
                >
                  <span className={cn("h-2 w-2 rounded-full shrink-0", dotFor(cat))} />
                  <span className="text-sm text-zinc-300 flex-1 text-left">
                    {cat} <span className="text-zinc-600 ml-1 text-xs num">·{catItems.length}</span>
                  </span>
                  <span className="num text-sm text-zinc-200">{inrCompact(catTotal)}</span>
                  {isOpen ? <ChevronUp size={13} className="text-zinc-600 shrink-0" />
                          : <ChevronDown size={13} className="text-zinc-600 shrink-0" />}
                </button>
                {isOpen && (
                  <div className="ml-5 mt-0.5 mb-2 pl-2 border-l border-zinc-800 flex flex-col">
                    {catItems.map(item => (
                      <div key={item.id} className="flex items-center gap-2 py-1">
                        <span className="text-sm text-zinc-300 flex-1 truncate flex items-center gap-1.5">
                          {item.name}
                          {dueChip(item.target_date)}
                        </span>
                        <button
                          onClick={async () => {
                            const spent = window.prompt(
                              `Mark "${item.name}" as purchased. How much did you actually spend?`,
                              String(item.amount),
                            );
                            if (spent == null) return;
                            const n = Number(spent);
                            if (!Number.isFinite(n) || n < 0) { alert("Bad amount"); return; }
                            try {
                              await api.purchaseCapex(item.id, { amount_spent: n });
                              onRefetch();
                            } catch (err) { alert((err as Error).message); }
                          }}
                          title="Mark as purchased — keeps it in history with the actual amount you spent"
                          className="px-2 py-0.5 rounded text-[11px] text-emerald-300 hover:bg-emerald-500/15 inline-flex items-center gap-1"
                        >
                          <ShoppingBag size={11} /> bought
                        </button>
                        <span className="num text-sm text-zinc-200 shrink-0 w-20 text-right">{inrCompact(item.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {categories.length === 0 && (
            <div className="text-center py-6 text-sm text-zinc-500">
              Nothing planned. <button onClick={() => setEditing(true)} className="text-violet-400 hover:text-violet-300">Add one</button>
            </div>
          )}

          {purchased.length > 0 && (
            <div className="mt-2 border-t border-zinc-800 pt-2">
              <button
                onClick={() => setShowPurchased(s => !s)}
                className="w-full flex items-center justify-between text-[11px] text-zinc-500 hover:text-zinc-300 px-1"
              >
                <span>Recently bought · {purchased.length}</span>
                {showPurchased ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </button>
              {showPurchased && (
                <div className="mt-1 flex flex-col">
                  {purchased.map(item => (
                    <div key={item.id} className="flex items-center gap-2 py-1 text-[12.5px]">
                      <span className="text-zinc-400 flex-1 truncate">
                        {item.name}{" "}
                        {item.purchased_at && (
                          <span className="text-zinc-600 num">· {new Date(item.purchased_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                        )}
                      </span>
                      <button
                        onClick={async () => {
                          if (!confirm(`Undo purchase of "${item.name}"? It'll move back to the planned list.`)) return;
                          try {
                            await api.unpurchaseCapex(item.id);
                            onRefetch();
                          } catch (err) { alert((err as Error).message); }
                        }}
                        title="Undo — moves back to planned"
                        className="text-[11px] text-zinc-500 hover:text-zinc-200 inline-flex items-center gap-0.5"
                      >
                        <RotateCcw size={10} /> undo
                      </button>
                      <span className="num text-zinc-300 shrink-0 w-20 text-right">{inrCompact(item.amount_spent ?? item.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/** Small chip rendered next to capex name when a target_date is set.
 *  Red for overdue, amber for ≤7d, zinc otherwise. Hidden when null. */
function dueChip(target_date?: string | null) {
  if (!target_date) return null;
  const d = new Date(target_date);
  if (Number.isNaN(d.getTime())) return null;
  const days = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
  const tone =
    days < 0  ? "text-red-300 bg-red-500/10 border-red-500/30" :
    days <= 7 ? "text-amber-300 bg-amber-500/10 border-amber-500/30" :
                "text-zinc-400 bg-zinc-800/50 border-zinc-700";
  const label =
    days < 0  ? `overdue ${-days}d` :
    days === 0 ? "today" :
                 `${days}d`;
  return (
    <span className={cn("text-[10px] px-1.5 py-0.5 rounded border num", tone)}
          title={`Target: ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`}>
      {label}
    </span>
  );
}
