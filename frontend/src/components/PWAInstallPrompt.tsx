import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

/**
 * Custom PWA install prompt.
 *
 * Browsers fire `beforeinstallprompt` (Chrome / Edge / Samsung) when the
 * site meets installability criteria. We capture the event, show a slim
 * bottom banner, and wire the user's "Install" tap to the saved prompt.
 *
 * If the user dismisses, we set a localStorage flag so we don't nag.
 * If they install, the event won't fire again anyway.
 *
 * Safari (iOS) doesn't support `beforeinstallprompt`. For iOS we show a
 * one-line "Add to Home Screen" hint via the share menu — only on first
 * load on a non-installed iOS Safari.
 */

const DISMISS_KEY = "subtracker:pwa-prompt-dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PWAInstallPrompt() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) === "1") return;
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    // (navigator as any).standalone is iOS Safari's standalone flag
    if ((navigator as any).standalone) return;

    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
      setShow(true);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // iOS fallback — detect Safari mobile, show after a short delay so it
    // doesn't compete with login page focus.
    const ua = navigator.userAgent;
    const isIos      = /iPhone|iPad|iPod/.test(ua) && !/CriOS|FxiOS/.test(ua);
    if (isIos) {
      const t = setTimeout(() => setIosHint(true), 2500);
      return () => {
        clearTimeout(t);
        window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      };
    }

    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setShow(false);
    setIosHint(false);
  }

  async function install() {
    if (!evt) return;
    await evt.prompt();
    const choice = await evt.userChoice;
    setEvt(null);
    setShow(false);
    if (choice.outcome === "dismissed") {
      // give them a soft nag-cooldown rather than a permanent dismissal
      // — the next visit will try again.
    }
  }

  if (!show && !iosHint) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[110] w-[min(92vw,420px)]">
      <div className="rounded-2xl border border-violet-500/30 bg-zinc-900/95 backdrop-blur shadow-2xl px-4 py-3 flex items-center gap-3">
        <div className="h-9 w-9 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center text-violet-300 shrink-0">
          <Download size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-zinc-100">Install SubTracker</div>
          <div className="text-[11px] text-zinc-500">
            {show
              ? "Quick access from your home screen, works offline."
              : "Tap Share → Add to Home Screen to install."}
          </div>
        </div>
        {show && (
          <button
            onClick={install}
            className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shrink-0"
          >
            Install
          </button>
        )}
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/70 shrink-0"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
