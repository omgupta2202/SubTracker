import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  X, ArrowRight, ArrowLeft, Sparkles,
  BarChart3, BellRing, SlidersHorizontal, Plus, Mail,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SubTrackerIcon, ExpenseTrackerIcon } from "@/lib/appIcons";

/**
 * First-login walkthrough — short tour that pops up the first time a user
 * lands on the dashboard, with Skip / Next / Back / Esc-to-skip controls.
 *
 * Persistence model:
 *   - Per-user flag in localStorage (`subtracker:onboarded:<userId>`).
 *   - Set when the user finishes the tour or hits Skip.
 *   - Replayable via the profile menu's "Replay tour" entry, which
 *     calls `replayTour()` to clear the flag.
 *
 * Layout:
 *   - Fixed-bottom-right card on desktop, full-width sheet on mobile.
 *   - Each step has an optional `targetSelector` we briefly outline +
 *     scroll into view, so users see *what* the step is talking about
 *     in their actual UI rather than a screenshot of someone else's.
 *
 * Why not a proper "spotlight" tour library: 6KB component vs +40KB dep.
 * The outline-the-target trick covers 90% of the use-case.
 */

const STORAGE_PREFIX = "subtracker:onboarded:";

interface Step {
  title: string;
  body: string;
  /** Optional CSS selector to highlight. */
  target?: string;
  icon: React.ReactNode;
  /** When set, the step has a non-default primary CTA — e.g. open the
   *  Expense Tracker app instead of just clicking Next. */
  cta?: { label: string; onClick: () => void };
}

const STEPS: Step[] = [
  {
    title: "Welcome to SubTracker 👋",
    body: "Your finance dashboard, two sister apps, one account. Quick tour — under 30 seconds. You can skip anytime.",
    icon: <SubTrackerIcon size={28} className="rounded-md" />,
  },
  {
    title: "Today at a glance",
    body: "Liquid cash, what you owe on cards, monthly burn, what's due this week, what's coming in, and your card utilisation — all on the strip up top.",
    target: "[data-tour='pulse']",
    icon: <BarChart3 size={20} className="text-violet-300" />,
  },
  {
    title: "Quick add anything",
    body: "Press ⌘K (or click the violet Add button) to log a transaction, subscription, EMI or rent payment in two taps. Search hits the same palette.",
    target: "[data-tour='add']",
    icon: <Plus size={20} className="text-violet-300" />,
  },
  {
    title: "Bell, filter, history",
    body: "Bell shows what needs attention. Filter scopes the dashboard to a date range or card. History opens the daily-snapshot timeline so you can compare yesterday vs. last week.",
    target: "[data-tour='actions']",
    icon: <BellRing size={20} className="text-violet-300" />,
  },
  {
    title: "Cards are yours to arrange",
    body: "Drag any card to reorder, drop into another column, or hide it. Layout is per-account, so what you set up stays even if you log in elsewhere.",
    target: "[data-tour='cards']",
    icon: <SlidersHorizontal size={20} className="text-violet-300" />,
  },
  {
    title: "Two apps, one account",
    body: "The 3×3 launcher (top-right) takes you to Expense Tracker — split trips, daily expenses, dinner clubs, anything shared. Same login, separate data.",
    target: "[data-tour='switcher']",
    icon: <ExpenseTrackerIcon size={20} className="rounded" />,
  },
  {
    title: "Email + Gmail sync",
    body: "Avatar menu → Profile to connect Gmail (auto-imports card transactions). Email preferences let you mute the daily digest or invite emails.",
    target: "[data-tour='avatar']",
    icon: <Mail size={20} className="text-violet-300" />,
  },
  {
    title: "All set",
    body: "Hit Done to start. You can replay this tour any time from the avatar menu → Replay tour.",
    icon: <Sparkles size={22} className="text-violet-300" />,
  },
];

function key(userId: string | null | undefined) {
  return STORAGE_PREFIX + (userId ?? "anon");
}

export function shouldShowOnboarding(userId: string | null | undefined): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(key(userId)) !== "1";
}

export function markOnboardingDone(userId: string | null | undefined) {
  localStorage.setItem(key(userId), "1");
}

export function replayTour(userId: string | null | undefined) {
  localStorage.removeItem(key(userId));
  // Soft-reload so the dashboard re-mounts with the tour visible.
  window.dispatchEvent(new CustomEvent("subtracker:replay-tour"));
}

