import { useState } from "react";
import type { BankAccount, CreditCard } from "@/types";
import { formatINR } from "@/lib/utils";
import { Wallet, ChevronDown, ChevronUp, CreditCard as CardIcon } from "lucide-react";
import { EditableRow, IField, IGrid, iCls, ISaveCancel } from "./InlineEdit";
import * as api from "@/services/api";

interface Props {
  accounts: BankAccount[];
  cards: CreditCard[];
  rent?: number;
  onRefetch: () => void;
  onManageAccounts?: () => void;
}

const BANK_COLOR: Record<string, string> = {
  HDFC: "bg-blue-500", Axis: "bg-purple-500", SBI: "bg-orange-500", Cash: "bg-emerald-500",
};
const bankColor = (b: string) => BANK_COLOR[b] ?? "bg-zinc-500";

function AccountRow({ account, onRefetch }: { account: BankAccount; onRefetch: () => void }) {
  const [editing, setEditing] = useState(false);
  const [balance, setBalance] = useState(String(account.balance));
  const [name, setName] = useState(account.name);

  async function save() {
    await api.updateAccount(account.id, { name, balance: Number(balance) });
    setEditing(false);
    onRefetch();
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
            <IField label="Balance (₹)">
              <input className={iCls} type="number" value={balance} onChange={e => setBalance(e.target.value)} />
            </IField>
          </IGrid>
          <ISaveCancel onSave={save} onCancel={() => setEditing(false)} />
        </>
      }
    >
      <div className="flex items-center gap-3 py-0.5 pr-8">
        <span className={`w-2 h-2 rounded-full shrink-0 ${bankColor(account.bank)}`} />
        <span className="text-sm text-zinc-400 flex-1 truncate">{account.name}</span>
        <span className="font-mono text-sm text-zinc-200 shrink-0">{formatINR(account.balance)}</span>
      </div>
    </EditableRow>
  );
}

function CardRow({ card, onRefetch }: { card: CreditCard; onRefetch: () => void }) {
  const [editing, setEditing] = useState(false);
  const [outstanding, setOutstanding] = useState(String(card.outstanding));
  const [minDue, setMinDue] = useState(String(card.minimum_due));

  async function save() {
    await api.updateCard(card.id, { outstanding: Number(outstanding), minimum_due: Number(minDue) });
    setEditing(false);
    onRefetch();
  }

  return (
    <EditableRow
      editing={editing}
      onStartEdit={() => setEditing(true)}
      form={
        <>
          <p className="text-xs font-semibold text-zinc-300">{card.name}{card.last4 ? ` ···· ${card.last4}` : ""}</p>
          <IGrid>
            <IField label="Outstanding (₹)">
              <input className={iCls} type="number" value={outstanding} onChange={e => setOutstanding(e.target.value)} />
            </IField>
            <IField label="Minimum Due (₹)">
              <input className={iCls} type="number" value={minDue} onChange={e => setMinDue(e.target.value)} />
            </IField>
          </IGrid>
          <ISaveCancel onSave={save} onCancel={() => setEditing(false)} />
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
              {card.due_date_offset === 0 ? " · due today" : card.due_date_offset <= 7 ? ` · ${card.due_date_offset}d left` : ""}
            </p>
          </div>
        </div>
        <div className="h-1.5 rounded-full bg-zinc-700 overflow-hidden">
          <div className="h-full rounded-full bg-red-500/70" style={{ width: card.outstanding > 0 ? `${Math.min((card.minimum_due / card.outstanding) * 100, 100)}%` : "0%" }} />
        </div>
        <p className="text-xs text-zinc-600 mt-1">Min due {formatINR(card.minimum_due)} · {card.bank}</p>
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
    <div className="bg-zinc-900 p-6 flex flex-col gap-4 backdrop-blur-sm">
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
        <div className="flex flex-col gap-2">
          {cards.map(c => <CardRow key={c.id} card={c} onRefetch={onRefetch} />)}
        </div>
      )}
    </div>
  );
}
