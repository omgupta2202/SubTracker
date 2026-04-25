import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a number as ₹X,XX,XXX (Indian numbering system) */
export function formatINR(amount: number): string {
  return "₹" + amount.toLocaleString("en-IN");
}

/**
 * Given a due_day (1-31), return the next Date on or after today
 * that matches that day — handles month rollover correctly.
 */
export function nextDueDate(dueDay: number): Date {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const candidate = new Date(year, month, dueDay);
  if (candidate < today) {
    // Roll to next month
    return new Date(year, month + 1, dueDay);
  }
  return candidate;
}

/** Days from today to a target date (can be negative if past) */
export function daysUntil(target: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const t = new Date(target);
  t.setHours(0, 0, 0, 0);
  return Math.round((t.getTime() - today.getTime()) / 86_400_000);
}

/**
 * Scroll an element into view and play the 3-pulse violet highlight.
 * Used when a notification redirects to a dashboard section so the user
 * doesn't lose track of where the scroll landed.
 *
 * Looks up the element by `[data-card-id="…"]` because Dashboard tags
 * each rendered card slot that way.
 */
export function flashCard(cardId: string): void {
  // Defer to next frame so React has committed any state that toggled the
  // card visible (e.g. restoring a hidden card before flashing it).
  requestAnimationFrame(() => {
    const el = document.querySelector(
      `[data-card-id="${cardId}"]`,
    ) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // Remove any prior animation so re-clicking the same notification
    // restarts the pulse from frame 0.
    el.classList.remove("flash-target");
    void el.offsetWidth; // force reflow so the class re-add restarts the keyframes
    el.classList.add("flash-target");
    window.setTimeout(() => el.classList.remove("flash-target"), 2200);
  });
}
