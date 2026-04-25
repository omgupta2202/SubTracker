import { useEffect, useState } from "react";
import { Command } from "cmdk";
import type { LucideIcon } from "lucide-react";
import {
  Banknote, CreditCard, Repeat, TrendingDown, Target, Receipt, Home,
  Plus, Search,
} from "lucide-react";
import * as api from "@/services/api";
import { cn } from "@/lib/utils";

/**
 * ⌘K command palette — only entry point for "create new <thing>".
 * Each command opens its own tiny inline form inside the palette,
 * commits via the API, then closes. No drawer, no modal stack.
 */

type EntityKind =
  | "subscription" | "emi" | "card" | "account"
  | "receivable"   | "capex" | "rent";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (kind: EntityKind) => void;
}

const ENTITIES: Array<{
  kind: EntityKind;
  label: string;
  hint: string;
  icon: LucideIcon;
  shortcut?: string;
}> = [
  { kind: "subscription", label: "Add subscription", hint: "Netflix, Spotify, recurring",  icon: Repeat,        shortcut: "S" },
  { kind: "emi",          label: "Add EMI",          hint: "Loan instalment plan",         icon: TrendingDown,  shortcut: "E" },
  { kind: "card",         label: "Add credit card",  hint: "Bank, last4, due day",         icon: CreditCard,    shortcut: "C" },
  { kind: "account",      label: "Add bank account", hint: "Bank, balance",                icon: Banknote,      shortcut: "B" },
  { kind: "receivable",   label: "Add receivable",   hint: "Money owed to you",            icon: Receipt,       shortcut: "R" },
  { kind: "capex",        label: "Add capex",        hint: "Planned one-time spend",       icon: Target,        shortcut: "X" },
  { kind: "rent",         label: "Update rent",      hint: "Monthly rent + due day",       icon: Home,          shortcut: "T" },
];

export function CommandPalette({ open, onOpenChange, onCreated }: Props) {
  const [active, setActive] = useState<EntityKind | null>(null);

  // ⌘K / Ctrl+K toggle
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
      if (e.key === "Escape" && open) {
        if (active) setActive(null);
        else        onOpenChange(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, active, onOpenChange]);

  // reset active panel when palette closes
  useEffect(() => { if (!open) setActive(null); }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/60 backdrop-blur-sm"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-[min(92vw,580px)] rounded-2xl border border-zinc-700/80 bg-zinc-900 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {active ? (
          <CreateForm
            kind={active}
            onCancel={() => setActive(null)}
            onDone={() => {
              onCreated?.(active);
              onOpenChange(false);
            }}
          />
        ) : (
          <Command className="bg-transparent" loop>
            <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2.5">
              <Search size={14} className="text-zinc-500 shrink-0" />
              <Command.Input
                autoFocus
                placeholder="Add transaction, subscription, EMI…"
                className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 outline-none"
              />
              <kbd className="text-[10px] font-mono text-zinc-600 border border-zinc-700/60 rounded px-1.5 py-0.5">esc</kbd>
            </div>
            <Command.List className="max-h-[60vh] overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-6 text-sm text-zinc-500 text-center">
                No matches.
              </Command.Empty>
              <Command.Group heading="Add new">
                {ENTITIES.map(e => {
                  const Icon = e.icon;
                  return (
                    <Command.Item
                      key={e.kind}
                      value={`${e.label} ${e.hint}`}
                      onSelect={() => setActive(e.kind)}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer",
                        "data-[selected=true]:bg-violet-500/15 data-[selected=true]:text-violet-100",
                      )}
                    >
                      <Icon size={14} className="text-violet-300 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-zinc-100">{e.label}</div>
                        <div className="text-xs text-zinc-500">{e.hint}</div>
                      </div>
                      {e.shortcut && (
                        <kbd className="text-[10px] font-mono text-zinc-600 border border-zinc-700/60 rounded px-1.5 py-0.5">{e.shortcut}</kbd>
                      )}
                    </Command.Item>
                  );
                })}
              </Command.Group>
            </Command.List>
          </Command>
        )}
      </div>
    </div>
  );
}

/* ── Inline create forms — one per entity, dense, single screen ─────────── */

const inp =
  "w-full bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-sm text-zinc-100 " +
  "placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/60 focus:ring-1 focus:ring-violet-500/30";

