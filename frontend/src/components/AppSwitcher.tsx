import { useState } from "react";
import { createPortal } from "react-dom";
import { Grid3x3, Wallet, Users, ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { navigate } from "@/lib/router";

/**
 * Cross-app switcher used in the header of both Dashboard and TrackersApp.
 *
 * Why this exists: SubTracker (personal finance dashboard) and Trackers (group
 * splitter) are *sister apps*, not features-of-each-other. The launcher
 * makes that explicit — same surface in each, the "current" app is checked,
 * the "other" app is presented as a CTA the user is encouraged to try.
 *
 * Adding more apps later is a one-liner in the APPS array.
 */
const APPS = [
  {
    id:    "dashboard",
    label: "SubTracker",
    hint:  "Personal finance dashboard",
    href:  "/",
    icon:  Wallet,
  },
  {
    id:    "trackers",
    label: "Expense Tracker",
    hint:  "Split trackers, daily expenses, dinners — anything shared",
    href:  "/trackers",
    icon:  Users,
  },
] as const;

type AppId = typeof APPS[number]["id"];

const LAST_APP_KEY = "subtracker:last-app";

export function AppSwitcher({ current }: { current: AppId }) {
  const [open, setOpen] = useState(false);

  function go(target: { id: AppId; href: string }) {
    setOpen(false);
    // Persist intent immediately so a later bare `/` revisit lands here.
    // App.tsx's persistence effect only stamps "trackers" — for "dashboard"
    // we have to be explicit, otherwise the lastApp would never flip back.
    localStorage.setItem(LAST_APP_KEY, target.id);
    navigate(target.href);
  }

  // The "other" app — the one we're nudging the user toward. We surface
  // it INSIDE the launcher dropdown rather than as a separate inline pill,
  // because the dashboard header already had too many controls competing
  // for attention. The launcher button itself gets a small violet dot to
  // hint that there's more in there to discover.
  const other = APPS.find(a => a.id !== current)!;

  return (
    <>
      <button
        onClick={() => setOpen(v => !v)}
        title={`Switch app · ${other.label} available`}
        className={cn(
          "p-2 rounded-lg transition-colors relative",
          open
            ? "bg-zinc-800 text-zinc-100 border border-zinc-700"
            : "text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800/70 border border-transparent",
        )}
      >
        <Grid3x3 size={16} />
        <span aria-hidden className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-violet-400 ring-2 ring-zinc-950" />
      </button>

      {open && createPortal(
        <>
          <button
            type="button"
            aria-label="Close app switcher"
            className="fixed inset-0 z-[120] cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="fixed right-6 top-[60px] w-72 z-[130] rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl overflow-hidden">
            <div className="px-3 py-2 border-b border-zinc-800/60 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500">Apps</span>
              <span className="text-[10px] text-zinc-600">switch anytime</span>
            </div>
            <div className="p-1.5">
              {APPS.map(a => {
                const Icon = a.icon;
                const isCurrent = a.id === current;
                return (
                  <a
                    key={a.id}
                    href={a.href}
                    onClick={(e) => {
                      // Plain anchor: middle-click / Cmd+click open in a new tab.
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                      e.preventDefault();
                      go(a);
                    }}
                    className={cn(
                      "w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-left no-underline transition-colors",
                      isCurrent
                        ? "bg-zinc-800/60"
                        : "hover:bg-zinc-800/70",
                    )}
                  >
                    <span className={cn(
                      "h-9 w-9 rounded-lg flex items-center justify-center shrink-0 border",
                      isCurrent
                        ? "bg-zinc-700/60 border-zinc-600 text-zinc-300"
                        : "bg-violet-500/15 border-violet-500/30 text-violet-300",
                    )}>
                      <Icon size={15} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <div className="text-sm text-zinc-100 flex items-center gap-1.5">
                        {a.label}
                        {isCurrent && (
                          <span className="text-[9px] uppercase tracking-wider px-1.5 py-px rounded bg-zinc-700 text-zinc-300">current</span>
                        )}
                      </div>
                      <div className="text-[11px] text-zinc-500 truncate">{a.hint}</div>
                    </span>
                    {isCurrent
                      ? <Check size={13} className="text-emerald-400 shrink-0" />
                      : <ArrowRight size={13} className="text-zinc-600 shrink-0" />}
                  </a>
                );
              })}
            </div>
            <div className="px-3 py-2 border-t border-zinc-800/60 text-[10px] text-zinc-500">
              Two separate apps · same SubTracker account · your layout and trackers are kept independent.
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
