/**
 * ResizableGrid — flush 2D resizable panel grid.
 *
 * Three drag handle types:
 *   VSplitter  — vertical line between columns  → col-resize cursor
 *   HSplitter  — horizontal line between rows   → row-resize cursor
 *   Corner     — intersection dot               → move cursor (resizes BOTH)
 *
 * All state (widths per row, heights) lives in the root so corner handles
 * can touch both dimensions at once.
 */
import React, { useRef, useCallback, useState } from "react";
import { cn } from "@/lib/utils";

// ── constants ──────────────────────────────────────────────────────────────
const SP       = 6;    // splitter hit-area px (both axes)
const MIN_W    = 240;  // min card width px
const MIN_H    = 100;  // min row height px
const CORNER   = SP;   // corner handle size px

// ── types ──────────────────────────────────────────────────────────────────
export interface CardSlot { id: string; widthPct: number; node: React.ReactNode; }

interface Props {
  slots: CardSlot[];
  cols?: number;
  rowHeights?: number[];
  className?: string;
  onWidthChange: (id: string, pct: number) => void;
  onRowHeightChange?: (rowIndex: number, px: number) => void;
}

// ── helpers ────────────────────────────────────────────────────────────────
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
function evenPcts(n: number) {
  const b = Math.floor(100 / n), r = 100 - b * n;
  return Array.from({ length: n }, (_, i) => b + (i < r ? 1 : 0));
}
function norm(ws: number[]) {
  const s = ws.reduce((a, b) => a + b, 0);
  return s === 0 ? evenPcts(ws.length) : ws.map(w => (w / s) * 100);
}
function cellCorner(ri: number, ci: number, rows: number, cols: number) {
  const tl = ri===0&&ci===0, tr = ri===0&&ci===cols-1;
  const bl = ri===rows-1&&ci===0, br = ri===rows-1&&ci===cols-1;
  if (tl&&tr&&bl&&br) return "rounded-2xl";
  if (tl&&tr) return "rounded-t-2xl"; if (bl&&br) return "rounded-b-2xl";
  if (tl&&bl) return "rounded-l-2xl"; if (tr&&br) return "rounded-r-2xl";
  if (tl) return "rounded-tl-2xl"; if (tr) return "rounded-tr-2xl";
  if (bl) return "rounded-bl-2xl"; if (br) return "rounded-br-2xl";
  return "";
}