export function Onboarding({ userId, onClose }: { userId: string | null | undefined; onClose: () => void }) {
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  // Highlight the target element for the current step + scroll it into view.
  // We mutate the element's outline directly (vs a portal overlay with a
  // calculated cutout) — much simpler and works across all card types.
  useEffect(() => {
    if (!step.target) return;
    const el = document.querySelector<HTMLElement>(step.target);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const prevOutline = el.style.outline;
    const prevOffset  = el.style.outlineOffset;
    const prevTrans   = el.style.transition;
    el.style.outline       = "2px solid #a78bfa";
    el.style.outlineOffset = "4px";
    el.style.transition    = "outline 240ms ease, outline-offset 240ms ease, box-shadow 240ms ease";
    el.style.boxShadow     = "0 0 0 8px rgba(124,58,237,0.18)";
    return () => {
      el.style.outline       = prevOutline;
      el.style.outlineOffset = prevOffset;
      el.style.transition    = prevTrans;
      el.style.boxShadow     = "";
    };
  }, [stepIndex, step.target]);

  // Esc dismisses. Enter/Right advances, Left goes back.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape")     { e.preventDefault(); finish(true); }
      else if (e.key === "Enter" || e.key === "ArrowRight") {
        e.preventDefault(); next();
      } else if (e.key === "ArrowLeft" && stepIndex > 0) {
        e.preventDefault(); setStepIndex(i => i - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  function next() {
    if (isLast) finish(false);
    else setStepIndex(i => i + 1);
  }
  function finish(skipped: boolean) {
    markOnboardingDone(userId);
    onClose();
    void skipped;
  }

  return createPortal(
    <div className="fixed inset-x-0 bottom-0 z-[150] sm:bottom-6 sm:right-6 sm:left-auto sm:max-w-[400px]">
      <div className="rounded-t-3xl sm:rounded-3xl border border-violet-500/30 bg-gradient-to-br from-zinc-900 via-zinc-900 to-violet-950/40 backdrop-blur-md shadow-2xl shadow-violet-900/40 overflow-hidden">
        {/* Progress bar */}
        <div className="h-[3px] bg-zinc-800/80">
          <div
            className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-400 transition-all"
            style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }}
          />
        </div>

        <div className="p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="h-10 w-10 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center shrink-0">
              {step.icon}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-violet-300 mb-1">
                Step {stepIndex + 1} of {STEPS.length}
              </div>
              <h3 className="text-base font-semibold text-zinc-100 leading-tight">{step.title}</h3>
              <p className="text-sm text-zinc-400 mt-1.5 leading-relaxed">{step.body}</p>
            </div>
            <button
              onClick={() => finish(true)}
              title="Skip the tour (Esc)"
              className="p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/70 shrink-0"
              aria-label="Skip tour"
            >
              <X size={14} />
            </button>
          </div>

          <div className="flex items-center justify-between mt-5">
            <button
              onClick={() => finish(true)}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              Skip tour
            </button>
            <div className="flex items-center gap-2">
              {stepIndex > 0 && (
                <button
                  onClick={() => setStepIndex(i => i - 1)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/70"
                >
                  <ArrowLeft size={11} /> Back
                </button>
              )}
              {step.cta ? (
                <button
                  onClick={step.cta.onClick}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium shadow-lg shadow-violet-600/25"
                >
                  {step.cta.label}
                </button>
              ) : (
                <button
                  onClick={next}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                    "bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-600/25",
                  )}
                >
                  {isLast ? "Done" : "Next"}
                  {!isLast && <ArrowRight size={11} />}
                </button>
              )}
            </div>
          </div>

          {/* Tiny dot navigator — visual progress + click-to-jump */}
          <div className="flex items-center justify-center gap-1.5 mt-4">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStepIndex(i)}
                aria-label={`Go to step ${i + 1}`}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === stepIndex ? "w-5 bg-violet-400" : "w-1.5 bg-zinc-700 hover:bg-zinc-600",
                )}
              />
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Wrapper hook — returns `[shouldShow, dismiss]`. Resubscribes if the
 *  user kicks off a Replay-tour via the profile menu. */
export function useOnboarding(userId: string | null | undefined): [boolean, () => void] {
  const [show, setShow] = useState(() => shouldShowOnboarding(userId));
  // Re-evaluate when the user changes.
  useMemo(() => setShow(shouldShowOnboarding(userId)), [userId]);
  useEffect(() => {
    function onReplay() { setShow(true); }
    window.addEventListener("subtracker:replay-tour", onReplay);
    return () => window.removeEventListener("subtracker:replay-tour", onReplay);
  }, []);
  return [show, () => setShow(false)];
}
