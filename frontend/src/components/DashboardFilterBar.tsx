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
  asOfDate: "",
};

export function loadFilters(): DashboardFilters {
  try { return { ...DEFAULT_FILTERS, ...JSON.parse(localStorage.getItem(FILTER_KEY) ?? "{}") }; }
  catch { return DEFAULT_FILTERS; }
}

export function saveFilters(f: DashboardFilters) {
  localStorage.setItem(FILTER_KEY, JSON.stringify(f));
}

export function isFilterActive(f: DashboardFilters): boolean {
  return !!f.asOfDate;
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

      {/* As-of date */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-zinc-500">As Of</label>
        <input
          type="date"
          value={filters.asOfDate}
          onChange={e => set({ asOfDate: e.target.value })}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-violet-500 transition-colors"
        />
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

    </div>
  );
}
