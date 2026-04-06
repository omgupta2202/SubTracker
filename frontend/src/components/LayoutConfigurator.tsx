import { useRef } from "react";
import { X, GripVertical, Eye, EyeOff } from "lucide-react";
import type { CardConfig, CardId } from "@/types";
import { toggleCard, reorderCards, saveLayout } from "@/store/layoutStore";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  layout: CardConfig[];
  onLayoutChange: (layout: CardConfig[]) => void;
}

export function LayoutConfigurator({ open, onClose, layout, onLayoutChange }: Props) {
  const dragIndex = useRef<number | null>(null);

  function handleToggle(id: CardId) {
    const next = toggleCard(layout, id);
    saveLayout(next);
    onLayoutChange(next);
  }

  function handleDragStart(index: number) {
    dragIndex.current = index;
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (dragIndex.current === null || dragIndex.current === index) return;
    const next = reorderCards(layout, dragIndex.current, index);
    dragIndex.current = index;
    saveLayout(next);
    onLayoutChange(next);
  }

  function handleDragEnd() {
    dragIndex.current = null;
  }

  if (!open) return null;

  const sorted = [...layout].sort((a, b) => a.order - b.order);

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-72 bg-zinc-900 border-l border-zinc-800 z-50 flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div>
            <h2 className="text-base font-bold text-zinc-100">Layout</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Drag to reorder · eye to show/hide</p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-100 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-3 px-3 flex flex-col gap-1.5">
          {sorted.map((card, i) => (
            <div
              key={card.id}
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDragEnd={handleDragEnd}
              className={cn(
                "flex items-center gap-2 rounded-xl border px-3 py-2.5 cursor-grab active:cursor-grabbing transition-colors",
                card.visible
                  ? "bg-zinc-800/60 border-zinc-700/50 hover:border-zinc-600"
                  : "bg-zinc-900/40 border-zinc-800/50 opacity-40"
              )}
            >
              <GripVertical size={14} className="text-zinc-600 shrink-0" />
              <span className={cn("flex-1 text-sm font-medium", card.visible ? "text-zinc-200" : "text-zinc-500")}>
                {card.label}
              </span>
              <button
                onClick={() => handleToggle(card.id)}
                className={cn(
                  "transition-colors shrink-0",
                  card.visible ? "text-violet-400 hover:text-violet-300" : "text-zinc-600 hover:text-zinc-400"
                )}
              >
                {card.visible ? <Eye size={15} /> : <EyeOff size={15} />}
              </button>
            </div>
          ))}
        </div>

        <div className="px-4 py-3 border-t border-zinc-800">
          <p className="text-xs text-zinc-600 text-center">Drag splitters on the dashboard to resize</p>
        </div>
      </div>
    </>
  );
}
