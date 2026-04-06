import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a number as ₹X,XX,XXX (Indian numbering system) */
export function formatINR(amount: number): string {
  return "₹" + amount.toLocaleString("en-IN");
}

/**
 * Given a due_day (1-31), return the next Date on or after today
 * that matches that day — handles month rollover correctly.
 */
export function nextDueDate(dueDay: number): Date {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const candidate = new Date(year, month, dueDay);
  if (candidate < today) {
    // Roll to next month
    return new Date(year, month + 1, dueDay);
  }
  return candidate;
}

/** Days from today to a target date (can be negative if past) */
export function daysUntil(target: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const t = new Date(target);
  t.setHours(0, 0, 0, 0);
  return Math.round((t.getTime() - today.getTime()) / 86_400_000);
}
