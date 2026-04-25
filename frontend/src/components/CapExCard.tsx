import { useState } from "react";
import type { CapExItem } from "@/types";
import { Target, ChevronDown, ChevronUp, Pencil } from "lucide-react";
import { Card, CardHeader, CardTitle, CardAction } from "@/components/ui/Card";
import { Stat, Row } from "@/components/ui/Stat";
import { EditList, Field, FieldGrid, inputCls } from "@/components/ui/EditList";
import { inrCompact } from "@/lib/tokens";
import { cn } from "@/lib/utils";
import * as api from "@/services/api";

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

  const total = items.reduce((s, i) => s + i.amount, 0);
  const gap   = availableAfterCC - total;
  const haveAvail = Math.max(availableAfterCC, 0);
  const fundedPct = total > 0 ? Math.min((haveAvail / total) * 100, 100) : 0;

  const grouped = items.reduce<Record<string, CapExItem[]>>((acc, item) => {
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
          emptyDraft={() => ({ name: "", amount: 0, category: "Other" })}
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
                      <Row key={item.id} label={item.name} value={inrCompact(item.amount)} />
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
        </div>
      )}
    </Card>
  );
}
