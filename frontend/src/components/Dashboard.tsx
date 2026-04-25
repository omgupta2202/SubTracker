import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors,
  closestCorners, DragOverlay, useDroppable, type DragEndEvent, type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { SortableCard } from "@/components/ui/SortableCard";
import {
  ALL_CARDS, type CardId, type ColumnId,
  loadLayout, saveLayout, hideCard, restoreCard, moveCard,
  findColumn, isColumnId,
} from "@/lib/layoutStore";
import {
  History, BellRing, SlidersHorizontal,
  Plus, LogOut, Search, User as UserIcon,
} from "lucide-react";
import { useAuth } from "@/modules/auth";
import { useSubscriptions } from "@/hooks/useSubscriptions";
import { useEmis } from "@/hooks/useEmis";
import { useCards } from "@/hooks/useCards";
import { useAccounts } from "@/hooks/useAccounts";
import { useReceivables } from "@/hooks/useReceivables";
import { useCapex } from "@/hooks/useCapex";
import { useRent } from "@/hooks/useRent";
import { useSmartAllocation } from "@/hooks/useSmartAllocation";
import { useDashboard } from "@/hooks/useDashboard";
import { usePeriodSummary } from "@/hooks/useFilteredCCTotal";
import type { DashboardFilters } from "@/types";
import { MonthlyBurnCard } from "./MonthlyBurnCard";
import { SevenDayHorizonCard } from "./SevenDayHorizonCard";
import { EmiProgressCard } from "./EmiProgressCard";
import { NetWorthCard } from "./NetWorthCard";
import { CashFlowCard } from "./CashFlowCard";
import { CapExCard } from "./CapExCard";
import { ReceivablesCard } from "./ReceivablesCard";
import { CardDetailDrawer } from "./CardDetailDrawer";
import { AppSwitcher } from "./AppSwitcher";
import { DashboardPulse } from "./DashboardPulse";
import { HistoryPanel } from "./HistoryPanel";
import { DashboardFilterBar, loadFilters, isFilterActive } from "./DashboardFilterBar";
import { AttentionSection } from "./AttentionSection";
import { RecurringSuggestionsStrip } from "./RecurringSuggestionsStrip";
import { CommandPalette } from "./CommandPalette";
import { cn, flashCard } from "@/lib/utils";

