import { useMemo, useState } from "react";
import type { Subscription, EMI, CreditCard } from "@/types";
import { Flame, TrendingUp, TrendingDown, ChevronDown, ChevronUp, Pencil } from "lucide-react";
import { Card, CardHeader, CardTitle, CardAction, CardDivider } from "@/components/ui/Card";
import { Stat, Row } from "@/components/ui/Stat";
import { EditList, Field, FieldGrid, inputCls } from "@/components/ui/EditList";
import { inrCompact, pct } from "@/lib/tokens";
import { cn } from "@/lib/utils";
import * as api from "@/services/api";

interface Props {
  subscriptions: Subscription[];
  emis: EMI[];
  cards: CreditCard[];
  monthlyBurn?: number;
  monthlyBurnBaseline?: number;
  monthlyBurnProjected?: number;
  monthlyBurnTrendPct?: number | null;
  onRefetch: () => void;
  onHide?: () => void;
}

const SECTION_DOT = {
  Subscriptions: "bg-violet-400",
  EMIs:          "bg-sky-400",
  "Card mins":   "bg-emerald-400",
} as const;

export function MonthlyBurnCard({
  subscriptions, emis, cards,
  monthlyBurn, monthlyBurnBaseline, monthlyBurnProjected, monthlyBurnTrendPct,
  onRefetch, onHide,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const subTotal  = subscriptions.reduce((s, x) => s + x.amount, 0);
  const emiTotal  = emis.reduce((s, x) => s + x.amount, 0);
  const cardTotal = cards.reduce((s, x) => s + x.minimum_due, 0);
  const obligationTotal = subTotal + emiTotal + cardTotal;

  const actual    = monthlyBurn ?? obligationTotal;
  const baseline  = monthlyBurnBaseline ?? obligationTotal;
  const projected = monthlyBurnProjected ?? actual;

  const progress = baseline > 0 ? Math.min(actual / baseline, 1.5) : 0;
  const overBudget = progress > 1;

  const sections = useMemo(() => [
    { key: "Subscriptions", amount: subTotal,  count: subscriptions.length },
    { key: "EMIs",          amount: emiTotal,  count: emis.length },
    { key: "Card mins",     amount: cardTotal, count: cards.length },
  ], [subTotal, emiTotal, cardTotal, subscriptions.length, emis.length, cards.length]);

  const barBase = Math.max(obligationTotal, 1);

  return (
    <Card className="flex flex-col gap-4" onHide={onHide}>
      <CardHeader>
        <CardTitle icon={<Flame size={14} />}>This month</CardTitle>
        <div className="flex items-center gap-3">
          {monthlyBurnTrendPct !== null && monthlyBurnTrendPct !== undefined && (
            <span className={cn(
              "flex items-center gap-1 text-xs font-medium num",
              monthlyBurnTrendPct > 0 ? "text-red-400" : "text-emerald-400",
            )}>
              {monthlyBurnTrendPct > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {pct(monthlyBurnTrendPct).replace(/^\+?/, monthlyBurnTrendPct > 0 ? "+" : "")} vs prior
            </span>
          )}
          <CardAction onClick={() => { setEditing(v => !v); setExpanded(null); }} className="inline-flex items-center gap-1">
            <Pencil size={11} /> {editing ? "Done" : "Edit"}
          </CardAction>
        </div>
      </CardHeader>

      <div className="flex items-end justify-between gap-4">
        <Stat label="Spent" value={actual} size="hero" tone={overBudget ? "bad" : "neutral"} />
        <div className="flex flex-col items-end gap-2 pb-1">
          <Stat label="Baseline"  value={baseline}  size="sm" format="compact" align="right" />
          <Stat label="Projected" value={projected} size="sm" format="compact" align="right"
                tone={projected > baseline * 1.05 ? "bad" : "neutral"} />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <div className="h-2 rounded-full bg-zinc-800/80 overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-[width]", overBudget ? "bg-red-500" : "bg-violet-500")}
            style={{ width: `${Math.min(progress * 100, 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-[11px] text-zinc-500 num">
          <span>{Math.round(progress * 100)}% of baseline</span>
          <span>{inrCompact(baseline)}</span>
        </div>
      </div>

      <CardDivider />

      <div className="flex flex-col gap-2">
        <div className="flex h-1.5 rounded-full overflow-hidden gap-px">
          {sections.map(s => (
            <div
              key={s.key}
              className={SECTION_DOT[s.key as keyof typeof SECTION_DOT]}
              style={{ width: `${(s.amount / barBase) * 100}%`, minWidth: s.amount > 0 ? 2 : 0 }}
              title={`${s.key}: ${inrCompact(s.amount)}`}
            />
          ))}
        </div>

        {sections.map(s => {
          const isOpen = expanded === s.key;
          const showEditList = editing && (s.key === "Subscriptions" || s.key === "EMIs");
          return (
            <div key={s.key}>
              <button
                onClick={() => setExpanded(isOpen ? null : s.key)}
                className="w-full -mx-2 px-2 py-1.5 rounded-md flex items-center gap-3 hover:bg-zinc-800/30 transition-colors"
              >
                <span className={cn("h-2 w-2 rounded-full shrink-0", SECTION_DOT[s.key as keyof typeof SECTION_DOT])} />
                <span className="text-sm text-zinc-300 flex-1 text-left">
                  {s.key} <span className="text-zinc-600 ml-1 text-xs num">·{s.count}</span>
                </span>
                <span className="num text-sm text-zinc-200">{inrCompact(s.amount)}</span>
                {(s.count > 0 || showEditList) && (
                  isOpen ? <ChevronUp size={13} className="text-zinc-600 shrink-0" />
                         : <ChevronDown size={13} className="text-zinc-600 shrink-0" />
                )}
              </button>

              {isOpen && (
                <div className="ml-5 mt-0.5 mb-2 pl-2 border-l border-zinc-800 flex flex-col">
                  {s.key === "Subscriptions" && (
                    showEditList ? (
                      <EditList<Subscription>
                        items={subscriptions}
                        getKey={x => x.id}
                        addLabel="Add subscription"
                        emptyDraft={() => ({ name: "", amount: 0, billing_cycle: "monthly", due_day: 1, category: "Other" })}
                        onSave={async (draft, original) => {
                          if (original) {
                            await api.updateObligation(original.id, {
                              name: draft.name, amount: Number(draft.amount),
                              due_day: Number(draft.due_day), frequency: draft.billing_cycle as any,
                              category: draft.category,
                            });
                          } else {
                            await api.createObligation({
                              type: "subscription", name: draft.name, amount: Number(draft.amount),
                              due_day: Number(draft.due_day), frequency: draft.billing_cycle as any,
                              category: draft.category,
                            } as any);
                          }
                          onRefetch();
                        }}
                        onDelete={async (sub) => { await api.deleteObligation(sub.id); onRefetch(); }}
                        renderView={sub => (
                          <Row
                            label={
                              <span className="flex flex-col">
                                <span className="text-sm">{sub.name}</span>
                                <span className="text-[10px] text-zinc-600">{sub.billing_cycle} · {sub.category}</span>
                              </span>
                            }
                            value={inrCompact(sub.amount)}
                          />
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
                              <Field label="Billing">
                                <select className={inputCls} value={d.billing_cycle ?? "monthly"}
                                        onChange={e => set({ ...d, billing_cycle: e.target.value as any })}>
                                  <option value="monthly">Monthly</option>
                                  <option value="yearly">Yearly</option>
                                  <option value="weekly">Weekly</option>
                                </select>
                              </Field>
                              <Field label="Due day">
                                <input className={inputCls} type="number" min={1} max={31} value={String(d.due_day ?? 1)}
                                       onChange={e => set({ ...d, due_day: Number(e.target.value) })} />
                              </Field>
                              <Field label="Category">
                                <input className={inputCls} value={d.category ?? ""}
                                       onChange={e => set({ ...d, category: e.target.value })} />
                              </Field>
                            </FieldGrid>
                          </>
                        )}
                      />
                    ) : (
                      subscriptions.map(sub => (
                        <Row key={sub.id}
                          label={
                            <span className="flex flex-col">
                              <span className="text-sm">{sub.name}</span>
                              <span className="text-[10px] text-zinc-600">{sub.billing_cycle} · {sub.category}</span>
                            </span>
                          }
                          value={inrCompact(sub.amount)}
                        />
                      ))
                    )
                  )}

                  {s.key === "EMIs" && (
                    showEditList ? (
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
                          <Row
                            label={
                              <span className="flex flex-col">
                                <span className="text-sm">{emi.name}</span>
                                <span className="text-[10px] text-zinc-600 num">
                                  {emi.lender} · {emi.paid_months}/{emi.total_months}
                                </span>
                              </span>
                            }
                            value={inrCompact(emi.amount)}
                          />
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
                    ) : (
                      emis.map(emi => (
                        <Row key={emi.id}
                          label={
                            <span className="flex flex-col">
                              <span className="text-sm">{emi.name}</span>
                              <span className="text-[10px] text-zinc-600 num">
                                {emi.lender} · {emi.paid_months}/{emi.total_months}
                              </span>
                            </span>
                          }
                          value={inrCompact(emi.amount)}
                        />
                      ))
                    )
                  )}

                  {s.key === "Card mins" && cards.map(c => (
                    <Row key={c.id}
                      label={
                        <span className="flex flex-col">
                          <span className="text-sm">{c.name}</span>
                          {c.last4 && <span className="text-[10px] text-zinc-600 num">···· {c.last4}</span>}
                        </span>
                      }
                      value={inrCompact(c.minimum_due)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
