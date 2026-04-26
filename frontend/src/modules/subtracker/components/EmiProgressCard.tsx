import { useState } from "react";
import type { EMI } from "@/modules/subtracker/types";
import { TrendingDown, ChevronDown, ChevronUp, Pencil } from "lucide-react";
import * as api from "@/modules/subtracker/services/api";
import { Card, CardHeader, CardTitle, CardAction } from "@/components/ui/Card";
import { EditList, Field, FieldGrid, inputCls } from "@/components/ui/EditList";
import { inrCompact } from "@/lib/tokens";

interface Props {
  emis: EMI[];
  onRefetch: () => void;
  onHide?: () => void;
}

function EmiViewRow({ emi, onRefetch }: { emi: EMI; onRefetch: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [paid, setPaid] = useState(emi.paid_months);

  const total = Math.max(0, emi.total_months || 0);
  const paidClamped = Math.max(0, Math.min(paid, total));
  const pct = total > 0 ? (paidClamped / total) * 100 : 0;
  const remaining = Math.max(0, total - paidClamped);
  const m = emi.emi_math;

  async function bumpPaid(delta: number, e: React.MouseEvent) {
    e.stopPropagation();
    const next = Math.max(0, Math.min(total, paidClamped + delta));
    if (next === paidClamped) return;
    setSaving(true);
    setPaid(next);
    try {
      await api.updateObligation(emi.id, { completed_installments: next });
      onRefetch();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 py-2 -mx-2 px-2 rounded-lg hover:bg-zinc-800/30 transition-colors">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-zinc-200 truncate">{emi.name}</span>
            <span className="text-[11px] text-zinc-600 truncate">{emi.lender}</span>
          </div>
        </div>
        <span className="num text-sm text-zinc-200 shrink-0">{inrCompact(emi.amount)}/mo</span>
      </div>

      <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div className="h-full rounded-full bg-gradient-to-r from-violet-600 to-violet-400 transition-[width]"
             style={{ width: `${pct}%` }} />
      </div>

      <div className="flex items-center justify-between text-[11px]">
        <button
          onClick={() => setExpanded(v => !v)}
          className="text-zinc-500 hover:text-zinc-300 inline-flex items-center gap-1"
        >
          <span className="num">{paidClamped}</span> of <span className="num">{total}</span> paid · {remaining} left
          {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>
        <div className="flex items-center gap-1.5">
          <button onClick={(e) => bumpPaid(-1, e)} disabled={saving || paidClamped <= 0}
                  className="px-1.5 py-0.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed text-xs num">−1</button>
          <button onClick={(e) => bumpPaid(+1, e)} disabled={saving || paidClamped >= total}
                  className="px-1.5 py-0.5 rounded text-violet-400 hover:bg-violet-500/10 disabled:opacity-30 disabled:cursor-not-allowed text-xs num">+1</button>
          <span className="text-violet-300 num font-medium tabular-nums w-9 text-right">{Math.round(pct)}%</span>
        </div>
      </div>

      {expanded && m && m.outstanding_principal > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-zinc-500 pt-1 pl-1 border-l border-zinc-800/80 ml-1">
          <div className="flex justify-between">
            <span>Outstanding</span><span className="num text-zinc-200">{inrCompact(m.outstanding_principal)}</span>
          </div>
          <div className="flex justify-between">
            <span>Interest paid</span><span className="num text-zinc-300">{inrCompact(m.interest_paid_to_date)}</span>
          </div>
          <div className="flex justify-between">
            <span>Principal paid</span><span className="num text-zinc-300">{inrCompact(m.principal_paid_to_date)}</span>
          </div>
          <div className="flex justify-between">
            <span>Foreclose &amp; save</span><span className="num text-emerald-400">{inrCompact(m.foreclosure_savings)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function EmiProgressCard({ emis, onRefetch, onHide }: Props) {
  const [editing, setEditing] = useState(false);

  return (
    <Card className="flex flex-col gap-2" onHide={onHide}>
      <CardHeader>
        <CardTitle icon={<TrendingDown size={14} />}>EMI progress</CardTitle>
        <CardAction onClick={() => setEditing(v => !v)} className="inline-flex items-center gap-1">
          <Pencil size={11} /> {editing ? "Done" : "Edit"}
        </CardAction>
      </CardHeader>

      {editing ? (
        <EditList<EMI>
          items={emis}
          getKey={x => x.id}
          addLabel="Add EMI"
          emptyDraft={() => ({ name: "", lender: "", amount: 0, total_months: 12, paid_months: 0, due_day: 1 })}
          onSave={async (draft, original) => {
            if (original) {
              await api.updateObligation(original.id, {
                name: draft.name, lender: draft.lender as any, amount: Number(draft.amount),
                total_installments: Number(draft.total_months),
                completed_installments: Number(draft.paid_months),
                due_day: Number(draft.due_day),
              } as any);
            } else {
              await api.createObligation({
                type: "emi", name: draft.name, lender: draft.lender,
                amount: Number(draft.amount),
                total_installments: Number(draft.total_months),
                completed_installments: Number(draft.paid_months ?? 0),
                due_day: Number(draft.due_day),
              } as any);
            }
            onRefetch();
          }}
          onDelete={async (emi) => { await api.deleteObligation(emi.id); onRefetch(); }}
          renderView={emi => (
            <div className="flex items-center gap-3 py-1.5">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-zinc-200 truncate">{emi.name}</div>
                <div className="text-[10px] text-zinc-600 num">
                  {emi.lender} · {emi.paid_months}/{emi.total_months}
                </div>
              </div>
              <span className="num text-sm text-zinc-100 shrink-0">{inrCompact(emi.amount)}/mo</span>
            </div>
          )}
          renderEditForm={(d, set) => (
            <>
              <FieldGrid>
                <Field label="Name">
                  <input className={inputCls} value={d.name ?? ""} onChange={e => set({ ...d, name: e.target.value })} />
                </Field>
                <Field label="Lender">
                  <input className={inputCls} value={d.lender ?? ""} onChange={e => set({ ...d, lender: e.target.value })} />
                </Field>
                <Field label="Monthly EMI (₹)">
                  <input className={inputCls} type="number" value={String(d.amount ?? 0)}
                         onChange={e => set({ ...d, amount: Number(e.target.value) })} />
                </Field>
                <Field label="Due day">
                  <input className={inputCls} type="number" min={1} max={31}
                         value={String(d.due_day ?? 1)} onChange={e => set({ ...d, due_day: Number(e.target.value) })} />
                </Field>
                <Field label="Months paid">
                  <input className={inputCls} type="number" value={String(d.paid_months ?? 0)}
                         onChange={e => set({ ...d, paid_months: Number(e.target.value) })} />
                </Field>
                <Field label="Total months">
                  <input className={inputCls} type="number" value={String(d.total_months ?? 12)}
                         onChange={e => set({ ...d, total_months: Number(e.target.value) })} />
                </Field>
              </FieldGrid>
            </>
          )}
        />
      ) : emis.length === 0 ? (
        <div className="text-center py-8 text-sm text-zinc-500">
          No EMIs tracked. <button onClick={() => setEditing(true)} className="text-violet-400 hover:text-violet-300">Add one</button>
        </div>
      ) : (
        <div className="flex flex-col">
          {emis.map(emi => <EmiViewRow key={emi.id} emi={emi} onRefetch={onRefetch} />)}
        </div>
      )}
    </Card>
  );
}