function FormShell({
  title, busy, onCancel, onSave, children,
}: {
  title: string; busy: boolean;
  onCancel: () => void; onSave: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm text-zinc-200">
          <Plus size={14} className="text-violet-300" /> {title}
        </div>
        <button
          onClick={onCancel}
          className="text-[10px] font-mono text-zinc-500 hover:text-zinc-300 border border-zinc-700/60 rounded px-1.5 py-0.5"
        >esc</button>
      </div>
      <div className="p-4 grid grid-cols-2 gap-x-3 gap-y-3">{children}</div>
      <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-2.5">
        <button onClick={onCancel} disabled={busy} className="px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200">Cancel</button>
        <button onClick={onSave} disabled={busy} className="px-3 py-1 text-xs font-medium rounded bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function Lab({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium block mb-1">{children}</span>;
}

function CreateForm({ kind, onCancel, onDone }: { kind: EntityKind; onCancel: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<any>(() => DEFAULTS[kind]);
  function set<K extends keyof any>(k: K, v: any) { setForm((f: any) => ({ ...f, [k]: v })); }

  async function save() {
    setBusy(true);
    try {
      await SAVERS[kind](form);
      onDone();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (kind === "subscription") return (
    <FormShell title="New subscription" busy={busy} onCancel={onCancel} onSave={save}>
      <label className="col-span-2"><Lab>Name</Lab>
        <input className={inp} value={form.name ?? ""} onChange={e => set("name", e.target.value)} placeholder="Netflix" autoFocus />
      </label>
      <label><Lab>Amount (₹)</Lab>
        <input className={inp} type="number" value={form.amount ?? ""} onChange={e => set("amount", Number(e.target.value))} />
      </label>
      <label><Lab>Billing</Lab>
        <select className={inp} value={form.frequency} onChange={e => set("frequency", e.target.value)}>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
          <option value="weekly">Weekly</option>
        </select>
      </label>
      <label><Lab>Due day</Lab>
        <input className={inp} type="number" min={1} max={31} value={form.due_day ?? 1} onChange={e => set("due_day", Number(e.target.value))} />
      </label>
      <label><Lab>Category</Lab>
        <input className={inp} value={form.category ?? ""} onChange={e => set("category", e.target.value)} placeholder="Dev Tools" />
      </label>
    </FormShell>
  );

  if (kind === "emi") return (
    <FormShell title="New EMI" busy={busy} onCancel={onCancel} onSave={save}>
      <label className="col-span-2"><Lab>Loan name</Lab>
        <input className={inp} value={form.name ?? ""} onChange={e => set("name", e.target.value)} autoFocus />
      </label>
      <label><Lab>Lender</Lab>
        <input className={inp} value={form.lender ?? ""} onChange={e => set("lender", e.target.value)} />
      </label>
      <label><Lab>Monthly EMI (₹)</Lab>
        <input className={inp} type="number" value={form.amount ?? ""} onChange={e => set("amount", Number(e.target.value))} />
      </label>
      <label><Lab>Total months</Lab>
        <input className={inp} type="number" value={form.total_installments ?? ""} onChange={e => set("total_installments", Number(e.target.value))} />
      </label>
      <label><Lab>Paid months</Lab>
        <input className={inp} type="number" value={form.completed_installments ?? 0} onChange={e => set("completed_installments", Number(e.target.value))} />
      </label>
      <label><Lab>Due day</Lab>
        <input className={inp} type="number" min={1} max={31} value={form.due_day ?? 1} onChange={e => set("due_day", Number(e.target.value))} />
      </label>
    </FormShell>
  );

  if (kind === "card") return (
    <FormShell title="New credit card" busy={busy} onCancel={onCancel} onSave={save}>
      <label><Lab>Name</Lab>
        <input className={inp} value={form.name ?? ""} onChange={e => set("name", e.target.value)} placeholder="HDFC Diners" autoFocus />
      </label>
      <label><Lab>Bank</Lab>
        <input className={inp} value={form.bank ?? ""} onChange={e => set("bank", e.target.value)} placeholder="HDFC" />
      </label>
      <label><Lab>Last 4</Lab>
        <input className={inp} value={form.last4 ?? ""} maxLength={4} inputMode="numeric"
               onChange={e => set("last4", e.target.value.replace(/\D/g, "").slice(0, 4))} />
      </label>
      <label><Lab>Statement day</Lab>
        <input className={inp} type="number" min={1} max={31} value={form.due_day ?? 1} onChange={e => set("due_day", Number(e.target.value))} />
      </label>
      <label><Lab>Outstanding (₹)</Lab>
        <input className={inp} type="number" value={form.outstanding ?? 0} onChange={e => set("outstanding", Number(e.target.value))} />
      </label>
      <label><Lab>Min due (₹)</Lab>
        <input className={inp} type="number" value={form.minimum_due ?? 0} onChange={e => set("minimum_due", Number(e.target.value))} />
      </label>
    </FormShell>
  );

  if (kind === "account") return (
    <FormShell title="New account" busy={busy} onCancel={onCancel} onSave={save}>
      <label><Lab>Name</Lab>
        <input className={inp} value={form.name ?? ""} onChange={e => set("name", e.target.value)} autoFocus />
      </label>
      <label><Lab>Bank</Lab>
        <input className={inp} value={form.bank ?? ""} onChange={e => set("bank", e.target.value)} placeholder="HDFC / Axis / Cash" />
      </label>
      <label className="col-span-2"><Lab>Balance (₹)</Lab>
        <input className={inp} type="number" value={form.balance ?? 0} onChange={e => set("balance", Number(e.target.value))} />
      </label>
    </FormShell>
  );

  if (kind === "receivable") return (
    <FormShell title="New receivable" busy={busy} onCancel={onCancel} onSave={save}>
      <label><Lab>Name</Lab>
        <input className={inp} value={form.name ?? ""} onChange={e => set("name", e.target.value)} autoFocus />
      </label>
      <label><Lab>Source</Lab>
        <input className={inp} value={form.source ?? ""} onChange={e => set("source", e.target.value)} />
      </label>
      <label><Lab>Amount (₹)</Lab>
        <input className={inp} type="number" value={form.amount ?? 0} onChange={e => set("amount", Number(e.target.value))} />
      </label>
      <label><Lab>Expected day</Lab>
        <input className={inp} type="number" min={1} max={31} value={form.expected_day ?? 1} onChange={e => set("expected_day", Number(e.target.value))} />
      </label>
    </FormShell>
  );

  if (kind === "capex") return (
    <FormShell title="New capex" busy={busy} onCancel={onCancel} onSave={save}>
      <label className="col-span-2"><Lab>Name</Lab>
        <input className={inp} value={form.name ?? ""} onChange={e => set("name", e.target.value)} autoFocus />
      </label>
      <label><Lab>Amount (₹)</Lab>
        <input className={inp} type="number" value={form.amount ?? 0} onChange={e => set("amount", Number(e.target.value))} />
      </label>
      <label><Lab>Category</Lab>
        <select className={inp} value={form.category ?? "Other"} onChange={e => set("category", e.target.value)}>
          <option value="Home">Home</option>
          <option value="Personal">Personal</option>
          <option value="Dev Tools">Dev Tools</option>
          <option value="Other">Other</option>
        </select>
      </label>
    </FormShell>
  );

  if (kind === "rent") return (
    <FormShell title="Update rent" busy={busy} onCancel={onCancel} onSave={save}>
      <label><Lab>Amount (₹)</Lab>
        <input className={inp} type="number" value={form.amount ?? 0} onChange={e => set("amount", Number(e.target.value))} autoFocus />
      </label>
      <label><Lab>Due day</Lab>
        <input className={inp} type="number" min={1} max={31} value={form.due_day ?? 1} onChange={e => set("due_day", Number(e.target.value))} />
      </label>
    </FormShell>
  );

  return null;
}

const DEFAULTS: Record<EntityKind, any> = {
  subscription: { name: "", amount: 0, frequency: "monthly", due_day: 1, category: "Other" },
  emi:          { name: "", lender: "", amount: 0, total_installments: 12, completed_installments: 0, due_day: 1 },
  card:         { name: "", bank: "", last4: "", due_day: 1, outstanding: 0, minimum_due: 0 },
  account:      { name: "", bank: "", balance: 0 },
  receivable:   { name: "", source: "", amount: 0, expected_day: 1 },
  capex:        { name: "", amount: 0, category: "Other" },
  rent:         { amount: 0, due_day: 1 },
};

const SAVERS: Record<EntityKind, (form: any) => Promise<unknown>> = {
  subscription: (f) => api.createObligation({ ...f, type: "subscription" }),
  emi:          (f) => api.createObligation({ ...f, type: "emi" }),
  card:         (f) => api.createCard(f),
  account:      (f) => api.createAccount(f),
  receivable:   (f) => api.createReceivable(f),
  capex:        (f) => api.createCapex(f),
  rent:         (f) => api.updateRent(f),
};
