import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Wraps a card with dnd-kit sortable behaviour.
 *
 * Why a wrapper instead of pulling drag into Card itself:
 *   - Card has multiple variants; only the dashboard cares about drag.
 *   - The drag handle appears on hover only, so we add it as decoration here.
 *   - If we ever want a non-draggable Card surface (settings, modals), the
 *     base Card stays clean.
 */
export function SortableCard({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const {
    setNodeRef,
    transform,
    transition,
    listeners,
    attributes,
    isDragging,
  } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "group/sortable relative",
        isDragging && "z-30 opacity-70",
      )}
    >
      {/* Drag handle — floats ON the card's top-left border as a circular
          chip, mirroring the close (X) chip on the right. Never overlaps
          card content because it sits outside the padding. */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        title="Drag to reorder"
        aria-label="Drag handle"
        className={cn(
          "absolute -top-2 -left-2 z-20 cursor-grab active:cursor-grabbing",
          "h-6 w-6 rounded-full flex items-center justify-center",
          "bg-zinc-800 border border-zinc-700/80 shadow",
          "text-zinc-300 hover:text-white hover:bg-zinc-700",
          "opacity-70 group-hover/sortable:opacity-100 transition-opacity",
          "touch-none",
        )}
      >
        <GripVertical size={12} />
      </button>
      {children}
    </div>
  );
}
