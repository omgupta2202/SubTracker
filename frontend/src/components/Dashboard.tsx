import { useState, useCallback } from "react";
import { Settings, PlusCircle, History, LogOut } from "lucide-react";
import { useAuth } from "@/modules/auth";
import { useSubscriptions } from "@/hooks/useSubscriptions";
import { useEmis } from "@/hooks/useEmis";
import { useCards } from "@/hooks/useCards";
import { useAccounts } from "@/hooks/useAccounts";
import { useReceivables } from "@/hooks/useReceivables";
import { useCapex } from "@/hooks/useCapex";
import { useRent } from "@/hooks/useRent";
import { useSmartAllocation } from "@/hooks/useSmartAllocation";
import { usePeriodSummary } from "@/hooks/useFilteredCCTotal";
import { loadLayout, saveLayout, setCardWidth, setRowHeight, getRowHeights } from "@/store/layoutStore";
import type { CardConfig, DashboardFilters } from "@/types";
import { MonthlyBurnCard } from "./MonthlyBurnCard";
import { SevenDayHorizonCard } from "./SevenDayHorizonCard";
import { EmiProgressCard } from "./EmiProgressCard";
import { NetWorthCard } from "./NetWorthCard";
import { CashFlowCard } from "./CashFlowCard";
import { CapExCard } from "./CapExCard";
import { CrudDrawer } from "./CrudDrawer";
import { HistoryPanel } from "./HistoryPanel";
import { LayoutConfigurator } from "./LayoutConfigurator";
import { ResizableGrid } from "./ResizableGrid";
import { DashboardFilterBar, loadFilters, isFilterActive } from "./DashboardFilterBar";

