import type { CardConfig, CardId } from "@/types";

const STORAGE_KEY = "subtracker-layout";

const DEFAULT_LAYOUT: CardConfig[] = [
  { id: "net-worth",    label: "Liquidity Snapshot", visible: true, order: 0, colSpan: 1 },
  { id: "cash-flow",   label: "Cash Flow",           visible: true, order: 1, colSpan: 2 },
  { id: "capex",       label: "Planned CapEx",       visible: true, order: 2, colSpan: 1 },
  { id: "monthly-burn",label: "Monthly Burn",        visible: true, order: 3, colSpan: 1 },
  { id: "seven-day",   label: "7-Day Horizon",       visible: true, order: 4, colSpan: 1 },
  { id: "emi-progress",label: "EMI Progress",        visible: true, order: 5, colSpan: 1 },
];

export function loadLayout(): CardConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as CardConfig[];
    const ids = new Set(parsed.map((c) => c.id));
    // backfill colSpan for old saved layouts that predate this field
    const merged = [
      ...parsed.map(c => ({ ...c, colSpan: c.colSpan ?? 1 })),
      ...DEFAULT_LAYOUT.filter((d) => !ids.has(d.id)),
    ];
    return merged;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function saveLayout(layout: CardConfig[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
}

export function toggleCard(layout: CardConfig[], id: CardId): CardConfig[] {
  return layout.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c));
}

export function resizeCard(layout: CardConfig[], id: CardId, colSpan: 1 | 2 | 3): CardConfig[] {
  return layout.map((c) => (c.id === id ? { ...c, colSpan } : c));
}

export function setCardWidth(layout: CardConfig[], id: string, widthPct: number): CardConfig[] {
  return layout.map((c) => (c.id === id ? { ...c, widthPct } : c));
}

export function setRowHeight(
  layout: CardConfig[],
  rowIndex: number,
  px: number,
  cols: number
): CardConfig[] {
  // Store height on the first card of the row
  const sorted  = [...layout].sort((a, b) => a.order - b.order).filter(c => c.visible);
  const firstId = sorted[rowIndex * cols]?.id;
  if (!firstId) return layout;
  return layout.map(c => c.id === firstId ? { ...c, rowHeight: px } : c);
}

export function getRowHeights(layout: CardConfig[], cols: number): number[] {
  const sorted = [...layout].sort((a, b) => a.order - b.order).filter(c => c.visible);
  const rows   = Math.ceil(sorted.length / cols);
  return Array.from({ length: rows }, (_, i) => sorted[i * cols]?.rowHeight ?? 0);
}

export function reorderCards(
  layout: CardConfig[],
  fromIndex: number,
  toIndex: number
): CardConfig[] {
  const next = [...layout];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next.map((c, i) => ({ ...c, order: i }));
}
