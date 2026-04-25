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
      {/* Drag handle — hover-revealed, doesn't shift card layout */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        title="Drag to reorder"
        aria-label="Drag handle"
        className={cn(
          "absolute top-3 left-3 z-10 p-1 rounded-md cursor-grab active:cursor-grabbing",
          "text-zinc-600 hover:text-zinc-200 hover:bg-zinc-800/70",
          "opacity-0 group-hover/sortable:opacity-100 transition-opacity",
          "touch-none",
        )}
      >
        <GripVertical size={13} />
      </button>
      {children}
    </div>
  );
}