export function Dashboard() {
  const { logout, user } = useAuth();
  const { subscriptions, refetch: rSub }  = useSubscriptions();
  const { emis, refetch: rEmi }           = useEmis();
  const { cards, refetch: rCard }         = useCards();
  const { accounts, refetch: rAcc }       = useAccounts();
  const { receivables, refetch: rRec }    = useReceivables();
  const { capex, refetch: rCapex }        = useCapex();
  const { rent, refetch: rRent }          = useRent();
  const { data: allocation, refetch: rAlloc } = useSmartAllocation();
  const { summary: dashSummary, loading: lDash, refetch: rDash } = useDashboard();

  const [historyOpen, setHistoryOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [activeCard, setActiveCard] = useState<{ id: string; name: string; last4: string | null; bank: string | null } | null>(null);
  const [filters, setFilters] = useState<DashboardFilters>(loadFilters);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [layout, setLayout] = useState(() => loadLayout(user?.id));
  const [activeDragId, setActiveDragId] = useState<CardId | null>(null);

  // Account switch on the same browser → re-hydrate that user's layout.
  useEffect(() => {
    setLayout(loadLayout(user?.id));
  }, [user?.id]);

  function commitLayout(next: typeof layout) {
    setLayout(next);
    saveLayout(next, user?.id);
  }
  function hide(id: CardId)    { commitLayout(hideCard(layout, id));    }
  function restore(id: CardId) { commitLayout(restoreCard(layout, id)); }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragOver(ev: DragOverEvent) {
    const activeId = ev.active.id as CardId;
    const overId   = ev.over?.id as CardId | ColumnId | undefined;
    if (!overId || activeId === overId) return;

    const fromCol = findColumn(layout, activeId);
    const toCol   = isColumnId(overId) ? overId : findColumn(layout, overId);
    if (!fromCol || !toCol || fromCol === toCol) return;

    // Cross-column move during drag — gives live visual feedback
    commitLayout(moveCard(layout, activeId, overId));
  }
  function handleDragEnd(ev: DragEndEvent) {
    setActiveDragId(null);
    const activeId = ev.active.id as CardId;
    const overId   = ev.over?.id as CardId | ColumnId | undefined;
    if (!overId || activeId === overId) return;
    commitLayout(moveCard(layout, activeId, overId));
  }

  const filterActive = isFilterActive(filters);
  const { summary: periodSummary, loading: periodLoading } = usePeriodSummary(filters, filterActive);

  function refetchAll() {
    void rSub(); void rEmi(); void rCard();
    void rAcc(); void rRec(); void rCapex();
    void rRent(); void rAlloc(); void rDash();
  }

  function closeAllPopovers() {
    setAttentionOpen(false);
    setFilterOpen(false);
    setProfileOpen(false);
  }
  const anyPopoverOpen = attentionOpen || filterOpen || profileOpen;

  const monthLabel = new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const attentionCount = dashSummary?.attention_items?.length ?? 0;

  /** Render a card by id — single source of truth so column ordering can be
      driven entirely from the layout state. Used by both the live grid and
      the drag overlay preview. */
  function renderCard(id: CardId) {
    switch (id) {
      case "net-worth":
        return (
          <NetWorthCard
            accounts={dashSummary?.accounts ?? accounts}
            cards={dashSummary?.credit_cards ?? cards.map(c => ({
              id: c.id, name: c.name, last4: c.last4,
              outstanding: c.outstanding, minimum_due: c.minimum_due,
            }))}
            rent={rent.amount}
            rentDueDay={rent.due_day}
            onRefetch={refetchAll}
            onHide={() => hide("net-worth")}
            onOpenCard={(c) => setActiveCard({
              id: c.id,
              name: c.name,
              last4: c.last4 ?? null,
              bank: (c as any).bank ?? null,
            })}
          />
        );
      case "cash-flow":
        return (
          <CashFlowCard
            dashboardSummary={dashSummary}
            dashboardLoading={lDash}
            allocation={allocation}
            periodSummary={filterActive ? periodSummary : null}
            periodLoading={filterActive ? periodLoading : false}
            onHide={() => hide("cash-flow")}
          />
        );
      case "seven-day":
        return (
          <SevenDayHorizonCard
            upcomingDues={dashSummary?.upcoming_dues_7d}
            subscriptions={subscriptions}
            emis={emis}
            cards={cards}
            onHide={() => hide("seven-day")}
          />
        );
      case "monthly-burn":
        return (
          <MonthlyBurnCard
            subscriptions={subscriptions}
            emis={emis}
            cards={cards}
            monthlyBurn={dashSummary?.monthly_burn}
            monthlyBurnBaseline={dashSummary?.monthly_burn_baseline}
            monthlyBurnProjected={dashSummary?.monthly_burn_projected}
            monthlyBurnTrendPct={dashSummary?.monthly_burn_trend_pct ?? null}
            onRefetch={refetchAll}
            onHide={() => hide("monthly-burn")}
          />
        );
      case "emi-progress":
        return <EmiProgressCard emis={emis} onRefetch={refetchAll} onHide={() => hide("emi-progress")} />;
      case "capex":
        return (
          <CapExCard
            items={capex}
            availableAfterCC={dashSummary?.net_after_cc ?? allocation?.summary.net_after_cc ?? 0}
            onRefetch={refetchAll}
            onHide={() => hide("capex")}
          />
        );
      case "receivables":
        return <ReceivablesCard receivables={receivables} onRefetch={refetchAll} onHide={() => hide("receivables")} />;
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 relative">
      {/* Ambient backdrop — subtle violet/fuchsia glow at the top to give
          the dashboard a 2026'ish gradient horizon without affecting any
          existing card layout below it. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[420px] overflow-hidden">
        <div className="absolute -top-40 left-1/3 w-[640px] h-[640px] rounded-full bg-violet-500/10 blur-3xl" />
        <div className="absolute -top-32 -right-24 w-[480px] h-[480px] rounded-full bg-fuchsia-500/10 blur-3xl" />
      </div>

      {/* Header — three groups: brand · search · actions. Groups are
          separated by tiny vertical dividers so the row reads as
          structured rather than cluttered. */}
      <header className="relative sticky top-0 z-20 backdrop-blur-md bg-zinc-950/85 border-b border-zinc-800/60">
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center gap-3">
          {/* Group 1 — brand */}
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-base font-semibold tracking-tight text-zinc-100">SubTracker</h1>
            <span className="hidden sm:inline text-[11px] text-zinc-500">{monthLabel}</span>
          </div>

          {/* Group 2 — search (compact) */}
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex-1 max-w-sm ml-4 hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg
                       bg-zinc-900/60 border border-zinc-800 hover:border-zinc-700
                       text-zinc-500 hover:text-zinc-300 text-[13px] transition-colors"
          >
            <Search size={12} />
            <span className="flex-1 text-left truncate">Search or add anything…</span>
            <kbd className="hidden lg:inline text-[10px] font-mono text-zinc-600 border border-zinc-700/60 rounded px-1.5 py-0.5">⌘K</kbd>
          </button>

          {/* Group 3 — actions, visually grouped with a left divider */}
          <div className="flex items-center gap-0.5 ml-auto pl-3 border-l border-zinc-800/60">
            <IconBtn
              onClick={() => {
                setAttentionOpen(v => !v);
                setFilterOpen(false);
                setProfileOpen(false);
              }}
              active={attentionOpen}
              badge={attentionCount}
              title="Attention"
            >
              <BellRing size={16} />
            </IconBtn>

            <IconBtn
              onClick={() => {
                setFilterOpen(v => !v);
                setAttentionOpen(false);
                setProfileOpen(false);
              }}
              active={filterActive || filterOpen}
              accent={filterActive}
              title="Filters"
            >
              <SlidersHorizontal size={16} />
            </IconBtn>

            <IconBtn onClick={() => setHistoryOpen(true)} title="History">
              <History size={16} />
            </IconBtn>

            <AppSwitcher current="dashboard" />

            {/* Group 4 — primary action + user, separated by a divider */}
            <div className="flex items-center gap-1 ml-2 pl-2 border-l border-zinc-800/60">
              <button
                onClick={() => setPaletteOpen(true)}
                title="Quickly add a transaction, subscription, EMI, or any item (⌘K)"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors shadow-lg shadow-violet-600/25 ring-1 ring-violet-400/20"
              >
                <Plus size={15} />
                <span className="hidden sm:inline">Add</span>
              </button>

              {user && (
                <button
                  onClick={() => {
                    setProfileOpen(v => !v);
                    setAttentionOpen(false);
                    setFilterOpen(false);
                  }}
                  className={cn(
                    "ml-1 flex items-center pl-0.5 pr-0.5 py-0.5 rounded-full transition-colors",
                    profileOpen ? "bg-zinc-800" : "hover:bg-zinc-800/70",
                  )}
                  title={user.email}
                >
                  <span className="w-7 h-7 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center text-violet-300 text-[11px] font-bold uppercase overflow-hidden">
                    {user.avatar_url
                      ? <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                      : (user.name || user.email)[0]}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/*
        Popover layer — rendered as fixed siblings of the header, NOT inside it.
        This avoids stacking-context wars: the sticky header creates its own
        z-context, and any z-index on children of the header is bounded by it.
        Lifting these elements to the dashboard root means z-[60] / z-[70]
        actually mean what they say.
      */}
      {anyPopoverOpen && (
        <button
          type="button"
          onClick={() => closeAllPopovers()}
          aria-label="Close popover"
          className="fixed inset-0 z-[60] cursor-default"
        />
      )}
      {attentionOpen && (
        <div className="fixed right-6 top-[60px] w-[380px] z-[70]">
          <AttentionSection
            items={dashSummary?.attention_items ?? []}
            loading={lDash && !dashSummary}
            embedded
            onActed={() => closeAllPopovers()}
            onOpenCard={(accountId, title) => {
              const meta = (dashSummary?.credit_cards ?? []).find(c => c.id === accountId);
              const fallback = cards.find(c => c.id === accountId);
              setActiveCard({
                id:    accountId,
                name:  (meta as any)?.name ?? fallback?.name ?? title,
                last4: (meta as any)?.last4 ?? fallback?.last4 ?? null,
                bank:  (meta as any)?.bank  ?? (fallback as any)?.bank ?? null,
              });
              // Flash the Net Worth card behind the drawer so the user can
              // see context if they close the drawer right away.
              flashCard("net-worth");
            }}
            onOpenObligations={() => flashCard("monthly-burn")}
          />
        </div>
      )}
      {filterOpen && (
        <div className="fixed right-6 top-[60px] w-[min(92vw,520px)] z-[70] rounded-2xl border border-zinc-800 bg-zinc-900 p-3 shadow-2xl">
          <DashboardFilterBar filters={filters} onChange={setFilters} active={filterActive} />
        </div>
      )}
      {profileOpen && user && (
        <div className="fixed right-6 top-[60px] w-64 z-[70] rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl overflow-hidden">
          <div className="px-3 py-2.5 border-b border-zinc-800">
            <div className="text-sm text-zinc-100 truncate">{user.name || "—"}</div>
            <div className="text-[11px] text-zinc-500 truncate">{user.email}</div>
          </div>
          <div className="p-1">
            <MenuItem icon={<UserIcon size={13} />} onClick={() => closeAllPopovers()}>
              Profile
            </MenuItem>
            <MenuItem icon={<LogOut size={13} />} onClick={logout} danger>
              Sign out
            </MenuItem>
          </div>
        </div>
      )}

      <div className="relative max-w-[1400px] mx-auto px-6 py-6">
        <DashboardPulse summary={dashSummary} loading={lDash} />

        <RecurringSuggestionsStrip onConverted={refetchAll} />

        {/*
          Drag-and-drop masonry. Three independent columns; cards reorder
          within a column or move between columns. Column widths are
          unequal on desktop to give wider cards more room — cross-column
          drag still works because each column is a separate droppable.
        */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={(ev) => setActiveDragId(ev.active.id as CardId)}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveDragId(null)}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-5 items-start">
            <DroppableColumn id="col0" className="lg:col-span-5"
              cardIds={layout.columns.col0}
              renderCard={renderCard}
            />
            <DroppableColumn id="col1" className="lg:col-span-4"
              cardIds={layout.columns.col1}
              renderCard={renderCard}
            />
            <DroppableColumn id="col2" className="lg:col-span-3"
              cardIds={layout.columns.col2}
              renderCard={renderCard}
            />
          </div>

          {/* Floating preview during drag — keeps the original card visible
              with a slight transform so the user has a clear target. */}
          <DragOverlay dropAnimation={null}>
            {activeDragId ? (
              <div className="opacity-90 scale-[1.02] rotate-[-0.5deg] shadow-2xl">
                {renderCard(activeDragId)}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {/* Restore strip */}
        {layout.hidden.length > 0 && (
          <div className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 flex items-center gap-3 flex-wrap">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 inline-flex items-center gap-1.5">
              <Eye size={12} /> Hidden ({layout.hidden.length})
            </span>
            {ALL_CARDS.filter(c => layout.hidden.includes(c.id)).map(c => (
              <button
                key={c.id}
                onClick={() => restore(c.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg
                           bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/60
                           text-xs text-zinc-300 hover:text-zinc-100 transition-colors"
              >
                {c.label}
                <span className="text-violet-400">+</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <HistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onCreated={() => refetchAll()}
      />

      <CardDetailDrawer
        cardId={activeCard?.id ?? null}
        cardName={activeCard?.name ?? null}
        cardLast4={activeCard?.last4 ?? null}
        cardBank={activeCard?.bank ?? null}
        accounts={accounts}
        onClose={() => setActiveCard(null)}
        onChange={refetchAll}
      />
    </div>
  );
}

function IconBtn({
  onClick, children, title, active = false, accent = false, badge = 0,
}: {
  onClick: () => void;
  children: React.ReactNode;
  title: string;
  active?: boolean;
  accent?: boolean;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "relative p-2 rounded-lg transition-colors",
        active
          ? accent
            ? "bg-violet-500/15 text-violet-300 border border-violet-500/30"
            : "bg-zinc-800 text-zinc-100 border border-zinc-700"
          : "text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800/70 border border-transparent",
      )}
    >
      {children}
      {badge > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-1 rounded-full bg-red-500 text-white text-[9px] num leading-3 text-center">
          {Math.min(badge, 9)}
        </span>
      )}
    </button>
  );
}

function DroppableColumn({
  id, cardIds, renderCard, className,
}: {
  id: ColumnId;
  cardIds: CardId[];
  renderCard: (id: CardId) => React.ReactNode;
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
        {cardIds.map(cardId => (
          // data-card-id lets external code (e.g. the notification list)
          // scroll the dashboard to a specific card via querySelector.
          <div key={cardId} data-card-id={cardId} className="rounded-2xl">
            <SortableCard id={cardId}>
              {renderCard(cardId)}
            </SortableCard>
          </div>
        ))}
      </SortableContext>
      {/* Empty drop zone — receives drags when the column has no children
          or when the user drops below the last card. Slim and only visible
          on hover-during-drag. */}
      <div
        ref={setNodeRef}
        className={cn(
          "rounded-xl border border-dashed transition-colors",
          cardIds.length === 0 ? "min-h-[120px]" : "min-h-[40px]",
          isOver
            ? "border-violet-500/40 bg-violet-500/5"
            : "border-transparent",
        )}
      >
        {cardIds.length === 0 && (
          <div className="h-full flex items-center justify-center text-xs text-zinc-600 py-8">
            drop a card here
          </div>
        )}
      </div>
    </div>
  );
}

function MenuItem({
  children, icon, onClick, danger = false,
}: {
  children: React.ReactNode; icon: React.ReactNode;
  onClick: () => void; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm transition-colors",
        danger
          ? "text-red-400 hover:bg-red-500/10"
          : "text-zinc-300 hover:bg-zinc-800",
      )}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}
