/**
 * Shared inline edit shell used by all dashboard cards.
 * Wraps any item row — on hover shows a pencil, on click
 * replaces the row with a compact form.
 */
import { useState } from "react";
import { Pencil, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ── tiny field primitives (compact, fits inside cards) ─────────────────────

export const iCls =
  "bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 " +
  "focus:outline-none focus:border-violet-500 transition-colors w-full placeholder:text-zinc-600";

export const iSelCls =
  "bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 " +
  "focus:outline-none focus:border-violet-500 transition-colors w-full";

export function IField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-zinc-500">{label}</span>
      {children}
    </div>
  );
}

export function IGrid({ children, cols = 2 }: { children: React.ReactNode; cols?: number }) {
  return (
    <div className={cn("grid gap-2", cols === 2 ? "grid-cols-2" : cols === 3 ? "grid-cols-3" : "grid-cols-1")}>
      {children}
    </div>
  );
}

// ── save / cancel row ──────────────────────────────────────────────────────

export function ISaveCancel({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  return (
    <div className="flex gap-2 pt-1">
      <button
        onClick={onSave}
        className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
      >
        <Check size={12} /> Save
      </button>
      <button
        onClick={onCancel}
        className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 px-3 py-1.5 rounded-lg text-xs transition-colors"
      >
        <X size={12} /> Cancel
      </button>
    </div>
  );
}

// ── hoverable row wrapper ──────────────────────────────────────────────────

interface EditableRowProps {
  editing: boolean;
  onStartEdit: () => void;
  form: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function EditableRow({ editing, onStartEdit, form, children, className }: EditableRowProps) {
  const [hovered, setHovered] = useState(false);

  if (editing) {
    return (
      <div className={cn("rounded-xl bg-zinc-800/80 border border-violet-500/40 p-3 flex flex-col gap-3", className)}>
        {form}
      </div>
    );
  }

  return (
    <div
      className={cn("group relative", className)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      {hovered && (
        <button
          onClick={onStartEdit}
          className="absolute top-1/2 -translate-y-1/2 right-2 p-1.5 rounded-lg bg-zinc-700/80 text-zinc-400 hover:text-violet-400 hover:bg-zinc-700 transition-colors z-10"
        >
          <Pencil size={12} />
        </button>
      )}
    </div>
  );
}
