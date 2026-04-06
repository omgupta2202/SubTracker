import { useState } from "react";
import type { CapExItem } from "@/types";
import { formatINR } from "@/lib/utils";
import { Target, ChevronDown, ChevronUp } from "lucide-react";
import { EditableRow, IField, IGrid, iCls, iSelCls, ISaveCancel } from "./InlineEdit";
import * as api from "@/services/api";

interface Props {
  items: CapExItem[];
  availableAfterCC: number;
  onRefetch: () => void;
}

const CATEGORY_COLOR: Record<string, { bar: string; badge: string }> = {
  Home:        { bar: "bg-blue-500",   badge: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
  Personal:    { bar: "bg-violet-500", badge: "bg-violet-500/20 text-violet-300 border-violet-500/30" },
  "Dev Tools": { bar: "bg-amber-500",  badge: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
  Other:       { bar: "bg-zinc-500",   badge: "bg-zinc-500/20 text-zinc-300 border-zinc-500/30" },
};
const colors = (cat: string) => CATEGORY_COLOR[cat] ?? CATEGORY_COLOR["Other"];

function CapExRow({ item, onRefetch }: { item: CapExItem; onRefetch: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [amount, setAmount] = useState(String(item.amount));
  const [category, setCategory] = useState(item.category);

  async function save() {
    await api.updateCapex(item.id, { name, amount: Number(amount), category });
    setEditing(false); onRefetch();
  }

  return (
    <EditableRow editing={editing} onStartEdit={() => setEditing(true)}
      form={
        <>
          <IField label="Name">
            <input className={iCls} value={name} onChange={e => setName(e.target.value)} />
          </IField>
          <IGrid>
            <IField label="Amount (₹)">
              <input className={iCls} type="number" value={amount} onChange={e => setAmount(e.target.value)} />
            </IField>
            <IField label="Category">
              <select className={iSelCls} value={category} onChange={e => setCategory(e.target.value)}>
                <option value="Home">Home</option>
                <option value="Personal">Personal</option>
                <option value="Dev Tools">Dev Tools</option>
                <option value="Other">Other</option>
              </select>
            </IField>
          </IGrid>
          <ISaveCancel onSave={save} onCancel={() => setEditing(false)} />
        </>
      }
    >
      <div className="flex items-center justify-between py-1 border-l border-zinc-700/50 pl-3 pr-8">
        <span className="text-xs text-zinc-300">{item.name}</span>
        <span className="font-mono text-xs text-zinc-400">{formatINR(item.amount)}</span>
      </div>
    </EditableRow>
  );
}

export function CapExCard({ items, availableAfterCC, onRefetch }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const total = items.reduce((s, i) => s + i.amount, 0);
  const gap   = availableAfterCC - total;

  const grouped = items.reduce<Record<string, CapExItem[]>>((acc, item) => {
    (acc[item.category] ??= []).push(item);
    return acc;
  }, {});

  const categories = Object.entries(grouped)
    .map(([cat, catItems]) => ({ cat, total: catItems.reduce((s, i) => s + i.amount, 0), items: catItems }))
    .sort((a, b) => b.total - a.total);

  return (
    <div className="bg-zinc-900 p-6 flex flex-col gap-4 backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-zinc-400 text-sm font-medium">
          <Target size={16} className="text-violet-400" />
          Planned CapEx
        </div>
        <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded-full border ${gap >= 0 ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"}`}>
          {gap >= 0 ? `+${formatINR(gap)} surplus` : `${formatINR(gap)} short`}
        </span>
      </div>
      <div>
        <div className="flex justify-between items-baseline mb-2">
          <span className="font-mono text-2xl font-bold text-white">{formatINR(total)}</span>
          <span className="text-xs text-zinc-500">have {formatINR(Math.max(availableAfterCC, 0))}</span>
        </div>
        <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
          <div className={`h-full rounded-full transition-all ${gap >= 0 ? "bg-emerald-500" : "bg-red-500"}`}
            style={{ width: total > 0 ? `${Math.min((availableAfterCC / total) * 100, 100)}%` : "0%" }} />
        </div>
        <p className="text-xs text-zinc-600 mt-1">
          {total > 0 ? `${Math.round(Math.min((availableAfterCC / total) * 100, 100))}% funded from current liquidity` : "No planned CapEx"}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        {categories.map(({ cat, total: catTotal, items: catItems }) => {
          const c = colors(cat);
          const pct = total > 0 ? (catTotal / total) * 100 : 0;
          return (
            <div key={cat}>
              <button onClick={() => setExpanded(expanded === cat ? null : cat)} className="w-full flex items-center gap-3 py-1.5 group">
                <div className="w-16 h-1.5 rounded-full bg-zinc-800 overflow-hidden shrink-0">
                  <div className={`h-full rounded-full ${c.bar}`} style={{ width: `${pct}%` }} />
                </div>
                <span className={`text-xs px-1.5 py-0.5 rounded border shrink-0 ${c.badge}`}>{cat}</span>
                <span className="text-xs text-zinc-500 flex-1 text-left">{catItems.length} item{catItems.length !== 1 ? "s" : ""}</span>
                <span className="font-mono text-sm text-zinc-200">{formatINR(catTotal)}</span>
                {expanded === cat ? <ChevronUp size={13} className="text-zinc-500 shrink-0" /> : <ChevronDown size={13} className="text-zinc-500 shrink-0" />}
              </button>
              {expanded === cat && (
                <div className="ml-4 flex flex-col gap-0.5 pb-1">
                  {catItems.map(item => <CapExRow key={item.id} item={item} onRefetch={onRefetch} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
