import { useState } from "react";
import { formatINR } from "@/lib/utils";
import { Wallet, ChevronDown, ChevronUp, CreditCard as CardIcon } from "lucide-react";
import { EditableRow, IField, IGrid, iCls, ISaveCancel } from "./InlineEdit";
import * as api from "@/services/api";

interface LiquidAccount {
  id: string;
  name: string;
  balance: number;
  bank?: string;
}

interface CreditCardSnapshot {
  id: string;
  name: string;
  bank?: string;
  last4?: string | null;
  outstanding: number;
  minimum_due: number;
  due_date_offset?: number;
  due_day?: number | null;
}

interface Props {
  accounts: LiquidAccount[];
  cards: CreditCardSnapshot[];
  rent?: number;
  onRefetch: () => void;
  onManageAccounts?: () => void;
}

const BANK_COLOR: Record<string, string> = {
  HDFC: "bg-blue-500", Axis: "bg-purple-500", SBI: "bg-orange-500", Cash: "bg-emerald-500",
};
const bankColor = (b: string) => BANK_COLOR[b] ?? "bg-zinc-500";

function AccountRow({ account, onRefetch }: { account: LiquidAccount; onRefetch: () => void }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(account.name);
  const [bank, setBank] = useState(account.bank ?? "");
  const [balance, setBalance] = useState(String(account.balance));

  async function save() {
    setSaving(true);
    try {
      await api.updateFinancialAccount(account.id, { name, institution: bank, balance: Number(balance) });
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
            <IField label="Account Name">
              <input className={iCls} value={name} onChange={e => setName(e.target.value)} />
            </IField>
            <IField label="Bank">
              <input className={iCls} value={bank} onChange={e => setBank(e.target.value)} />
            </IField>
          </IGrid>
          <IField label="Balance (₹)">
            <input className={iCls} type="number" value={balance} onChange={e => setBalance(e.target.value)} />
          </IField>
          <ISaveCancel saving={saving} onSave={save} onCancel={() => setEditing(false)} />
        </>
      }
    >
      <div className="flex items-center gap-3 py-0.5 pr-8">
        <span className={`w-2 h-2 rounded-full shrink-0 ${bankColor(account.bank ?? "Bank")}`} />
        <span className="text-sm text-zinc-400 flex-1 truncate">{account.name}</span>
        <span className="font-mono text-sm text-zinc-200 shrink-0">{formatINR(account.balance)}</span>
      </div>
    </EditableRow>
  );
}

function CardRow({ card, onRefetch }: { card: CreditCardSnapshot; onRefetch: () => void }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(card.name);
  const [bank, setBank] = useState(card.bank ?? "");
  const [last4, setLast4] = useState(card.last4 ?? "");
  const [outstanding, setOutstanding] = useState(String(card.outstanding));
  const [minimumDue, setMinimumDue] = useState(String(card.minimum_due));
  const [dueDay, setDueDay] = useState(card.due_day ? String(card.due_day) : "");
  const [dueOffsetInput, setDueOffsetInput] = useState(card.due_date_offset ? String(card.due_date_offset) : "");
  const dueOffsetDays = card.due_date_offset ?? 999;

  async function save() {
    setSaving(true);
    try {
      await api.updateFinancialAccount(card.id, {
        name,
        institution: bank,
        last4,
        billing_cycle_day: dueDay ? Number(dueDay) : undefined,
        due_offset_days: dueOffsetInput ? Number(dueOffsetInput) : undefined,
      });

      const cycleAmount = Number(outstanding || 0);
      const minDueAmount = Number(minimumDue || 0);
      const overview = await api.getBillingCycleOverview(card.id);
      if (overview.current_cycle) {
        await api.updateBillingCycle(overview.current_cycle.id, {
          total_billed: cycleAmount,
          minimum_due: minDueAmount,
        });
      } else if (cycleAmount !== 0 || minDueAmount !== 0) {
        await api.createBillingCycleForCard(card.id, {
          statement_period: "current",
          total_billed: cycleAmount,
          minimum_due: minDueAmount,
        });
      }

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
            <IField label="Card Name">
              <input className={iCls} value={name} onChange={e => setName(e.target.value)} />
            </IField>
            <IField label="Bank">
              <input className={iCls} value={bank} onChange={e => setBank(e.target.value)} />
            </IField>
          </IGrid>
          <IGrid>
            <IField label="Last 4">
              <input className={iCls} value={last4} onChange={e => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} maxLength={4} inputMode="numeric" />
            </IField>
            <IField label="Statement Day">
              <input className={iCls} type="number" min={1} max={31} value={dueDay} onChange={e => setDueDay(e.target.value)} />
            </IField>
          </IGrid>
          <IGrid>
            <IField label="Outstanding (₹)">
              <input className={iCls} type="number" value={outstanding} onChange={e => setOutstanding(e.target.value)} />
            </IField>
            <IField label="Minimum Due (₹)">
              <input className={iCls} type="number" value={minimumDue} onChange={e => setMinimumDue(e.target.value)} />
            </IField>
          </IGrid>
          <IField label="Due Offset (days)">
            <input className={iCls} type="number" min={0} max={60} value={dueOffsetInput} onChange={e => setDueOffsetInput(e.target.value)} />
          </IField>
          <ISaveCancel saving={saving} onSave={save} onCancel={() => setEditing(false)} />
        </>
      }
    >
      <div className="rounded-xl bg-zinc-800/50 border border-zinc-700/50 px-4 py-3">
        <div className="flex items-center justify-between mb-2 pr-6">
          <div>
            <span className="text-sm font-medium text-zinc-200">{card.name}</span>
            {card.last4 && <span className="text-xs text-zinc-500 ml-2 font-mono">···· {card.last4}</span>}
          </div>
          <div className="text-right">
            <p className="font-mono text-sm font-semibold text-red-400">{formatINR(card.outstanding)}</p>
            <p className="text-xs text-zinc-500">
              {card.due_day ? `bill day ${card.due_day}` : ""}
              {dueOffsetDays === 0 ? " · due today" : dueOffsetDays <= 7 ? ` · ${dueOffsetDays}d left` : ""}
            </p>
          </div>
        </div>
        <div className="h-1.5 rounded-full bg-zinc-700 overflow-hidden">
          <div className="h-full rounded-full bg-red-500/70" style={{ width: card.outstanding > 0 ? `${Math.min((card.minimum_due / card.outstanding) * 100, 100)}%` : "0%" }} />
        </div>
        <p className="text-xs text-zinc-600 mt-1">Min due {formatINR(card.minimum_due)}{card.bank ? ` · ${card.bank}` : ""}</p>
      </div>
    </EditableRow>
  );
}

