import { useState } from "react";
import type { Receivable } from "@/types";
import { Receipt, Pencil } from "lucide-react";
import * as api from "@/services/api";
import { Card, CardHeader, CardTitle, CardAction } from "@/components/ui/Card";
import { Stat, Row } from "@/components/ui/Stat";
import { EditList, Field, FieldGrid, inputCls } from "@/components/ui/EditList";
import { inrCompact } from "@/lib/tokens";

interface Props {
  receivables: Receivable[];
  onRefetch: () => void;
  onHide?: () => void;
}

export function ReceivablesCard({ receivables, onRefetch, onHide }: Props) {
  const [editing, setEditing] = useState(false);

  const total = receivables.reduce((s, r) => s + r.amount, 0);

  return (
    <Card className="flex flex-col gap-3" onHide={onHide}>
      <CardHeader>
        <CardTitle icon={<Receipt size={14} />}>Receivables</CardTitle>
        <CardAction onClick={() => setEditing(v => !v)} className="inline-flex items-center gap-1">
          <Pencil size={11} /> {editing ? "Done" : "Edit"}
        </CardAction>
      </CardHeader>

      <Stat
        label={`Owed to me · ${receivables.length}`}
        value={total}
        size="lg"
        tone="good"
      />

      {editing ? (
        <EditList<Receivable>
          items={receivables}
          getKey={r => r.id}
          addLabel="Add receivable"
          emptyDraft={() => ({ name: "", source: "", amount: 0, expected_day: 1 })}
          onSave={async (draft, original) => {
            if (original) await api.updateReceivable(original.id, draft as any);
            else          await api.createReceivable(draft as any);
            onRefetch();
          }}
          onDelete={async (r) => { await api.deleteReceivable(r.id); onRefetch(); }}
          renderView={r => (
            <Row
              dot="bg-emerald-400"
              label={
                <span className="flex flex-col">
                  <span className="text-sm">{r.name}</span>
                  <span className="text-[10px] text-zinc-600">{r.source}</span>
                </span>
              }
              value={inrCompact(r.amount)}
              valueClassName="text-emerald-400"
              helper={`day ${r.expected_day}`}
            />
          )}
          renderEditForm={(d, set) => (
            <>
              <FieldGrid>
                <Field label="Name">
                  <input className={inputCls} value={d.name ?? ""} onChange={e => set({ ...d, name: e.target.value })} />
                </Field>
                <Field label="Source">
                  <input className={inputCls} value={d.source ?? ""} onChange={e => set({ ...d, source: e.target.value })} />
                </Field>
                <Field label="Amount (₹)">
                  <input className={inputCls} type="number" value={String(d.amount ?? 0)}
                         onChange={e => set({ ...d, amount: Number(e.target.value) })} />
                </Field>
                <Field label="Expected day">
                  <input className={inputCls} type="number" min={1} max={31}
                         value={String(d.expected_day ?? 1)}
                         onChange={e => set({ ...d, expected_day: Number(e.target.value) })} />
                </Field>
              </FieldGrid>
            </>
          )}
        />
      ) : receivables.length === 0 ? (
        <div className="text-center py-4 text-sm text-zinc-500">
          Nothing pending. <button onClick={() => setEditing(true)} className="text-violet-400 hover:text-violet-300">Add one</button>
        </div>
      ) : (
        <div className="flex flex-col">
          {receivables.map(r => (
            <Row key={r.id}
              dot="bg-emerald-400"
              label={
                <span className="flex flex-col">
                  <span className="text-sm">{r.name}</span>
                  <span className="text-[10px] text-zinc-600">{r.source}</span>
                </span>
              }
              value={inrCompact(r.amount)}
              valueClassName="text-emerald-400"
              helper={`day ${r.expected_day}`}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
