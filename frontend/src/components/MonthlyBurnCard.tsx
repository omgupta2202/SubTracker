import { useState } from "react";
import type { Subscription, EMI, CreditCard } from "@/types";
import { formatINR } from "@/lib/utils";
import { Flame, ChevronDown, ChevronUp, TrendingUp, TrendingDown } from "lucide-react";
import { EditableRow, IField, IGrid, iCls, ISaveCancel } from "./InlineEdit";
import * as api from "@/services/api";

interface Props {
  subscriptions: Subscription[];
  emis: EMI[];
  cards: CreditCard[];
  /** Ledger-derived total monthly burn from /api/dashboard/summary */
  monthlyBurn?: number;
  /** Month-over-month trend percentage (positive = higher burn than last month) */
  monthlyBurnTrendPct?: number | null;
  onRefetch: () => void;
}

function SubRow({ sub, onRefetch }: { sub: Subscription; onRefetch: () => void }) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(String(sub.amount));
  const [dueDay, setDueDay] = useState(String(sub.due_day));

  async function save() {
    await api.updateObligation(sub.id, { amount: Number(amount), due_day: Number(dueDay) });
    setEditing(false); onRefetch();
  }

  return (
    <EditableRow editing={editing} onStartEdit={() => setEditing(true)}
      form={
        <>
          <p className="text-xs font-semibold text-zinc-300">{sub.name}</p>
          <IGrid>
            <IField label="Amount (₹)">
              <input className={iCls} type="number" value={amount} onChange={e => setAmount(e.target.value)} />
            </IField>
            <IField label="Due Day">
              <input className={iCls} type="number" min={1} max={31} value={dueDay} onChange={e => setDueDay(e.target.value)} />
            </IField>
          </IGrid>
          <ISaveCancel onSave={save} onCancel={() => setEditing(false)} />
        </>
      }
    >
      <div className="flex items-center justify-between py-1 border-l border-zinc-700/50 pl-3 pr-8">
        <div>
          <p className="text-xs text-zinc-300">{sub.name}</p>
          <p className="text-xs text-zinc-600">{sub.billing_cycle} · {sub.category}</p>
        </div>
        <span className="font-mono text-xs text-zinc-400">{formatINR(sub.amount)}</span>
      </div>
    </EditableRow>
  );
}

function EmiRow({ emi, onRefetch }: { emi: EMI; onRefetch: () => void }) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(String(emi.amount));
  const [paid, setPaid] = useState(String(emi.paid_months));

  async function save() {
    await api.updateObligation(emi.id, { amount: Number(amount), completed_installments: Number(paid) });
    setEditing(false); onRefetch();
  }

  return (
    <EditableRow editing={editing} onStartEdit={() => setEditing(true)}
      form={
        <>
          <p className="text-xs font-semibold text-zinc-300">{emi.name} · {emi.lender}</p>
          <IGrid>
            <IField label="Monthly EMI (₹)">
              <input className={iCls} type="number" value={amount} onChange={e => setAmount(e.target.value)} />
            </IField>
            <IField label="Months Paid">
              <input className={iCls} type="number" value={paid} onChange={e => setPaid(e.target.value)} />
            </IField>
          </IGrid>
          <ISaveCancel onSave={save} onCancel={() => setEditing(false)} />
        </>
      }
    >
      <div className="flex items-center justify-between py-1 border-l border-zinc-700/50 pl-3 pr-8">
        <div>
          <p className="text-xs text-zinc-300">{emi.name}</p>
          <p className="text-xs text-zinc-600">{emi.lender} · {emi.paid_months}/{emi.total_months} mo</p>
        </div>
        <span className="font-mono text-xs text-zinc-400">{formatINR(emi.amount)}</span>
      </div>
    </EditableRow>
  );
}

export function MonthlyBurnCard({ subscriptions, emis, cards, monthlyBurn, monthlyBurnTrendPct, onRefetch }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  // Use ledger-derived total if available, fall back to computed
  const subTotal  = subscriptions.reduce((s, x) => s + x.amount, 0);
  const emiTotal  = emis.reduce((s, x) => s + x.amount, 0);
  const cardTotal = cards.reduce((s, x) => s + x.minimum_due, 0);
  const localTotal = subTotal + emiTotal + cardTotal;
  const total = monthlyBurn ?? localTotal;

  // For bar proportions use local breakdown (ledger total may differ from obligation total)
  const barBase = Math.max(localTotal, 1);

  const sections = [
    { label: "Subscriptions", amount: subTotal, bar: "bg-violet-500", count: subscriptions.length },
    { label: "EMIs",          amount: emiTotal, bar: "bg-blue-500",   count: emis.length },
    { label: "Card Min Dues", amount: cardTotal, bar: "bg-emerald-500", count: cards.length },
  ];

  const isLedgerDerived = monthlyBurn !== undefined;

  return (
    <div className="bg-zinc-900 p-6 flex flex-col gap-4 backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-zinc-400 text-sm font-medium">
          <Flame size={16} className="text-violet-400" />
          Monthly Burn
        </div>
        {monthlyBurnTrendPct !== null && monthlyBurnTrendPct !== undefined && (
          <span className={`flex items-center gap-0.5 text-xs font-mono font-medium ${monthlyBurnTrendPct > 0 ? "text-red-400" : "text-emerald-400"}`}>
            {monthlyBurnTrendPct > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {monthlyBurnTrendPct > 0 ? "+" : ""}{monthlyBurnTrendPct}% vs last month
          </span>
        )}
      </div>
      <div className="font-mono text-4xl font-bold text-white tracking-tight">{formatINR(total)}</div>
      <div className="flex h-2 rounded-full overflow-hidden gap-0.5">
        {sections.map(s => (
          <div key={s.label} className={`${s.bar} transition-all`} style={{ width: localTotal > 0 ? `${(s.amount / barBase) * 100}%` : "0%" }} />
        ))}
      </div>
      <div className="flex flex-col gap-1">
        {sections.map(s => (
          <div key={s.label}>
            <button onClick={() => setExpanded(expanded === s.label ? null : s.label)} className="w-full flex items-center justify-between py-1.5 group">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${s.bar}`} />
                <span className="text-sm text-zinc-400 group-hover:text-zinc-200 transition-colors">
                  {s.label} <span className="text-zinc-600 text-xs">({s.count})</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-zinc-200">{formatINR(s.amount)}</span>
                {s.count > 0 && (expanded === s.label ? <ChevronUp size={13} className="text-zinc-500" /> : <ChevronDown size={13} className="text-zinc-500" />)}
              </div>
            </button>
            {expanded === s.label && (
              <div className="ml-4 flex flex-col gap-0.5 pb-1">
                {s.label === "Subscriptions" && subscriptions.map(sub => <SubRow key={sub.id} sub={sub} onRefetch={onRefetch} />)}
                {s.label === "EMIs"          && emis.map(emi => <EmiRow key={emi.id} emi={emi} onRefetch={onRefetch} />)}
                {s.label === "Card Min Dues" && cards.map(c => (
                  <div key={c.id} className="flex items-center justify-between py-1 border-l border-zinc-700/50 pl-3">
                    <p className="text-xs text-zinc-300">{c.last4 ? `${c.name} ···· ${c.last4}` : c.name}</p>
                    <span className="font-mono text-xs text-zinc-400">{formatINR(c.minimum_due)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {isLedgerDerived && Math.abs(total - localTotal) > 1 && (
        <p className="text-xs text-zinc-600 italic">
          Ledger total ({formatINR(total)}) differs from obligation total ({formatINR(localTotal)}) — ledger includes all posted debits.
        </p>
      )}
    </div>
  );
}