export function NetWorthCard({ accounts, cards, rent = 0, onRefetch, onManageAccounts }: Props) {
  const [showCards, setShowCards] = useState(false);
  const totalLiquid = accounts.reduce((s, a) => s + a.balance, 0);
  const totalCC     = cards.reduce((s, c) => s + c.outstanding, 0);
  const netAfterCC  = totalLiquid - totalCC - rent;

  return (
    <div className="relative overflow-x-hidden overflow-y-auto min-h-0 bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 p-6 flex flex-col gap-4 backdrop-blur-sm border border-zinc-700/60">
      <div className="absolute -top-20 -right-16 w-56 h-56 rounded-full bg-violet-500/10 blur-3xl pointer-events-none" />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-zinc-400 text-sm font-medium">
          <Wallet size={16} className="text-violet-400" />
          Liquidity Snapshot
        </div>
        {onManageAccounts && (
          <button
            onClick={onManageAccounts}
            className="text-xs text-violet-400 hover:text-violet-300 font-medium transition-colors"
          >
            Manage
          </button>
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-zinc-500">Net after CC + rent</span>
        <span className={`font-mono text-3xl font-bold tracking-tight ${netAfterCC >= 0 ? "text-emerald-400" : "text-red-400"}`}>
          {formatINR(netAfterCC)}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {accounts.map(a => <AccountRow key={a.id} account={a} onRefetch={onRefetch} />)}
        <div className="h-px bg-zinc-800 my-1" />
        <div className="flex items-center gap-3">
          <span className="w-2 h-2 rounded-full shrink-0 bg-zinc-600" />
          <span className="text-sm text-zinc-400 flex-1">Total Liquid</span>
          <span className="font-mono text-sm font-semibold text-zinc-100">{formatINR(totalLiquid)}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-2 h-2 rounded-full shrink-0 bg-red-500" />
          <span className="text-sm text-red-400/80 flex-1 truncate">CC Bills</span>
          <span className="font-mono text-sm text-red-400 shrink-0">− {formatINR(totalCC)}</span>
        </div>
        {rent > 0 && (
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full shrink-0 bg-red-400/50" />
            <span className="text-sm text-red-400/60 flex-1 truncate">Rent</span>
            <span className="font-mono text-sm text-red-400/70 shrink-0">− {formatINR(rent)}</span>
          </div>
        )}
      </div>
      <button onClick={() => setShowCards(v => !v)} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
        <CardIcon size={12} />
        {cards.length} credit card{cards.length !== 1 ? "s" : ""}
        {showCards ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {showCards && (
        <div className="flex flex-col gap-2 pt-1">
          {cards.map(c => <CardRow key={c.id} card={c} onRefetch={onRefetch} />)}
        </div>
      )}
    </div>
  );
}
