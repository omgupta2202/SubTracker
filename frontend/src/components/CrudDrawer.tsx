import { useState, useEffect } from "react";
import { X, Plus, Pencil, Trash2, Landmark, CreditCard as CardIcon, TrendingDown, ArrowDownToLine, Target, Home, Receipt, List, Mail, RefreshCw, CheckCircle2, Loader2 } from "lucide-react";
import { getGmailStatus, getConnectUrl, syncGmail, disconnectGmail } from "@/modules/gmail";
import type { GmailStatus, SyncResult } from "@/modules/gmail";
import * as api from "@/services/api";
import type { Subscription, EMI, CreditCard, BankAccount, Receivable, CapExItem, Rent } from "@/types";
import { formatINR } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { CardTransactionPanel } from "./CardTransactionPanel";

type Tab = "accounts" | "cards" | "receivables" | "capex" | "rent" | "subscriptions" | "emis" | "profile";

interface User { id: string; email: string; name: string | null; avatar_url: string | null }

interface Props {
  open: boolean;
  onClose: () => void;
  subscriptions: Subscription[];
  emis: EMI[];
  cards: CreditCard[];
  accounts: BankAccount[];
  receivables: Receivable[];
  capex: CapExItem[];
  rent: Rent;
  onRefetch: () => void;
  initialTab?: Tab;
  user: User | null;
  onUserUpdate: (u: User) => void;
  onLogout: () => void;
}

// ── primitives ─────────────────────────────────────────────────────────────

const inputCls =
  "bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-100 " +
  "focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 transition-all w-full placeholder:text-zinc-600";

const selectCls =
  "bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-100 " +
  "focus:outline-none focus:border-violet-500 transition-all w-full";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">{label}</label>
        {hint && <span className="text-xs text-zinc-600">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function FormGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-4">{children}</div>;
}

