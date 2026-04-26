/**
 * Dashboard layout store — persisted in localStorage, scoped per user.
 *
 * State:
 *   columns: which column each card lives in (3 columns on desktop).
 *   hidden:  which cards are hidden from the dashboard entirely.
 *
 * The card order within each column is the array order; reordering is just
 * splicing within / between these arrays.
 *
 * Why per-user: a shared device used by multiple SubTracker accounts would
 * otherwise stomp on each other's hide/show + reorder state every login.
 */

const KEY_PREFIX = "subtracker:dashboard-layout:v3";
const LEGACY_KEY = "subtracker:dashboard-layout:v2";

function keyFor(userId?: string | null): string {
  return userId ? `${KEY_PREFIX}:${userId}` : KEY_PREFIX;
}

export type CardId =
  | "net-worth"
  | "cash-flow"
  | "seven-day"
  | "monthly-burn"
  | "emi-progress"
  | "capex"
  | "receivables";

export type ColumnId = "col0" | "col1" | "col2";
export const COLUMN_IDS: ColumnId[] = ["col0", "col1", "col2"];

export const ALL_CARDS: { id: CardId; label: string }[] = [
  { id: "net-worth",    label: "Net worth" },
  { id: "cash-flow",    label: "Cash flow" },
  { id: "seven-day",    label: "7-day horizon" },
  { id: "monthly-burn", label: "Monthly burn" },
  { id: "emi-progress", label: "EMI progress" },
  { id: "capex",        label: "Planned CapEx" },
  { id: "receivables",  label: "Receivables" },
];

export interface Layout {
  columns: Record<ColumnId, CardId[]>;
  hidden:  CardId[];
}

const DEFAULT_LAYOUT: Layout = {
  columns: {
    col0: ["net-worth",  "monthly-burn", "receivables"],
    col1: ["cash-flow",  "emi-progress"],
    col2: ["seven-day",  "capex"],
  },
  hidden: [],
};

/** Healing read — guarantees every CardId appears exactly once across columns or hidden.
 *  Pass `userId` to scope the layout per account. If a user-scoped key is
 *  missing but the legacy v2 key exists, we migrate it on first load. */
export function loadLayout(userId?: string | null): Layout {
  try {
    const k = keyFor(userId);
    let raw = localStorage.getItem(k);
    if (!raw && userId) {
      // First load on this account — migrate the previous shared layout
      // (if any) so existing users don't lose their tweaks.
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        localStorage.setItem(k, legacy);
        raw = legacy;
      }
    }
    if (!raw) return clone(DEFAULT_LAYOUT);
    const parsed = JSON.parse(raw) as Partial<Layout>;
    return reconcile(parsed);
  } catch {
    return clone(DEFAULT_LAYOUT);
  }
}

export function saveLayout(layout: Layout, userId?: string | null) {
  localStorage.setItem(keyFor(userId), JSON.stringify(layout));
}

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

function reconcile(p: Partial<Layout>): Layout {
  const out: Layout = clone(DEFAULT_LAYOUT);
  const seen = new Set<CardId>();

  if (p.columns) {
    for (const c of COLUMN_IDS) out.columns[c] = [];
    for (const c of COLUMN_IDS) {
      const list = (p.columns as any)[c];
      if (Array.isArray(list)) {
        for (const id of list) {
          if (isCardId(id) && !seen.has(id)) {
            out.columns[c].push(id);
            seen.add(id);
          }
        }
      }
    }
  }
  if (Array.isArray(p.hidden)) {
    out.hidden = [];
    for (const id of p.hidden) {
      if (isCardId(id) && !seen.has(id)) {
        out.hidden.push(id);
        seen.add(id);
      }
    }
  } else {
    out.hidden = [];
  }

  // Any card that wasn't placed anywhere — append to col0 so the user never
  // ends up with a missing card after a corrupted persisted state.
  for (const meta of ALL_CARDS) {
    if (!seen.has(meta.id)) out.columns.col0.push(meta.id);
  }
  return out;
}

function isCardId(x: any): x is CardId {
  return ALL_CARDS.some(c => c.id === x);
}

/** Find which column an id is in (or null if hidden / missing). */
export function findColumn(layout: Layout, id: CardId): ColumnId | null {
  for (const c of COLUMN_IDS) {
    if (layout.columns[c].includes(id)) return c;
  }
  return null;
}

export function hideCard(layout: Layout, id: CardId): Layout {
  const next = clone(layout);
  for (const c of COLUMN_IDS) {
    next.columns[c] = next.columns[c].filter(x => x !== id);
  }
  if (!next.hidden.includes(id)) next.hidden.push(id);
  return next;
}

export function restoreCard(layout: Layout, id: CardId): Layout {
  const next = clone(layout);
  next.hidden = next.hidden.filter(x => x !== id);
  // Restore to the smallest column for visual balance.
  let target: ColumnId = "col0";
  let bestLen = next.columns.col0.length;
  for (const c of COLUMN_IDS) {
    if (next.columns[c].length < bestLen) {
      bestLen = next.columns[c].length;
      target = c;
    }
  }
  next.columns[target].push(id);
  return next;
}

/**
 * Move a card. Used by both same-column reorder and cross-column drag.
 *
 * `overId` may be:
 *   - another CardId       → insert before that card in its column
 *   - a ColumnId           → append to that column (drop on empty space)
 */
export function moveCard(
  layout: Layout,
  activeId: CardId,
  overId: CardId | ColumnId,
): Layout {
  const next = clone(layout);
  const fromCol = findColumn(next, activeId);
  if (!fromCol) return layout;

  // Pull active out
  next.columns[fromCol] = next.columns[fromCol].filter(x => x !== activeId);

  // Determine target column + index
  let toCol: ColumnId;
  let toIdx: number;

  if (isColumnId(overId)) {
    toCol = overId;
    toIdx = next.columns[toCol].length;
  } else {
    toCol = findColumn(next, overId) ?? fromCol;
    toIdx = next.columns[toCol].indexOf(overId);
    if (toIdx < 0) toIdx = next.columns[toCol].length;
  }

  next.columns[toCol].splice(toIdx, 0, activeId);
  return next;
}

export function isColumnId(x: any): x is ColumnId {
  return x === "col0" || x === "col1" || x === "col2";
}
