import { useState } from "react";
import type { EMI } from "@/types";
import { formatINR } from "@/lib/utils";
import { TrendingDown } from "lucide-react";
import { EditableRow, IField, IGrid, iCls, ISaveCancel } from "./InlineEdit";
import * as api from "@/services/api";

interface Props {
  emis: EMI[];
  onRefetch: () => void;
}

function EmiRow({ emi, onRefetch }: { emi: EMI; onRefetch: () => void }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(emi.name);
  const [lender, setLender] = useState(emi.lender);
  const [amount, setAmount] = useState(String(emi.amount));
  const [paid, setPaid] = useState(String(emi.paid_months));
  const [total, setTotal] = useState(String(emi.total_months));
  const [dueDay, setDueDay] = useState(String(emi.due_day));

  const pct = Math.round((emi.paid_months / emi.total_months) * 100);
  const remaining = emi.total_months - emi.paid_months;

  async function save() {
    setSaving(true);
    try {
      await api.updateObligation(emi.id, {
        name,
        lender,
        amount: Number(amount),
        completed_installments: Number(paid),
        total_installments: Number(total),
        due_day: Number(dueDay),
      });
      setEditing(false);
      onRefetch();
    } finally {
      setSaving(false);
    }
  }

  return (
    <EditableRow
      editing={editing}
      onStartEdit={() => setEditing(true)}
      form={
        <>
          <IGrid>
            <IField label="EMI Name">
              <input className={iCls} value={name} onChange={e => setName(e.target.value)} />
            </IField>
            <IField label="Lender">
              <input className={iCls} value={lender} onChange={e => setLender(e.target.value)} />
            </IField>
          </IGrid>
          <IGrid>
            <IField label="Monthly EMI (₹)">
              <input className={iCls} type="number" value={amount} onChange={e => setAmount(e.target.value)} />
            </IField>
            <IField label="Due Day">
              <input className={iCls} type="number" min={1} max={31} value={dueDay} onChange={e => setDueDay(e.target.value)} />
            </IField>
          </IGrid>
          <IGrid>
            <IField label="Months Paid">
              <input className={iCls} type="number" value={paid} onChange={e => setPaid(e.target.value)} />
            </IField>
            <IField label="Total Months">
              <input className={iCls} type="number" value={total} onChange={e => setTotal(e.target.value)} />
            </IField>
          </IGrid>
          <ISaveCancel saving={saving} onSave={save} onCancel={() => setEditing(false)} />
        </>
      }
    >
      <div className="flex flex-col gap-2 pr-8">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-medium text-zinc-200">{emi.name}</span>
            <span className="text-xs text-zinc-500 ml-2">{emi.lender}</span>
          </div>
          <span className="font-mono text-sm text-zinc-300">{formatINR(emi.amount)}/mo</span>
        </div>
        <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-violet-600 to-violet-400 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>{emi.paid_months} of {emi.total_months} months paid</span>
          <span className="text-violet-400 font-mono">{pct}% · {remaining} left</span>
        </div>
      </div>
    </EditableRow>
  );
}

export function EmiProgressCard({ emis, onRefetch }: Props) {
  return (
    <div className="bg-zinc-900 p-6 flex flex-col gap-4 backdrop-blur-sm">
      <div className="flex items-center gap-2 text-zinc-400 text-sm font-medium">
        <TrendingDown size={16} className="text-violet-400" />
        EMI Progress
      </div>
      {emis.length === 0 ? (
        <p className="text-zinc-500 text-sm py-4 text-center">No EMIs added yet</p>
      ) : (
        <div className="flex flex-col gap-5">
          {emis.map(emi => <EmiRow key={emi.id} emi={emi} onRefetch={onRefetch} />)}
        </div>
      )}
    </div>
  );
}