function FormSection({ title, hint, children }: { title?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        {title && <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">{title}</p>}
        {hint && <span className="text-xs text-zinc-600 font-normal">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function SaveCancel({ onSave, onCancel, saveLabel = "Save" }: { onSave: () => void; onCancel?: () => void; saveLabel?: string }) {
  return (
    <div className="flex gap-3 pt-2">
      <button
        onClick={onSave}
        className="flex-1 bg-violet-600 hover:bg-violet-500 active:bg-violet-700 text-white rounded-xl py-3 text-sm font-semibold transition-colors"
      >
        {saveLabel}
      </button>
      {onCancel && (
        <button
          onClick={onCancel}
          className="px-6 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl py-3 text-sm font-medium transition-colors"
        >
          Cancel
        </button>
      )}
    </div>
  );
}

// ── Forms ──────────────────────────────────────────────────────────────────

function SubForm({ initial, onSave, onCancel }: { initial?: Subscription; onSave: (d: Omit<Subscription, "id">) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [amount, setAmount] = useState(String(initial?.amount ?? ""));
  const [cycle, setCycle] = useState<Subscription["billing_cycle"]>(initial?.billing_cycle ?? "monthly");
  const [dueDay, setDueDay] = useState(String(initial?.due_day ?? "1"));
  const [category, setCategory] = useState(initial?.category ?? "Other");
  return (
    <div className="flex flex-col gap-5">
      <FormSection>
        <Field label="Service Name">
          <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Netflix, Spotify" />
        </Field>
        <FormGrid>
          <Field label="Amount" hint="₹ / period">
            <input className={inputCls} type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="649" />
          </Field>
          <Field label="Billing Cycle">
            <select className={selectCls} value={cycle} onChange={e => setCycle(e.target.value as Subscription["billing_cycle"])}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              <option value="weekly">Weekly</option>
            </select>
          </Field>
        </FormGrid>
        <FormGrid>
          <Field label="Due Day" hint="1 – 31">
            <input className={inputCls} type="number" min={1} max={31} value={dueDay} onChange={e => setDueDay(e.target.value)} />
          </Field>
          <Field label="Category">
            <input className={inputCls} value={category} onChange={e => setCategory(e.target.value)} placeholder="Entertainment" />
          </Field>
        </FormGrid>
      </FormSection>
      <SaveCancel onSave={() => onSave({ name, amount: Number(amount), billing_cycle: cycle, due_day: Number(dueDay), category })} onCancel={onCancel} />
    </div>
  );
}

function EmiForm({ initial, onSave, onCancel }: { initial?: EMI; onSave: (d: Omit<EMI, "id">) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [lender, setLender] = useState(initial?.lender ?? "");
  const [amount, setAmount] = useState(String(initial?.amount ?? ""));
  const [total, setTotal] = useState(String(initial?.total_months ?? "12"));
  const [paid, setPaid] = useState(String(initial?.paid_months ?? "0"));
  const [dueDay, setDueDay] = useState(String(initial?.due_day ?? "1"));
  return (
    <div className="flex flex-col gap-5">
      <FormSection title="Loan Details">
        <FormGrid>
          <Field label="Loan Name">
            <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="Home Loan" />
          </Field>
          <Field label="Lender">
            <input className={inputCls} value={lender} onChange={e => setLender(e.target.value)} placeholder="HDFC" />
          </Field>
        </FormGrid>
        <FormGrid>
          <Field label="Monthly EMI" hint="₹">
            <input className={inputCls} type="number" value={amount} onChange={e => setAmount(e.target.value)} />
          </Field>
          <Field label="Due Day" hint="1 – 31">
            <input className={inputCls} type="number" min={1} max={31} value={dueDay} onChange={e => setDueDay(e.target.value)} />
          </Field>
        </FormGrid>
      </FormSection>
      <FormSection title="Progress">
        <FormGrid>
          <Field label="Total Months">
            <input className={inputCls} type="number" value={total} onChange={e => setTotal(e.target.value)} />
          </Field>
          <Field label="Months Paid">
            <input className={inputCls} type="number" value={paid} onChange={e => setPaid(e.target.value)} />
          </Field>
        </FormGrid>
        {Number(total) > 0 && (
          <div className="rounded-xl bg-zinc-900 border border-zinc-700/50 px-4 py-3">
            <div className="flex justify-between text-xs text-zinc-500 mb-2">
              <span>{paid} months paid</span>
              <span>{Math.round((Number(paid) / Number(total)) * 100)}% complete</span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-800">
              <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${Math.min((Number(paid) / Number(total)) * 100, 100)}%` }} />
            </div>
          </div>
        )}
      </FormSection>
      <SaveCancel onSave={() => onSave({ name, lender, amount: Number(amount), total_months: Number(total), paid_months: Number(paid), due_day: Number(dueDay) })} onCancel={onCancel} />
    </div>
  );
}

function CardForm({ initial, onSave, onCancel }: { initial?: CreditCard; onSave: (d: Omit<CreditCard, "id">) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [bank, setBank] = useState(initial?.bank ?? "");
  const [last4, setLast4] = useState(initial?.last4 ?? "");
  const [creditLimit, setCreditLimit] = useState(String(initial?.credit_limit ?? ""));
  const [outstanding, setOutstanding] = useState(String(initial?.outstanding ?? ""));
  const [dueDay, setDueDay] = useState(String(initial?.due_day ?? "5"));
  const [dueOffset, setDueOffset] = useState(String(initial?.due_date_offset ?? "20"));
  return (
    <div className="flex flex-col gap-5">
      <FormSection title="Card Identity">
        <Field label="Card Name">
          <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="HDFC Regalia" />
        </Field>
        <FormGrid>
          <Field label="Bank">
            <input className={inputCls} value={bank} onChange={e => setBank(e.target.value)} placeholder="HDFC / Axis / SBI" />
          </Field>
          <Field label="Last 4 Digits">
            <input className={inputCls} value={last4} onChange={e => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="1234" maxLength={4} inputMode="numeric" />
          </Field>
        </FormGrid>
      </FormSection>
      <FormSection title="Billing">
        <FormGrid>
          <Field label="Credit Limit" hint="₹">
            <input className={inputCls} type="number" value={creditLimit} onChange={e => setCreditLimit(e.target.value)} />
          </Field>
          <Field label="Current Cycle Amount" hint="₹">
            <input className={inputCls} type="number" value={outstanding} onChange={e => setOutstanding(e.target.value)} />
          </Field>
          <Field label="Statement Day" hint="1 – 31">
            <input className={inputCls} type="number" min={1} max={31} value={dueDay} onChange={e => setDueDay(e.target.value)} />
          </Field>
        </FormGrid>
        <Field label="Payment Due Offset" hint="days after statement">
          <input className={inputCls} type="number" min={1} max={60} value={dueOffset} onChange={e => setDueOffset(e.target.value)} />
        </Field>
      </FormSection>
      <SaveCancel onSave={() => onSave({
        name,
        bank,
        last4,
        credit_limit: creditLimit ? Number(creditLimit) : undefined,
        outstanding: outstanding ? Number(outstanding) : 0,
        minimum_due: initial?.minimum_due ?? 0,
        due_day: Number(dueDay),
        due_date_offset: Number(dueOffset),
      })} onCancel={onCancel} />
    </div>
  );
}

function AccountForm({ initial, onSave, onCancel }: { initial?: BankAccount; onSave: (d: Omit<BankAccount, "id">) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [bank, setBank] = useState(initial?.bank ?? "");
  const [balance, setBalance] = useState(String(initial?.balance ?? ""));
  return (
    <div className="flex flex-col gap-5">
      <FormSection>
        <Field label="Account Name">
          <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="HDFC Savings" />
        </Field>
        <FormGrid>
          <Field label="Bank Tag">
            <input className={inputCls} value={bank} onChange={e => setBank(e.target.value)} placeholder="HDFC / Axis / Cash" />
          </Field>
          <Field label="Current Balance" hint="₹">
            <input className={inputCls} type="number" value={balance} onChange={e => setBalance(e.target.value)} />
          </Field>
        </FormGrid>
      </FormSection>
      <SaveCancel onSave={() => onSave({ name, bank, balance: Number(balance) })} onCancel={onCancel} />
    </div>
  );
}

function ReceivableForm({ initial, onSave, onCancel }: { initial?: Receivable; onSave: (d: Omit<Receivable, "id">) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [source, setSource] = useState(initial?.source ?? "");
  const [amount, setAmount] = useState(String(initial?.amount ?? ""));
  const [expectedDay, setExpectedDay] = useState(String(initial?.expected_day ?? "1"));
  return (
    <div className="flex flex-col gap-5">
      <FormSection>
        <FormGrid>
          <Field label="Name">
            <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="Salary" />
          </Field>
          <Field label="Source">
            <input className={inputCls} value={source} onChange={e => setSource(e.target.value)} placeholder="Employer" />
          </Field>
        </FormGrid>
        <FormGrid>
          <Field label="Amount" hint="₹">
            <input className={inputCls} type="number" value={amount} onChange={e => setAmount(e.target.value)} />
          </Field>
          <Field label="Expected Day" hint="of month">
            <input className={inputCls} type="number" min={1} max={31} value={expectedDay} onChange={e => setExpectedDay(e.target.value)} />
          </Field>
        </FormGrid>
      </FormSection>
      <SaveCancel onSave={() => onSave({ name, source, amount: Number(amount), expected_day: Number(expectedDay) })} onCancel={onCancel} />
    </div>
  );
}

function CapexForm({ initial, onSave, onCancel }: { initial?: CapExItem; onSave: (d: Omit<CapExItem, "id">) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState(initial?.category ?? "Other");
  const [amount, setAmount] = useState(String(initial?.amount ?? ""));
  return (
    <div className="flex flex-col gap-5">
      <FormSection>
        <Field label="Item Name">
          <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="Solar Installation" />
        </Field>
        <FormGrid>
          <Field label="Category">
            <select className={selectCls} value={category} onChange={e => setCategory(e.target.value)}>
              <option value="Home">Home</option>
              <option value="Personal">Personal</option>
              <option value="Dev Tools">Dev Tools</option>
              <option value="Other">Other</option>
            </select>
          </Field>
          <Field label="Amount" hint="₹">
            <input className={inputCls} type="number" value={amount} onChange={e => setAmount(e.target.value)} />
          </Field>
        </FormGrid>
      </FormSection>
      <SaveCancel onSave={() => onSave({ name, category, amount: Number(amount) })} onCancel={onCancel} />
    </div>
  );
}

function RentForm({ initial, onSave, onCancel }: { initial: Rent; onSave: (d: Rent) => void; onCancel: () => void }) {
  const [amount, setAmount] = useState(String(initial.amount));
  const [dueDay, setDueDay] = useState(String(initial.due_day));
  return (
    <div className="flex flex-col gap-5">
      <FormSection>
        <FormGrid>
          <Field label="Monthly Rent" hint="₹">
            <input className={inputCls} type="number" value={amount} onChange={e => setAmount(e.target.value)} />
          </Field>
          <Field label="Due Day" hint="1 – 31">
            <input className={inputCls} type="number" min={1} max={31} value={dueDay} onChange={e => setDueDay(e.target.value)} />
          </Field>
        </FormGrid>
      </FormSection>
      <SaveCancel saveLabel="Update Rent" onSave={() => onSave({ amount: Number(amount), due_day: Number(dueDay) })} onCancel={onCancel} />
    </div>
  );
}

function ProfileForm({ user, onSave, onCancel }: { user: User; onSave: (d: { name: string; email: string; password?: string }) => void; onCancel?: () => void }) {
  const [name, setName] = useState(user.name ?? "");
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  const handleSave = () => {
    if (password && password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setError("");
    onSave({ name, email, ...(password ? { password } : {}) });
  };

  return (
    <div className="flex flex-col gap-5">
      <FormSection title="Information">
        <Field label="Full Name">
          <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="John Doe" />
        </Field>
        <Field label="Email Address">
          <input className={inputCls} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="john@example.com" />
        </Field>
      </FormSection>
      <FormSection title="Security" hint="Leave blank to keep current password">
        <FormGrid>
          <Field label="New Password">
            <input className={inputCls} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
          </Field>
          <Field label="Confirm Password">
            <input className={inputCls} type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••" />
          </Field>
        </FormGrid>
      </FormSection>
      {error && <p className="text-xs text-red-400 font-medium">{error}</p>}
      <SaveCancel saveLabel="Update Profile" onSave={handleSave} onCancel={onCancel} />
    </div>
  );
}

// ── Item cards (list view) ─────────────────────────────────────────────────

function ItemCard({
  title, subtitle, badge, amount, onEdit, onDelete, children,
}: {
  title: string; subtitle?: string; badge?: string; amount?: string;
  onEdit: () => void; onDelete: () => void; children?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-zinc-800/50 border border-zinc-700/50 p-4 flex flex-col gap-3 hover:border-zinc-600/70 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-100 truncate">{title}</p>
          {subtitle && <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>}
          {badge && (
            <span className="inline-block mt-1.5 text-xs px-2 py-0.5 rounded-full bg-zinc-700/60 text-zinc-400 border border-zinc-600/40">
              {badge}
            </span>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          {amount && <span className="font-mono text-base font-bold text-zinc-100">{amount}</span>}
          <div className="flex items-center gap-1">
            <button
              onClick={onEdit}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-violet-400 hover:bg-violet-500/10 transition-colors"
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

// ── Nav config ─────────────────────────────────────────────────────────────

const NAV: { id: Tab; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: "accounts",     label: "Bank Accounts",  icon: <Landmark size={16} />,       desc: "Balances & liquidity" },
  { id: "cards",        label: "Credit Cards",   icon: <CardIcon size={16} />,       desc: "Outstanding & bills" },
  { id: "receivables",  label: "Inflows",        icon: <ArrowDownToLine size={16} />,desc: "Expected income" },
  { id: "capex",        label: "CapEx",          icon: <Target size={16} />,         desc: "Planned spends" },
  { id: "rent",         label: "Rent",           icon: <Home size={16} />,           desc: "Fixed monthly" },
  { id: "subscriptions",label: "Subscriptions",  icon: <Receipt size={16} />,        desc: "Recurring services" },
  { id: "emis",         label: "EMIs",           icon: <TrendingDown size={16} />,   desc: "Loan instalments" },
  { id: "profile",      label: "My Account",     icon: <List size={16} />,           desc: "Profile & Security" },
];

// ── Main modal ─────────────────────────────────────────────────────────────

export function CrudDrawer({ open, onClose, subscriptions, emis, cards, accounts, receivables, capex, rent, onRefetch, initialTab, user, onUserUpdate, onLogout }: Props) {
  const [tab, setTab] = useState<Tab>("accounts");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [gmailSyncing, setGmailSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [gmailError, setGmailError] = useState<string | null>(null);
  const [processingMessage, setProcessingMessage] = useState<string | null>(null);

  // Sync tab with initialTab when drawer opens or initialTab changes
  useEffect(() => {
    if (open && initialTab) setTab(initialTab);
  }, [open, initialTab]);

  // Load Gmail status when profile tab is active
  useEffect(() => {
    if (open && tab === "profile") {
      getGmailStatus()
        .then(s => setGmailStatus(s))
        .catch(() => {});
    }
  }, [open, tab]);

  // Handle ?gmail_connected=1 redirect from OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("gmail_connected") === "1") {
      window.history.replaceState({}, "", window.location.pathname);
      getGmailStatus().then(s => setGmailStatus(s)).catch(() => {});
    }
    if (params.get("gmail_error")) {
      setGmailError("Gmail connection failed. Please try again.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);
  const [adding, setAdding] = useState(false);
  const [txnCardId, setTxnCardId] = useState<string | null>(null);
  const [txnDefaultAddBill, setTxnDefaultAddBill] = useState(false);
  const isProcessing = processingMessage !== null;

  async function withProcessing<T>(message: string, run: () => Promise<T>): Promise<T> {
    setProcessingMessage(message);
    try {
      return await run();
    } finally {
      setProcessingMessage(null);
    }
  }

  const reset = () => { setEditingId(null); setAdding(false); setTxnCardId(null); setTxnDefaultAddBill(false); };
  const switchTab = (t: Tab) => { setTab(t); reset(); };

  async function saveSub(id: string | null, d: Omit<Subscription, "id">) {
    try {
      await withProcessing(id ? "Updating subscription..." : "Creating subscription...", async () => {
        if (id) {
          await api.updateObligation(id, {
            name: d.name,
            amount: d.amount,
            frequency: d.billing_cycle === "monthly" || d.billing_cycle === "yearly" || d.billing_cycle === "weekly"
              ? d.billing_cycle
              : "monthly",
            due_day: d.due_day,
          });
        } else {
          await api.createObligation({
            type: "subscription",
            name: d.name,
            amount: d.amount,
            frequency: d.billing_cycle,
            anchor_date: new Date().toISOString().slice(0, 10),
            due_day: d.due_day,
            category: d.category,
          });
        }
      });
      reset();
      onRefetch();
    }
    catch (e) { console.error(e); }
  }
  async function saveEmi(id: string | null, d: Omit<EMI, "id">) {
    try {
      await withProcessing(id ? "Updating EMI..." : "Creating EMI...", async () => {
        if (id) {
          await api.updateObligation(id, {
            name: d.name,
            amount: d.amount,
            total_installments: d.total_months,
            completed_installments: d.paid_months,
            due_day: d.due_day,
            lender: d.lender,
          });
        } else {
          await api.createObligation({
            type: "emi",
            name: d.name,
            amount: d.amount,
            frequency: "monthly",
            anchor_date: new Date().toISOString().slice(0, 10),
            due_day: d.due_day,
            total_installments: d.total_months,
            completed_installments: d.paid_months,
            lender: d.lender,
            category: "Loan",
          });
        }
      });
      reset();
      onRefetch();
    }
    catch (e) { console.error(e); }
  }
  async function saveCard(id: string | null, d: Omit<CreditCard, "id">) {
    try {
      await withProcessing(id ? "Updating credit card..." : "Creating credit card...", async () => {
        if (id) {
          await api.updateFinancialAccount(id, {
            name: d.name,
            institution: d.bank,
            last4: d.last4,
            billing_cycle_day: d.due_day,
            due_offset_days: d.due_date_offset,
            credit_limit: d.credit_limit,
          });

          const cycleAmount = Number(d.outstanding ?? 0);
          const overview = await api.getBillingCycleOverview(id);
          if (overview.current_cycle) {
            await api.updateBillingCycle(overview.current_cycle.id, {
              total_billed: cycleAmount,
            });
          } else if (cycleAmount !== 0 || Number(d.minimum_due ?? 0) !== 0) {
            await api.createBillingCycleForCard(id, {
              statement_period: "current",
              total_billed: cycleAmount,
              minimum_due: d.minimum_due,
            });
          }
        } else {
          await api.createFinancialAccount({
            kind: "credit_card",
            name: d.name,
            institution: d.bank,
            last4: d.last4,
            billing_cycle_day: d.due_day,
            due_offset_days: d.due_date_offset,
          } as any);
        }
      });
      reset();
      onRefetch();
    }
    catch (e) { console.error(e); }
  }
  async function saveAccount(id: string | null, d: Omit<BankAccount, "id">) {
    try {
      await withProcessing(id ? "Updating account..." : "Creating account...", async () => {
        if (id) {
          await api.updateFinancialAccount(id, {
            name: d.name,
            institution: d.bank,
            balance: d.balance,
          });
        } else {
          await api.createFinancialAccount({
            kind: "bank",
            name: d.name,
            institution: d.bank,
            opening_balance: d.balance,
          } as any);
        }
      });
      reset();
      onRefetch();
    }
    catch (e) { console.error(e); }
  }
  async function saveReceivable(id: string | null, d: Omit<Receivable, "id">) {
    try {
      await withProcessing(id ? "Updating receivable..." : "Creating receivable...", async () => {
        if (id) await api.updateReceivable(id, d);
        else await api.createReceivable(d);
      });
      reset();
      onRefetch();
    }
    catch (e) { console.error(e); }
  }
  async function saveCapex(id: string | null, d: Omit<CapExItem, "id">) {
    try {
      await withProcessing(id ? "Updating CapEx item..." : "Creating CapEx item...", async () => {
        if (id) await api.updateCapex(id, d);
        else await api.createCapex(d);
      });
      reset();
      onRefetch();
    }
    catch (e) { console.error(e); }
  }
  async function saveRent(d: Rent) {
    try {
      await withProcessing("Saving rent...", async () => {
        if (rent.id) {
          await api.updateObligation(rent.id, {
            amount: d.amount,
            due_day: d.due_day,
            name: "House Rent",
          });
        } else {
          await api.createObligation({
            type: "rent",
            name: "House Rent",
            amount: d.amount,
            frequency: "monthly",
            anchor_date: new Date().toISOString().slice(0, 10),
            due_day: d.due_day,
            category: "Housing",
          });
        }
      });
      reset();
      onRefetch();
    } catch (e) { console.error(e); }
  }

  async function saveProfile(d: { name: string; email: string; password?: string }) {
    try {
      const updated = await withProcessing("Updating profile...", () => api.updateUser(d));
      onUserUpdate(updated);
      alert("Profile updated successfully");
    } catch (e: any) {
      alert(e.message || "Failed to update profile");
    }
  }

  async function handleGmailConnect() {
    setGmailError(null);
    try {
      const { oauth_url } = await withProcessing("Starting Gmail connection...", () => getConnectUrl());
      window.location.href = oauth_url;
    } catch (e: any) {
      setGmailError(e.message || "Failed to start Gmail connection");
    }
  }

  async function handleGmailSync() {
    setGmailSyncing(true);
    setSyncResult(null);
    setGmailError(null);
    try {
      const result = await withProcessing("Syncing Gmail...", () => syncGmail());
      setSyncResult(result);
      const status = await getGmailStatus();
      setGmailStatus(status);
      onRefetch();
    } catch (e: any) {
      setGmailError(e.message || "Sync failed");
    } finally {
      setGmailSyncing(false);
    }
  }

  async function handleGmailDisconnect() {
    if (!window.confirm("Disconnect Gmail? You can reconnect anytime.")) return;
    try {
      await withProcessing("Disconnecting Gmail...", () => disconnectGmail());
      setGmailStatus(s => s ? { ...s, connected: false, connected_at: null } : null);
      setSyncResult(null);
    } catch (e: any) {
      setGmailError(e.message || "Failed to disconnect");
    }
  }

  async function deleteAccount() {
    if (!window.confirm("Are you sure you want to delete your account? This cannot be undone.")) return;
    try {
      await withProcessing("Deleting account...", () => api.deleteUser());
      onLogout();
    } catch (e: any) {
      alert(e.message || "Failed to delete account");
    }
  }

  const activeNav = NAV.find(n => n.id === tab)!;
  const isRent = tab === "rent";
  const isProfile = tab === "profile";
  const cardsOutstandingTotal = cards.reduce((sum, c) => sum + Number(c.outstanding || 0), 0);
  const cardsMinimumDueTotal = cards.reduce((sum, c) => sum + Number(c.minimum_due || 0), 0);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal — full height, centered, wide */}
      <div className="relative z-10 m-auto w-full max-w-5xl h-[90vh] bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl flex overflow-hidden">

        {/* ── Left sidebar nav ── */}
        <div className="w-56 shrink-0 bg-zinc-900/80 border-r border-zinc-800 flex flex-col">
          <div className="px-5 py-5 border-b border-zinc-800">
            <h2 className="text-base font-bold text-zinc-100">Data Manager</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Edit your financial data</p>
          </div>
          <nav className="flex-1 overflow-y-auto py-3 px-2 flex flex-col gap-0.5">
            {NAV.map(n => (
              <button
                key={n.id}
                onClick={() => switchTab(n.id)}
                disabled={isProcessing}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
                  tab === n.id
                    ? "bg-violet-600/20 text-violet-300 border border-violet-500/30"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 border border-transparent"
                )}
              >
                <span className={tab === n.id ? "text-violet-400" : "text-zinc-500"}>{n.icon}</span>
                <div>
                  <p className="text-xs font-semibold leading-tight">{n.label}</p>
                  <p className="text-xs text-zinc-600 leading-tight mt-0.5">{n.desc}</p>
                </div>
              </button>
            ))}
          </nav>
        </div>

        {/* ── Right content area ── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Content header */}
          <div className="flex items-center justify-between px-8 py-5 border-b border-zinc-800 shrink-0">
            <div className="flex items-center gap-3">
              <span className="text-violet-400">{activeNav.icon}</span>
              <div>
                <h3 className="text-base font-bold text-zinc-100">{activeNav.label}</h3>
                <p className="text-xs text-zinc-500">{activeNav.desc}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {!isRent && !isProfile && !adding && !editingId && (
                <button
                  onClick={() => setAdding(true)}
                  disabled={isProcessing}
                  className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
                >
                  <Plus size={15} /> Add New
                </button>
              )}
              <button onClick={onClose} disabled={isProcessing} className="p-2 rounded-xl text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto relative">
            <div className="px-8 py-6 flex flex-col gap-5">

              {isProcessing && (
                <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-3 flex items-center gap-2 text-sm text-violet-200">
                  <Loader2 size={14} className="animate-spin" />
                  <span>{processingMessage}</span>
                </div>
              )}

              {/* ── Add / Edit form panel ── */}
              {(adding || editingId) && (
                <div className="rounded-2xl bg-zinc-900 border border-violet-500/30 p-6">
                  <div className="flex items-center justify-between mb-5">
                    <p className="text-xs font-semibold text-violet-400 uppercase tracking-widest">
                      {editingId ? "Edit Entry" : "New Entry"}
                    </p>
                    <button
                      onClick={reset}
                      disabled={isProcessing}
                      className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                      aria-label="Close entry form"
                      title="Close"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  {tab === "subscriptions" && (
                    editingId
                      ? <SubForm initial={subscriptions.find(s => s.id === editingId)} onSave={d => saveSub(editingId, d)} onCancel={reset} />
                      : <SubForm onSave={d => saveSub(null, d)} onCancel={reset} />
                  )}
                  {tab === "emis" && (
                    editingId
                      ? <EmiForm initial={emis.find(e => e.id === editingId)} onSave={d => saveEmi(editingId, d)} onCancel={reset} />
                      : <EmiForm onSave={d => saveEmi(null, d)} onCancel={reset} />
                  )}
                  {tab === "cards" && (
                    editingId
                      ? <CardForm initial={cards.find(c => c.id === editingId)} onSave={d => saveCard(editingId, d)} onCancel={reset} />
                      : <CardForm onSave={d => saveCard(null, d)} onCancel={reset} />
                  )}
                  {tab === "accounts" && (
                    editingId
                      ? <AccountForm initial={accounts.find(a => a.id === editingId)} onSave={d => saveAccount(editingId, d)} onCancel={reset} />
                      : <AccountForm onSave={d => saveAccount(null, d)} onCancel={reset} />
                  )}
                  {tab === "receivables" && (
                    editingId
                      ? <ReceivableForm initial={receivables.find(r => r.id === editingId)} onSave={d => saveReceivable(editingId, d)} onCancel={reset} />
                      : <ReceivableForm onSave={d => saveReceivable(null, d)} onCancel={reset} />
                  )}
                  {tab === "capex" && (
                    editingId
                      ? <CapexForm initial={capex.find(i => i.id === editingId)} onSave={d => saveCapex(editingId, d)} onCancel={reset} />
                      : <CapexForm onSave={d => saveCapex(null, d)} onCancel={reset} />
                  )}
                  {/* profile tab is rendered inline below, not here */}
                </div>
              )}

              {/* ── Rent single-record form ── */}
              {isRent && (
                <div className="rounded-2xl bg-zinc-900 border border-zinc-700/50 p-6">
                  <p className="text-xs text-zinc-500 mb-5">Fixed monthly rent — deducted from net liquidity in all calculations.</p>
                  <RentForm initial={rent} onSave={saveRent} onCancel={() => {}} />
                </div>
              )}

              {/* ── Profile ── */}
              {isProfile && user && (
                <>
                  <div className="rounded-2xl bg-zinc-900 border border-zinc-700/50 p-6">
                    <ProfileForm user={user} onSave={saveProfile} />
                  </div>
                  {/* Gmail Integration */}
                  <div className="rounded-2xl bg-zinc-900 border border-zinc-700/50 p-6">
                    <div className="flex items-center gap-2 mb-1">
                      <Mail size={14} className="text-zinc-400" />
                      <p className="text-xs font-semibold text-zinc-300 uppercase tracking-widest">Gmail Integration</p>
                      {gmailStatus?.connected && (
                        <span className="flex items-center gap-1 text-xs text-emerald-400 ml-auto">
                          <CheckCircle2 size={11} /> Connected
                        </span>
                      )}
                    </div>

                    {gmailError && (
                      <p className="text-xs text-red-400 mt-2 mb-3">{gmailError}</p>
                    )}

                    {!gmailStatus?.connected ? (
                      <>
                        <p className="text-xs text-zinc-500 mt-1 mb-4">
                          Automatically import credit card transactions and statements from your Gmail inbox.
                        </p>
                        <button
                          onClick={handleGmailConnect}
                          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors"
                        >
                          <Mail size={14} /> Connect Gmail
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="text-xs text-zinc-500 mt-1 mb-4 flex flex-col gap-0.5">
                          {gmailStatus.connected_at && (
                            <span>Connected since {new Date(gmailStatus.connected_at).toLocaleDateString()}</span>
                          )}
                          {gmailStatus.last_synced_at ? (
                            <span>Last synced {new Date(gmailStatus.last_synced_at).toLocaleString()}</span>
                          ) : (
                            <span>Never synced</span>
                          )}
                        </div>

                        {syncResult && (
                          <div className="text-xs text-zinc-400 bg-zinc-800/60 rounded-xl px-3 py-2 mb-3">
                            {syncResult.txns_created} transaction{syncResult.txns_created !== 1 ? "s" : ""} &nbsp;·&nbsp;
                            {syncResult.stmts_created} statement{syncResult.stmts_created !== 1 ? "s" : ""} imported
                            &nbsp;from {syncResult.emails_found} emails
                            {syncResult.errors.length > 0 && (
                              <span className="text-amber-400"> · {syncResult.errors.length} skipped</span>
                            )}
                          </div>
                        )}

                        <div className="flex items-center gap-2">
                          <button
                            onClick={handleGmailSync}
                            disabled={gmailSyncing}
                            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors"
                          >
                            {gmailSyncing
                              ? <><Loader2 size={13} className="animate-spin" /> Syncing…</>
                              : <><RefreshCw size={13} /> Sync Now</>
                            }
                          </button>
                          <button
                            onClick={handleGmailDisconnect}
                            className="text-xs text-zinc-500 hover:text-red-400 transition-colors px-3 py-2.5"
                          >
                            Disconnect
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="rounded-2xl bg-zinc-900 border border-red-900/40 p-6">
                    <p className="text-xs font-semibold text-red-400 uppercase tracking-widest mb-1">Danger Zone</p>
                    <p className="text-xs text-zinc-500 mb-5">Deleting your account is permanent. All your data will be inaccessible and your session will be ended.</p>
                    <button
                      onClick={deleteAccount}
                      className="flex items-center gap-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/40 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors"
                    >
                      <Trash2 size={14} /> Delete Account
                    </button>
                  </div>
                </>
              )}

              {/* ── Item lists ── */}
              {!isRent && !isProfile && !adding && !editingId && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {tab === "cards" && !txnCardId && (
                    <div className="col-span-full rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
                      <p className="text-xs uppercase tracking-wider text-red-300">Total Card Outstanding</p>
                      <p className="font-mono text-xl font-semibold text-red-300 mt-1">{formatINR(cardsOutstandingTotal)}</p>
                      <p className="text-xs text-zinc-400 mt-1">Total minimum due: {formatINR(cardsMinimumDueTotal)}</p>
                    </div>
                  )}

                  {tab === "accounts" && accounts.map(a => (
                    <ItemCard key={a.id} title={a.name} subtitle={a.bank} amount={formatINR(a.balance)}
                      onEdit={() => setEditingId(a.id)} onDelete={async () => { 
                        if (window.confirm(`Are you sure you want to delete account "${a.name}"?`)) {
                          await withProcessing("Deleting account...", () => api.deleteFinancialAccount(a.id));
                          onRefetch(); 
                        }
                      }} />
                  ))}

                  {tab === "cards" && txnCardId && (() => {
                    const card = cards.find(c => c.id === txnCardId);
                    return card ? (
                      <div className="col-span-full">
                        <CardTransactionPanel card={card} defaultAddingBill={txnDefaultAddBill} onBack={() => { setTxnCardId(null); setTxnDefaultAddBill(false); }} />
                      </div>
                    ) : null;
                  })()}

                  {tab === "cards" && !txnCardId && cards.map(c => (
                    <ItemCard key={c.id}
                      title={c.last4 ? `${c.name}  ···· ${c.last4}` : c.name}
                      subtitle={`${c.bank} · stmt day ${c.due_day ?? "—"} · due in ${c.due_date_offset}d`}
                      badge={`Min due ${formatINR(c.minimum_due)}`}
                      amount={formatINR(c.outstanding)}
                      onEdit={() => setEditingId(c.id)}
                      onDelete={async () => { await withProcessing("Deleting card...", () => api.deleteFinancialAccount(c.id)); onRefetch(); }}
                    >
                      <div className="h-1 rounded-full bg-zinc-700 overflow-hidden">
                        <div className="h-full bg-red-500/60 rounded-full" style={{ width: c.outstanding > 0 ? `${Math.min((c.minimum_due / c.outstanding) * 100, 100)}%` : "0%" }} />
                      </div>
                      <button
                        onClick={() => { setTxnCardId(c.id); setTxnDefaultAddBill(false); }}
                        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-violet-400 transition-colors mt-2"
                      >
                        <List size={11} /> Open Card Hub
                      </button>
                    </ItemCard>
                  ))}

                  {tab === "receivables" && receivables.map(r => (
                    <ItemCard key={r.id} title={r.name} subtitle={`${r.source} · expected day ${r.expected_day}`}
                      amount={formatINR(r.amount)}
                      onEdit={() => setEditingId(r.id)} onDelete={async () => { await withProcessing("Deleting receivable...", () => api.deleteReceivable(r.id)); onRefetch(); }} />
                  ))}

                  {tab === "capex" && capex.map(item => (
                    <ItemCard key={item.id} title={item.name} badge={item.category} amount={formatINR(item.amount)}
                      onEdit={() => setEditingId(item.id)} onDelete={async () => { await withProcessing("Deleting CapEx item...", () => api.deleteCapex(item.id)); onRefetch(); }} />
                  ))}

                  {tab === "subscriptions" && subscriptions.map(s => (
                    <ItemCard key={s.id} title={s.name} subtitle={`${s.billing_cycle} · due day ${s.due_day}`} badge={s.category}
                      amount={formatINR(s.amount)}
                      onEdit={() => setEditingId(s.id)} onDelete={async () => { await withProcessing("Deleting subscription...", () => api.deleteObligation(s.id)); onRefetch(); }} />
                  ))}

                  {tab === "emis" && emis.map(e => (
                    <ItemCard key={e.id} title={e.name} subtitle={`${e.lender} · due day ${e.due_day}`}
                      badge={`${e.paid_months} / ${e.total_months} months`}
                      amount={formatINR(e.amount)}
                      onEdit={() => setEditingId(e.id)} onDelete={async () => { await withProcessing("Deleting EMI...", () => api.deleteObligation(e.id)); onRefetch(); }}
                    >
                      <div className="h-1 rounded-full bg-zinc-700 overflow-hidden">
                        <div className="h-full bg-violet-500/70 rounded-full" style={{ width: `${Math.min((e.paid_months / e.total_months) * 100, 100)}%` }} />
                      </div>
                    </ItemCard>
                  ))}

                </div>
              )}

            </div>

            {isProcessing && (
              <div className="absolute inset-0 bg-zinc-950/55 z-10" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