// ── Root ───────────────────────────────────────────────────────────────────
export function ResizableGrid({ slots, cols = 3, rowHeights = [], className, onWidthChange, onRowHeightChange }: Props) {
  const rows      = chunk(slots, cols);
  const totalRows = rows.length;
  const gridRef   = useRef<HTMLDivElement>(null);

  // widths[ri] = pct array for row ri
  const [widths, setWidths] = useState<number[][]>(() =>
    rows.map(row => {
      const raw = row.map(s => s.widthPct > 0 ? s.widthPct : 0);
      return raw.some(w => w > 0) ? norm(raw) : evenPcts(row.length);
    })
  );
  const [heights, setHeights] = useState<number[]>(() =>
    rows.map((_, i) => rowHeights[i] ?? 0)
  );

  // ── shared drag state ──
  type DragState = {
    type: "v" | "h" | "corner";
    rowIdx: number;
    colIdx: number;   // for v/corner: left card index
    startX: number;
    startY: number;
    startWidths: number[];
    startH: number;
    totalPx: number;  // usable row width px
  };
  const drag = useRef<DragState | null>(null);

  // DOM helpers — get card cells for a specific row
  function getRowCards(ri: number): HTMLElement[] {
    if (!gridRef.current) return [];
    return Array.from(gridRef.current.querySelectorAll<HTMLElement>(`[data-row="${ri}"][data-card-cell]`));
  }

  const onMove = useCallback((e: MouseEvent) => {
    if (!drag.current) return;
    const d = drag.current;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;

    // ── horizontal (width) ──
    if (d.type === "v" || d.type === "corner") {
      const dPct = (dx / d.totalPx) * 100;
      const next = [...d.startWidths];
      next[d.colIdx]     = d.startWidths[d.colIdx] + dPct;
      next[d.colIdx + 1] = d.startWidths[d.colIdx + 1] - dPct;
      const minPct = (MIN_W / d.totalPx) * 100;
      if (next[d.colIdx] < minPct)   { next[d.colIdx] = minPct;   next[d.colIdx+1] = d.startWidths[d.colIdx]+d.startWidths[d.colIdx+1]-minPct; }
      if (next[d.colIdx+1] < minPct) { next[d.colIdx+1] = minPct; next[d.colIdx]   = d.startWidths[d.colIdx]+d.startWidths[d.colIdx+1]-minPct; }
      getRowCards(d.rowIdx).forEach((el, i) => { el.style.width = `${next[i]}%`; });
    }

    // ── vertical (height) ──
    if (d.type === "h" || d.type === "corner") {
      const nextH = Math.max(MIN_H, d.startH + dy);
      const rowEl = gridRef.current?.querySelector<HTMLElement>(`[data-row-wrapper="${d.rowIdx}"]`);
      if (rowEl) rowEl.style.height = `${nextH}px`;
    }
  }, []);

  const onUp = useCallback(() => {
    if (!drag.current) return;
    const d = drag.current;

    // persist widths
    if (d.type === "v" || d.type === "corner") {
      const cards = getRowCards(d.rowIdx);
      const newWidths = cards.map(el => parseFloat(el.style.width)).filter(n => !isNaN(n));
      if (newWidths.length === rows[d.rowIdx].length) {
        setWidths(prev => { const w = [...prev]; w[d.rowIdx] = newWidths; return w; });
        rows[d.rowIdx].forEach((slot, i) => onWidthChange(slot.id, newWidths[i]));
      }
    }

    // persist height
    if (d.type === "h" || d.type === "corner") {
      const rowEl = gridRef.current?.querySelector<HTMLElement>(`[data-row-wrapper="${d.rowIdx}"]`);
      const h = rowEl ? parseFloat(rowEl.style.height) : 0;
      if (!isNaN(h) && h > 0) {
        setHeights(prev => { const hs = [...prev]; hs[d.rowIdx] = h; return hs; });
        onRowHeightChange?.(d.rowIdx, h);
      }
    }

    drag.current = null;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, [onMove, onWidthChange, onRowHeightChange, rows]);

  function startDrag(e: React.MouseEvent, type: DragState["type"], rowIdx: number, colIdx: number) {
    e.preventDefault();
    if (!gridRef.current) return;
    const rowEl = gridRef.current.querySelector<HTMLElement>(`[data-row-wrapper="${rowIdx}"]`);
    const rowW  = rowEl?.getBoundingClientRect().width ?? 0;
    const splitterTotal = (rows[rowIdx].length - 1) * SP;
    drag.current = {
      type, rowIdx, colIdx,
      startX: e.clientX, startY: e.clientY,
      startWidths: [...widths[rowIdx]],
      startH: heights[rowIdx] || (rowEl?.getBoundingClientRect().height ?? 400),
      totalPx: rowW - splitterTotal,
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = type === "v" ? "col-resize" : type === "h" ? "row-resize" : "move";
    document.body.style.userSelect = "none";
  }

  return (
    <div ref={gridRef} className={cn("flex flex-col overflow-hidden rounded-2xl border border-zinc-800", className)}>
      {rows.map((row, ri) => (
        <div key={ri} className="flex flex-col">

          {/* ── Row wrapper ── */}
          <div
            data-row-wrapper={ri}
            className="flex w-full"
            style={heights[ri] > 0 ? { height: heights[ri], overflow: "hidden" } : {}}
          >
            {row.map((slot, ci) => (
              <React.Fragment key={slot.id}>
                {/* Card cell */}
                <div
                  data-card-cell
                  data-row={ri}
                  style={{ width: `${widths[ri][ci]}%`, minWidth: MIN_W, flexShrink: 0, height: "100%" }}
                  className={cn("overflow-hidden min-h-0", cellCorner(ri, ci, totalRows, row.length))}
                >
                  <div className="h-full overflow-y-auto overflow-x-hidden min-h-0 [&>div]:rounded-none [&>div]:border-0 [&>div]:h-full">
                    {slot.node}
                  </div>
                </div>

                {/* Vertical splitter + corner handle */}
                {ci < row.length - 1 && (
                  <div
                    key={`vs-${ci}`}
                    style={{ width: SP, flexShrink: 0 }}
                    className="relative flex items-center justify-center self-stretch z-20"
                  >
                    {/* V-splitter line (full height) */}
                    <div
                      onMouseDown={e => startDrag(e, "v", ri, ci)}
                      className="group absolute inset-0 flex items-center justify-center cursor-col-resize"
                    >
                      <div className="w-px h-full bg-zinc-800 group-hover:bg-violet-500 transition-colors duration-150" />
                    </div>

                    {/* Corner handle — only if there's a row below */}
                    {ri < totalRows - 1 && (
                      <CornerHandle
                        onMouseDown={e => startDrag(e, "corner", ri, ci)}
                      />
                    )}
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>

          {/* ── Horizontal splitter between rows ── */}
          {ri < rows.length - 1 && (
            <div
              style={{ height: SP }}
              className="relative w-full flex items-center z-20"
            >
              {/* H-splitter line (full width, behind corners) */}
              <div
                onMouseDown={e => startDrag(e, "h", ri, 0)}
                className="group absolute inset-0 flex items-center cursor-row-resize"
              >
                <div className="w-full h-px bg-zinc-800 group-hover:bg-violet-500 transition-colors duration-150" />
                {/* Grip dots */}
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-[3px] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  {[0,1,2,3].map(d => <div key={d} className="w-[3px] h-[3px] rounded-full bg-violet-400" />)}
                </div>
              </div>
            </div>
          )}

        </div>
      ))}
    </div>
  );
}

// ── Corner handle ──────────────────────────────────────────────────────────
function CornerHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      style={{ width: CORNER + 4, height: CORNER + 4 }}
      className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 z-30
                 flex items-center justify-center cursor-move group"
      title="Drag to resize width & height"
    >
      {/* Dot — the intersection marker */}
      <div className="w-2 h-2 rounded-full bg-zinc-700 border border-zinc-600
                      group-hover:bg-violet-500 group-hover:border-violet-400
                      group-hover:scale-125 transition-all duration-150 shadow-md" />
    </div>
  );
}
