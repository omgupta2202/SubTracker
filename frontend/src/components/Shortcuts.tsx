import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { navigate } from "@/lib/router";

/**
 * Global keyboard shortcuts.
 *
 * Bindings:
 *   ?            Open this cheatsheet (Shift+/)
 *   /            Focus the global search (Add palette in dashboard)
 *   n            New expense in trackers / new transaction in dashboard
 *   g d          Go to Dashboard (vim-style two-stroke)
 *   g t          Go to Expense Tracker
 *   g s          Go to email Settings
 *   Esc          Close the topmost modal (already handled per-component)
 *
 * Shortcuts are SUPPRESSED while the user is typing into an input,
 * textarea, or contentEditable. The exception is `?` which still works
 * — pressing Shift+/ in a text field would type the `?` character which
 * is what users want, so we don't fire ours.
 *
 * Two-stroke handling: pressing `g` opens a 1.2s window where the next
 * key is treated as a follow-up. Releases automatically.
 */

interface Shortcut {
  keys: string;       // visual label, e.g. "g d" or "?"
  body: string;       // human description
  group: "Global" | "Tracker" | "Dashboard";
}
const SHORTCUTS: Shortcut[] = [
  { keys: "?",   body: "Show this cheatsheet",                                   group: "Global" },
  { keys: "/",   body: "Focus search (or open the Add palette on dashboard)",    group: "Global" },
  { keys: "n",   body: "New expense / new transaction (context-aware)",          group: "Global" },
  { keys: "g d", body: "Go to SubTracker dashboard",                             group: "Global" },
  { keys: "g t", body: "Go to Expense Tracker",                                  group: "Global" },
  { keys: "g s", body: "Go to email settings",                                   group: "Global" },
  { keys: "Esc", body: "Close the topmost modal",                                group: "Global" },
];

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const t = target.tagName;
  if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * Global handler hook — mount once near the app root. The `?` overlay is
 * mounted alongside.
 */
export function ShortcutsProvider() {
  const [helpOpen, setHelpOpen] = useState(false);
  const [pendingG, setPendingG] = useState(false);

  useEffect(() => {
    let pending = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    function clearPending() {
      pending = false;
      setPendingG(false);
      if (timeout) { clearTimeout(timeout); timeout = null; }
    }

    function onKeyDown(e: KeyboardEvent) {
      // `?` opens cheatsheet — but only when NOT typing (so users can
      // type `?` in a search box without us hijacking).
      if (e.key === "?" && !isTyping(e.target)) {
        e.preventDefault();
        setHelpOpen(o => !o);
        return;
      }

      // Don't run the rest while typing.
      if (isTyping(e.target)) return;
      // Ignore if a modifier is held (Cmd+K etc.). Plain keys only.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Two-stroke navigation: press `g`, then within 1.2s press the
      // destination key.
      if (pending) {
        const dest = e.key.toLowerCase();
        clearPending();
        if      (dest === "d") { e.preventDefault(); navigate("/"); }
        else if (dest === "t") { e.preventDefault(); navigate("/trackers"); }
        else if (dest === "s") { e.preventDefault(); navigate("/settings/email"); }
        return;
      }
      if (e.key.toLowerCase() === "g") {
        pending = true;
        setPendingG(true);
        timeout = setTimeout(clearPending, 1200);
        return;
      }

      // Single-key shortcuts.
      switch (e.key) {
        case "/":
          e.preventDefault();
          // Dispatch a global event each surface listens for. Avoids
          // each consumer needing a ref into a shared object.
          window.dispatchEvent(new CustomEvent("subtracker:shortcut", { detail: "search" }));
          break;
        case "n":
        case "N":
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("subtracker:shortcut", { detail: "new" }));
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (timeout) clearTimeout(timeout);
    };
  }, []);

  return (
    <>
      {pendingG && createPortal(
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] px-3 py-1.5 rounded-lg bg-zinc-900/95 border border-zinc-700 text-xs text-zinc-300 shadow-xl">
          <kbd className="px-1.5 py-0.5 mr-1 rounded bg-zinc-800 text-zinc-100 text-[10px] font-mono">g</kbd>
          waiting for <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-100 text-[10px] font-mono">d</kbd> /
          <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-100 text-[10px] font-mono">t</kbd> /
          <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-100 text-[10px] font-mono">s</kbd>
        </div>,
        document.body,
      )}
      {helpOpen && <Cheatsheet onClose={() => setHelpOpen(false)} />}
    </>
  );
}

function Cheatsheet({ onClose }: { onClose: () => void }) {
  // Esc to close — same key contract every other modal uses.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const groups = Array.from(new Set(SHORTCUTS.map(s => s.group)));

  return createPortal(
    <div
      className="fixed inset-0 z-[180] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[min(92vw,520px)] max-h-[85vh] overflow-y-auto rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-900 to-violet-950/40 shadow-2xl shadow-violet-900/30"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/80">
          <div className="flex items-center gap-2">
            <span className="h-7 w-7 rounded-lg bg-violet-500/15 border border-violet-500/30 flex items-center justify-center text-violet-300 text-xs font-mono">⌘</span>
            <h2 className="text-base font-semibold text-zinc-100">Keyboard shortcuts</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/70">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-4">
          {groups.map(g => (
            <section key={g}>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 mb-2 px-1">{g}</div>
              <div className="flex flex-col">
                {SHORTCUTS.filter(s => s.group === g).map(s => (
                  <div key={s.keys}
                       className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-zinc-800/40">
                    <span className="text-sm text-zinc-200">{s.body}</span>
                    <ChordKbd chord={s.keys} />
                  </div>
                ))}
              </div>
            </section>
          ))}
          <p className="text-[11px] text-zinc-500 mt-1 px-2">
            Shortcuts are suppressed while you're typing in a field. <kbd className="px-1 rounded bg-zinc-800 text-zinc-300 font-mono text-[10px]">?</kbd> always toggles this sheet.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ChordKbd({ chord }: { chord: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1")}>
      {chord.split(" ").map((k, i) => (
        <kbd key={i}
             className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-[11px] font-mono">
          {k}
        </kbd>
      ))}
    </span>
  );
}
