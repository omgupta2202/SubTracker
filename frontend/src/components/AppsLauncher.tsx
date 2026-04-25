import { useState } from "react";
import { createPortal } from "react-dom";
import { Grid3x3, Users, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { navigate } from "@/lib/router";

/**
 * Apps launcher in the dashboard header.
 *
 * Each app is a real route. Clicking an item performs an actual URL
 * navigation (e.g. /trips) so the user can bookmark it, share the link,
 * or open it directly without going through the dashboard.
 *
 * Today: only "Trips". Adding a new app is a one-liner here + a route
 * branch in App.tsx.
 */
const APPS = [
  {
    id:    "trips",
    label: "Trips",
    hint:  "Split expenses with friends",
    href:  "/trips",
    icon:  Users,
  },
] as const;

export function AppsLauncher() {
  const [menuOpen, setMenuOpen] = useState(false);

  function go(href: string) {
    setMenuOpen(false);
    navigate(href);
  }

  return (
    <>
      <button
        onClick={() => setMenuOpen(v => !v)}
        title="Apps"
        className={cn(
          "p-2 rounded-lg transition-colors relative",
          menuOpen
            ? "bg-zinc-800 text-zinc-100 border border-zinc-700"
            : "text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800/70 border border-transparent",
        )}
      >
        <Grid3x3 size={16} />
      </button>

      {/*
        Portal to document.body so the dropdown's `position: fixed` is
        relative to the viewport — not the dashboard header, which has
        backdrop-filter and would otherwise clip us.
      */}
      {menuOpen && createPortal(
        <>
          <button
            type="button"
            aria-label="Close apps menu"
            className="fixed inset-0 z-[60] cursor-default"
            onClick={() => setMenuOpen(false)}
          />
          <div className="fixed right-6 top-[60px] w-64 z-[70] rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl overflow-hidden">
            <div className="px-3 py-2 border-b border-zinc-800/60">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500">Apps</span>
            </div>
            <div className="p-1.5">
              {APPS.map(a => {
                const Icon = a.icon;
                return (
                  <a
                    key={a.id}
                    href={a.href}
                    onClick={(e) => {
                      // Plain anchor: middle-click / Cmd+click open in a new tab.
                      // Plain left-click is intercepted for SPA navigation.
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                      e.preventDefault();
                      go(a.href);
                    }}
                    className="w-full flex items-center gap-3 px-2.5 py-2 rounded-md hover:bg-zinc-800/70 text-left text-zinc-100 no-underline"
                  >
                    <span className="h-8 w-8 rounded-lg bg-violet-500/15 border border-violet-500/30 flex items-center justify-center text-violet-300 shrink-0">
                      <Icon size={14} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <div className="text-sm text-zinc-100">{a.label}</div>
                      <div className="text-[11px] text-zinc-500 truncate">{a.hint}</div>
                    </span>
                    <ChevronDown size={12} className="text-zinc-600 -rotate-90" />
                  </a>
                );
              })}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
