import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Flat surface card. No nested boxes — when you need separation inside,
 * use a divider, not another <Card>.
 *
 * Variants:
 *   - default: zinc-900 panel
 *   - hero:    gradient + slightly larger pad, used for the headline number
 *   - mute:    zinc-900/40 — recedes; use for secondary slots
 *
 * onHide: when provided, renders a hover-revealed ✕ in the top-right that
 * lets the user dismiss the card from the dashboard. The card content is
 * unchanged — the X is purely chrome.
 */
type Variant = "default" | "hero" | "mute";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
  bare?: boolean;
  onHide?: () => void;
}

export function Card({ className, variant = "default", bare = false, onHide, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "group relative rounded-2xl border transition-colors",
        variant === "default" && "bg-zinc-900 border-zinc-800/60 hover:border-zinc-700",
        variant === "hero"    && "bg-gradient-to-br from-zinc-900 to-zinc-950 border-zinc-800/60",
        variant === "mute"    && "bg-zinc-900/40 border-zinc-800/40",
        !bare && "p-5",
        className,
      )}
      {...props}
    >
      {onHide && (
        <button
          onClick={(e) => { e.stopPropagation(); onHide(); }}
          title="Hide this section"
          aria-label="Hide section"
          className={cn(
            "absolute top-3 right-3 z-10 p-1 rounded-md",
            "text-zinc-600 hover:text-zinc-200 hover:bg-zinc-800/70",
            "opacity-0 group-hover:opacity-100 transition-opacity",
          )}
        >
          <X size={13} />
        </button>
      )}
      {children}
    </div>
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center justify-between gap-3 mb-4", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, icon, children, ...props }:
  React.HTMLAttributes<HTMLDivElement> & { icon?: React.ReactNode }) {
  return (
    <div className={cn("flex items-center gap-2 text-zinc-400", className)} {...props}>
      {icon && <span className="text-violet-400 shrink-0">{icon}</span>}
      <span className="text-xs font-semibold uppercase tracking-wider">{children}</span>
    </div>
  );
}

export function CardAction({ className, ...props }: React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "text-xs font-medium text-violet-400 hover:text-violet-300",
        "transition-colors",
        className,
      )}
      {...props}
    />
  );
}

export function CardDivider() {
  return <div className="h-px bg-zinc-800/70 my-3" />;
}
