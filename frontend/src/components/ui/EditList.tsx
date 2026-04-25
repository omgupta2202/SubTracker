import * as React from "react";
import { useState } from "react";
import { Plus, Trash2, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * EditList — generic "tap to edit, X to remove, + to add" pattern.
 *
 * Usage philosophy:
 *   - View row and edit row are RENDERED IN PLACE. No drawer, no modal.
 *   - When the user clicks a row, it morphs into the edit form for that row.
 *   - When the user clicks "Add", a new edit form appears at the bottom.
 *   - Save commits + collapses; cancel discards + collapses.
 *   - One row open at a time — keeps the visual weight low.
 */

export interface EditListProps<T> {
  items: T[];
  /** stable key — usually `i.id`. */
  getKey: (item: T) => string;
  /** read-only renderer for an item row. */
  renderView: (item: T) => React.ReactNode;
  /** edit form for an existing item; receives a draft + setDraft. */
  renderEditForm: (
    draft: Partial<T>,
    setDraft: (next: Partial<T>) => void,
  ) => React.ReactNode;
  /** seed for a brand-new item. */
  emptyDraft: () => Partial<T>;
  onSave:   (draft: Partial<T>, original: T | null) => Promise<void>;
  onDelete?: (item: T) => Promise<void>;
  /** label for the add button — e.g. "Add subscription". */
  addLabel?: string;
  /** "no items yet" placeholder. */
  emptyState?: React.ReactNode;
  /** when false, hides the add button (e.g. for singleton entities like rent). */
  canAdd?: boolean;
}

export function EditList<T>({
  items, getKey, renderView, renderEditForm, emptyDraft,
  onSave, onDelete, addLabel = "Add", emptyState, canAdd = true,
}: EditListProps<T>) {
  // openKey: id of an item being edited, "__new__" for the new-item form, null = collapsed.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<T>>({});
  const [busy, setBusy]   = useState(false);

  function startEdit(item: T) {
    setDraft({ ...item });
    setOpenKey(getKey(item));
  }
  function startAdd() {
    setDraft(emptyDraft());
    setOpenKey("__new__");
  }
  function cancel() {
    setOpenKey(null);
    setDraft({});
  }
  async function save(original: T | null) {
    setBusy(true);
    try {
      await onSave(draft, original);
      cancel();
    } finally {
      setBusy(false);
    }
  }
  async function remove(item: T) {
    if (!onDelete) return;
    if (!confirm("Delete this entry?")) return;
    setBusy(true);
    try {
      await onDelete(item);
      cancel();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col">
      {items.length === 0 && !emptyState ? null : (
        <>
          {items.map(item => {
            const k = getKey(item);
            const isOpen = openKey === k;
            return isOpen ? (
              <EditRow
                key={k}
                busy={busy}
                onSave={() => save(item)}
                onCancel={cancel}
                onDelete={onDelete ? () => remove(item) : undefined}
              >
                {renderEditForm(draft, setDraft)}
              </EditRow>
            ) : (
              <button
                key={k}
                onClick={() => startEdit(item)}
                className="w-full text-left -mx-2 px-2 py-0.5 rounded-md hover:bg-zinc-800/30 transition-colors"
              >
                {renderView(item)}
              </button>
            );
          })}
          {items.length === 0 && emptyState && <div>{emptyState}</div>}
        </>
      )}

      {openKey === "__new__" && (
        <EditRow
          busy={busy}
          onSave={() => save(null)}
          onCancel={cancel}
        >
          {renderEditForm(draft, setDraft)}
        </EditRow>
      )}

      {canAdd && openKey !== "__new__" && (
        <button
          onClick={startAdd}
          className={cn(
            "mt-2 self-start inline-flex items-center gap-1.5",
            "text-xs text-violet-400 hover:text-violet-300 transition-colors",
          )}
        >
          <Plus size={12} /> {addLabel}
        </button>
      )}
    </div>
  );
}

function EditRow({
  children, busy, onSave, onCancel, onDelete,
}: {
  children: React.ReactNode;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="my-1 -mx-2 px-3 py-3 rounded-lg bg-zinc-800/40 border border-zinc-700/60 flex flex-col gap-2.5">
      {children}
      <div className="flex items-center justify-between pt-1.5 border-t border-zinc-700/40">
        {onDelete ? (
          <button
            onClick={onDelete}
            disabled={busy}
            className="inline-flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300 disabled:opacity-40"
          >
            <Trash2 size={11} /> Delete
          </button>
        ) : <span />}
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
          >
            <X size={11} /> Cancel
          </button>
          <button
            onClick={onSave}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-medium disabled:opacity-50"
          >
            <Check size={11} /> {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Form field primitives — minimal, no IField/IGrid hangover ─────────── */

export const inputCls =
  "w-full bg-zinc-900 border border-zinc-700/70 rounded px-2 py-1.5 " +
  "text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none " +
  "focus:border-violet-500/60 focus:ring-1 focus:ring-violet-500/30";

export function Field({
  label, children, span = 1,
}: { label: string; children: React.ReactNode; span?: 1 | 2 }) {
  return (
    <label className={cn("flex flex-col gap-1", span === 2 && "col-span-2")}>
      <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">{label}</span>
      {children}
    </label>
  );
}

export function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-3 gap-y-2">{children}</div>;
}
