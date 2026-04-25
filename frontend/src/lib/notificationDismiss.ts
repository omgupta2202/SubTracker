/**
 * Local dismiss-store for attention items.
 *
 * Notifications are derived server-side from "things that need attention"
 * (CC bills due soon, obligations coming up). We don't want to mark them
 * "read" on the server — they should reappear once the underlying state
 * actually changes. So dismissal is purely local + scoped to the current
 * "instance" of the notification.
 *
 * Instance identity = the notification's id + due_date. If the same
 * obligation has a new occurrence next month, that's a different due_date
 * → different instance → not auto-dismissed.
 */

const KEY = "subtracker:dismissed-notifications:v1";

interface Stored {
  /** key = `${id}:${dueDate}`, value = ISO timestamp dismissed at */
  [k: string]: string;
}

function load(): Stored {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Stored;
  } catch {
    return {};
  }
}

function save(s: Stored) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

function key(id: string, dueDate: string): string {
  return `${id}:${dueDate}`;
}

export function isDismissed(id: string, dueDate: string): boolean {
  return key(id, dueDate) in load();
}

export function dismiss(id: string, dueDate: string): void {
  const s = load();
  s[key(id, dueDate)] = new Date().toISOString();
  save(s);
}

export function undismiss(id: string, dueDate: string): void {
  const s = load();
  delete s[key(id, dueDate)];
  save(s);
}

/** Drop dismissals older than 30 days so the store doesn't grow forever. */
export function pruneOld(): void {
  const cutoff = Date.now() - 30 * 86_400_000;
  const s = load();
  let changed = false;
  for (const [k, ts] of Object.entries(s)) {
    if (new Date(ts).getTime() < cutoff) {
      delete s[k];
      changed = true;
    }
  }
  if (changed) save(s);
}
