/**
 * Design tokens — single source of truth for visual language.
 *
 * Principles enforced here:
 *   - One accent color (violet) reserved for CTAs and "the answer".
 *   - Money is monospace, large, right-aligned. Labels are small + dim.
 *   - Hierarchy by size + weight, not by background nesting.
 *   - 9-step neutral ramp. Surface = zinc-950, content = zinc-100,
 *     mute = zinc-500. No more nested zinc-800-inside-zinc-900.
 *
 * Usage on web:
 *   className={cn(text.numHero, text.right)}
 *   style={{ color: c.text.primary }}
 *
 * Usage on mobile: import the same JSON via `mobile/constants/tokens.ts`.
 */

export const c = {
  surface: {
    bg:        "rgb(9 9 11)",          // zinc-950 — page
    panel:     "rgb(24 24 27)",        // zinc-900 — flat card
    panelMute: "rgb(39 39 42)",        // zinc-800 — subtle inset (used sparingly)
    line:      "rgb(39 39 42)",        // zinc-800 — divider
    overlay:   "rgba(0,0,0,0.65)",
  },
  text: {
    primary:   "rgb(244 244 245)",     // zinc-100 — headlines, money
    secondary: "rgb(212 212 216)",     // zinc-300 — secondary numbers
    muted:     "rgb(113 113 122)",     // zinc-500 — labels
    faint:     "rgb(82  82  91)",      // zinc-600 — hints
  },
  accent: {
    base:      "rgb(139 92  246)",     // violet-500 — CTA, "answer"
    fg:        "rgb(255 255 255)",
    soft:      "rgba(139,92,246,0.12)",
    softBorder:"rgba(139,92,246,0.30)",
  },
  good:        "rgb(34 197 94)",       // emerald-500 — gain
  bad:         "rgb(239 68 68)",       // red-500 — loss
  warn:        "rgb(245 158 11)",      // amber-500 — attention
} as const;

/**
 * Typography. Tailwind classes — copy-paste into JSX directly.
 * Numeric helpers always set `font-mono tabular-nums` so columns align.
 */
export const text = {
  // Money / metrics
  numHero:    "font-mono tabular-nums text-4xl font-semibold tracking-tight",
  numLarge:   "font-mono tabular-nums text-2xl font-semibold tracking-tight",
  numMedium:  "font-mono tabular-nums text-base font-medium",
  numSmall:   "font-mono tabular-nums text-sm",
  numTiny:    "font-mono tabular-nums text-xs",
  // Labels
  labelLg:    "text-sm font-medium",
  label:      "text-xs font-medium uppercase tracking-wider text-zinc-500",
  caption:    "text-xs text-zinc-500",
  // Body
  body:       "text-sm text-zinc-300",
  // Layout helpers
  right:      "text-right",
  truncate:   "truncate",
} as const;

/** Spacing scale — same as tailwind, just named so design intent is explicit. */
export const space = {
  cardPad:    "p-5",      // 20px
  cardPadLg:  "p-6",      // 24px
  rowGap:     "gap-3",    // 12px between content rows
  stack:      "gap-2",    // 8px tight stack
  section:    "gap-6",    // 24px between sections
} as const;

/** Card surface — flat panel, no nested boxes. */
export const card = {
  base: "rounded-2xl bg-zinc-900 border border-zinc-800/60",
  hero: "rounded-2xl bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800/60",
  hover:"transition-colors hover:border-zinc-700",
} as const;

/** Status pill colors — keyed by semantic, not hue. */
export function statusColor(kind: "good" | "bad" | "warn" | "muted") {
  switch (kind) {
    case "good":   return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
    case "bad":    return "text-red-400 bg-red-500/10 border-red-500/20";
    case "warn":   return "text-amber-400 bg-amber-500/10 border-amber-500/20";
    case "muted":  return "text-zinc-400 bg-zinc-800/60 border-zinc-700/60";
  }
}

/** Format helpers used everywhere. Compact form keeps cards from wrapping. */
const inrFmt    = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inrFmtDec = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

export function inr(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return "₹" + inrFmt.format(Math.round(n));
}

export function inrCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 10_000_000) return `${sign}₹${inrFmtDec.format(abs / 10_000_000)}Cr`;
  if (abs >= 100_000)    return `${sign}₹${inrFmtDec.format(abs / 100_000)}L`;
  if (abs >= 1_000)      return `${sign}₹${inrFmtDec.format(abs / 1_000)}k`;
  return `${sign}₹${inrFmt.format(abs)}`;
}

export function pct(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

export function relativeDay(daysAway: number): string {
  if (daysAway === 0)       return "today";
  if (daysAway === 1)       return "tomorrow";
  if (daysAway === -1)      return "yesterday";
  if (daysAway > 0)         return `in ${daysAway}d`;
  return `${Math.abs(daysAway)}d ago`;
}

/** "32s ago", "5m ago", "3h ago", "2d ago", "Mar 14" — for past timestamps. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const sec = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (sec < 60)      return `${sec}s ago`;
  if (sec < 3600)    return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400)   return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 604800)  return `${Math.floor(sec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}

/** "14 Mar 2026, 3:42 pm" — full local timestamp for tooltips. */
export function fullTimestamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}