export function Dashboard() {
  const { logout, user } = useAuth();
  const { subscriptions, refetch: rSub }  = useSubscriptions();
  const { emis, refetch: rEmi }           = useEmis();
  const { cards, refetch: rCard }         = useCards();
  const { accounts, refetch: rAcc }       = useAccounts();
  const { receivables, refetch: rRec }    = useReceivables();
  const { capex, refetch: rCapex }        = useCapex();
  const { rent, refetch: rRent }          = useRent();
  const { data: allocation, loading: lAlloc, refetch: rAlloc } = useSmartAllocation();

  const [layout, setLayout] = useState<CardConfig[]>(() => {
    const stored = loadLayout();
    if (!stored.find(c => c.id === "capex")) {
      localStorage.removeItem("subtracker-layout");
      return loadLayout();
    }
    return stored;
  });

  const [drawerOpen, setDrawerOpen]   = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [configOpen, setConfigOpen]   = useState(false);
  const [drawerTab, setDrawerTab]     = useState<CardConfig["id"] | undefined>();
  const [filters, setFilters] = useState<DashboardFilters>(loadFilters);

  const openDrawer = (tab?: string) => {
    setDrawerTab(tab as any);
    setDrawerOpen(true);
  };
  const filterActive = isFilterActive(filters);
  const { summary: periodSummary } = usePeriodSummary(filters, filterActive);

  function refetchAll() {
    void rSub(); void rEmi(); void rCard();
    void rAcc(); void rRec(); void rCapex();
    void rRent(); void rAlloc();
  }

  const handleWidthChange = useCallback((id: string, pct: number) => {
    setLayout(prev => {
      const next = setCardWidth(prev, id, pct);
      saveLayout(next);
      return next;
    });
  }, []);

  const handleRowHeightChange = useCallback((rowIndex: number, px: number) => {
    setLayout(prev => {
      const next = setRowHeight(prev, rowIndex, px, 3);
      saveLayout(next);
      return next;
    });
  }, []);

  const sorted = [...layout]
    .sort((a, b) => a.order - b.order)
    .filter(c => c.visible);

  const cardMap: Record<string, React.ReactNode> = {
    "net-worth":    <NetWorthCard accounts={accounts} cards={cards} rent={allocation?.summary.rent ?? 0} onRefetch={refetchAll} onManageAccounts={() => openDrawer("accounts")} />,
    "cash-flow":    <CashFlowCard data={allocation} loading={lAlloc} periodSummary={filterActive ? periodSummary : null} />,
    "capex":        <CapExCard items={capex} availableAfterCC={allocation?.summary.net_after_cc ?? 0} onRefetch={refetchAll} />,
    "monthly-burn": <MonthlyBurnCard subscriptions={subscriptions} emis={emis} cards={cards} onRefetch={refetchAll} />,
    "seven-day":    <SevenDayHorizonCard subscriptions={subscriptions} emis={emis} cards={cards} />,
    "emi-progress": <EmiProgressCard emis={emis} onRefetch={refetchAll} />,
  };

  const slots = sorted.map(c => ({
    id: c.id,
    widthPct: c.widthPct ?? 0,
    node: cardMap[c.id],
  }));

  return (
    <div className="min-h-screen bg-zinc-950 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100 tracking-tight">SubTracker</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Financial dashboard · March / April</p>
        </div>
        <div className="flex items-center gap-3">
          <History size={18} className="text-zinc-500 cursor-pointer hover:text-zinc-300 transition-colors" onClick={() => setHistoryOpen(true)} />
          {user && (
            <div 
              className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-zinc-800/50 cursor-pointer transition-colors group"
              onClick={() => openDrawer("profile")}
            >
              <div className="w-7 h-7 rounded-full bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400 group-hover:border-violet-500/50 transition-colors">
                {user.avatar_url ? (
                  <img src={user.avatar_url} alt={user.name || ""} className="w-full h-full rounded-full object-cover" />
                ) : (
                  <span className="text-xs font-bold uppercase">{(user.name || user.email)[0]}</span>
                )}
              </div>
              <span className="text-sm text-zinc-400 group-hover:text-zinc-200 hidden sm:block">
                {user.name || user.email}
              </span>
            </div>
          )}
          <button
            onClick={logout}
            className="flex items-center gap-2 bg-zinc-800 hover:bg-red-900/40 text-zinc-400 hover:text-red-400 px-3 py-2 rounded-xl text-sm font-medium transition-colors border border-zinc-700"
            title="Sign out"
          >
            <LogOut size={16} />
          </button>
          <button
            onClick={() => setHistoryOpen(true)}
            className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100 px-4 py-2 rounded-xl text-sm font-medium transition-colors border border-zinc-700"
          >
            <History size={16} />
            History
          </button>
          <button
            onClick={() => openDrawer()}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
          >
            <PlusCircle size={16} />
            Manage Data
          </button>
          <button
            onClick={() => setConfigOpen(true)}
            className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 transition-colors border border-zinc-700"
          >
            <Settings size={18} />
          </button>
        </div>
      </div>

      {/* Filter bar — scoped to CC Outstanding in Cash Flow */}
      <div className="mb-4">
        <DashboardFilterBar filters={filters} onChange={setFilters} active={filterActive} />
      </div>

      <ResizableGrid
        slots={slots}
        cols={3}
        rowHeights={getRowHeights(layout, 3)}
        onWidthChange={handleWidthChange}
        onRowHeightChange={handleRowHeightChange}
        className="shadow-2xl"
      />

      <CrudDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        initialTab={drawerTab as any}
        user={user}
        onUserUpdate={(u) => {
          localStorage.setItem("auth_user", JSON.stringify(u));
          window.location.reload(); // Refresh to update all references
        }}
        onLogout={logout}
        subscriptions={subscriptions}
        emis={emis}
        cards={cards}
        accounts={accounts}
        receivables={receivables}
        capex={capex}
        rent={rent}
        onRefetch={refetchAll}
      />

      <HistoryPanel
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />

      <LayoutConfigurator
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        layout={layout}
        onLayoutChange={setLayout}
      />
    </div>
  );
}
