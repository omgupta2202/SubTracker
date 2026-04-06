import { RotateCcw, SlidersHorizontal } from "lucide-react";
import type { DashboardFilters } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  filters: DashboardFilters;
  onChange: (f: DashboardFilters) => void;
  active: boolean;
}

const FILTER_KEY = "dashboard-filters";

export const DEFAULT_FILTERS: DashboardFilters = {
  dateFrom: "",
  dateTo: "",
  includeBilled: true,
  includeUnbilled: true,
};

export function loadFilters(): DashboardFilters {
  try { return { ...DEFAULT_FILTERS, ...JSON.parse(localStorage.getItem(FILTER_KEY) ?? "{}") }; }
  catch { return DEFAULT_FILTERS; }
}

export function saveFilters(f: DashboardFilters) {
  localStorage.setItem(FILTER_KEY, JSON.stringify(f));
}

export function isFilterActive(f: DashboardFilters): boolean {
  return !!(f.dateFrom || f.dateTo || !f.includeBilled || !f.includeUnbilled);
}

export function DashboardFilterBar({ filters, onChange, active }: Props) {
  function set(patch: Partial<DashboardFilters>) {
    const next = { ...filters, ...patch };
    onChange(next);
    saveFilters(next);
  }

  function reset() {
    onChange(DEFAULT_FILTERS);
    saveFilters(DEFAULT_FILTERS);
  }

  return (
    <div className={cn(
      "flex flex-wrap items-center gap-3 px-4 py-3 rounded-2xl border transition-colors",
      active
        ? "bg-violet-950/30 border-violet-500/30"
        : "bg-zinc-900/60 border-zinc-800",
    )}>
      <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 uppercase tracking-wide mr-1">
        <SlidersHorizontal size={13} />
        Filter
      </div>

      {/* Date range */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-zinc-500">From</label>
        <input
          type="date"
          value={filters.dateFrom}
          onChange={e => set({ dateFrom: e.target.value })}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-violet-500 transition-colors"
        />
        <label className="text-xs text-zinc-500">To</label>
        <input
          type="date"
          value={filters.dateTo}
          onChange={e => set({ dateTo: e.target.value })}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-violet-500 transition-colors"
        />
      </div>

      {/* Billed / Unbilled toggles */}
      <div className="flex items-center gap-1 bg-zinc-800 rounded-lg p-0.5 border border-zinc-700">
        <button
          onClick={() => set({ includeBilled: !filters.includeBilled })}
          className={cn(
            "px-3 py-1 rounded-md text-xs font-medium transition-colors",
            filters.includeBilled
              ? "bg-violet-600 text-white"
              : "text-zinc-500 hover:text-zinc-300",
          )}
        >
          Billed
        </button>
        <button
          onClick={() => set({ includeUnbilled: !filters.includeUnbilled })}
          className={cn(
            "px-3 py-1 rounded-md text-xs font-medium transition-colors",
            filters.includeUnbilled
              ? "bg-violet-600 text-white"
              : "text-zinc-500 hover:text-zinc-300",
          )}
        >
          Unbilled
        </button>
      </div>

      {/* Reset */}
      {active && (
        <button
          onClick={reset}
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200 transition-colors ml-auto"
        >
          <RotateCcw size={11} />
          Reset
        </button>
      )}

      {/* Neither selected warning */}
      {!filters.includeBilled && !filters.includeUnbilled && (
        <span className="text-xs text-amber-400 ml-1">No transaction type selected — CC total will show as —</span>
      )}
    </div>
  );
}
