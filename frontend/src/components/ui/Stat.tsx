import * as React from "react";
import { cn } from "@/lib/utils";
import { inr, inrCompact, pct } from "@/lib/tokens";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

/**
 * A money "stat" — label above, big number below, optional delta + helper.
 * Right-aligned variant available for tables.
 */
type Tone = "neutral" | "good" | "bad" | "accent";

interface StatProps {
  label?: string;
  value: number | null | undefined;
  /** "compact" turns 124500 → ₹1.2L. */
  format?: "full" | "compact";
  size?: "hero" | "lg" | "md" | "sm";
  tone?: Tone;
  /** trend percent (e.g. +7 for +7%). null = no delta */
  delta?: number | null;
  /** secondary line (e.g. "baseline ₹68,000") */
  helper?: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}

const sizeMap: Record<NonNullable<StatProps["size"]>, string> = {
  hero: "text-4xl md:text-5xl font-semibold tracking-tight",
  lg:   "text-2xl font-semibold tracking-tight",
  md:   "text-base font-semibold",
  sm:   "text-sm font-medium",
};

const toneMap: Record<Tone, string> = {
  neutral: "text-zinc-100",
  good:    "text-emerald-400",
  bad:     "text-red-400",
  accent:  "text-violet-300",
};

export function Stat({
  label, value, format = "full", size = "lg",
  tone = "neutral", delta, helper, align = "left", className,
}: StatProps) {
  const display = format === "compact" ? inrCompact(value) : inr(value);
  const deltaTone = (delta ?? 0) >= 0 ? "text-emerald-400" : "text-red-400";
  const DeltaIcon = (delta ?? 0) >= 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <div className={cn("flex flex-col gap-0.5", align === "right" && "items-end", className)}>
      {label && <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">{label}</span>}
      <span className={cn("num", sizeMap[size], toneMap[tone])}>{display}</span>
      {(delta !== null && delta !== undefined) && (
        <span className={cn("flex items-center gap-1 text-xs num", deltaTone)}>
          <DeltaIcon size={12} className="shrink-0" />
          {pct(delta).replace(/^\+?/, "")}
        </span>
      )}
      {helper && <span className="text-xs text-zinc-500">{helper}</span>}
    </div>
  );
}

/** A single key/value row used inside a card body (e.g. "Liquid · ₹1,50,000") */
export function Row({
  label, value, valueClassName, dot, helper, onClick,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  valueClassName?: string;
  dot?: string;
  helper?: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 py-1.5",
        onClick && "cursor-pointer hover:bg-zinc-800/30 -mx-2 px-2 rounded-md transition-colors",
      )}
    >
      {dot && <span className={cn("h-2 w-2 rounded-full shrink-0", dot)} />}
      <span className="text-sm text-zinc-300 flex-1 truncate">{label}</span>
      {helper && <span className="text-xs text-zinc-500 shrink-0">{helper}</span>}
      <span className={cn("num text-sm tabular-nums shrink-0", valueClassName ?? "text-zinc-100")}>{value}</span>
    </div>
  );
}
