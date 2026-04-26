/**
 * App brand marks for SubTracker (dashboard) and Expense Tracker (group splitter).
 *
 * Inline SVGs (no asset request, scales perfectly at any DPR) with their
 * own gradient defs, each wrapped in a `<symbol>` so the same gradient
 * can appear multiple times on the page without React-fragment id
 * collisions: gradients are id-namespaced per instance via React.useId().
 *
 * Both icons share the same rounded-tile silhouette so they read as
 * sister apps; differentiation comes from the inner glyph (chart bars
 * for SubTracker, three orbs for Expense Tracker).
 */
import { useId } from "react";

interface IconProps {
  size?: number;
  className?: string;
  title?: string;
}

export function SubTrackerIcon({ size = 24, className, title }: IconProps) {
  const a = useId();
  const b = useId();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={title ?? "SubTracker"}
    >
      <defs>
        <linearGradient id={a} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#7c3aed"/>
          <stop offset="60%"  stopColor="#a78bfa"/>
          <stop offset="100%" stopColor="#f0abfc"/>
        </linearGradient>
        <linearGradient id={b} x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#ffffff" stopOpacity="0.95"/>
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.7"/>
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill={`url(#${a})`}/>
      <path d="M14 14 Q14 14 50 14 L50 22 Q40 18 14 22 Z" fill="#ffffff" opacity="0.10"/>
      <rect x="14"   y="38" width="9" height="14" rx="3" fill={`url(#${b})`}/>
      <rect x="27.5" y="28" width="9" height="24" rx="3" fill={`url(#${b})`}/>
      <rect x="41"   y="18" width="9" height="34" rx="3" fill={`url(#${b})`}/>
      <circle cx="45.5" cy="13" r="3" fill="#ffffff"/>
    </svg>
  );
}

export function ExpenseTrackerIcon({ size = 24, className, title }: IconProps) {
  const a = useId();
  const b = useId();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={title ?? "Expense Tracker"}
    >
      <defs>
        <linearGradient id={a} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#a78bfa"/>
          <stop offset="50%"  stopColor="#c084fc"/>
          <stop offset="100%" stopColor="#f0abfc"/>
        </linearGradient>
        <radialGradient id={b} cx="50%" cy="40%" r="60%">
          <stop offset="0%"   stopColor="#ffffff" stopOpacity="1"/>
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.85"/>
        </radialGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill={`url(#${a})`}/>
      <path d="M14 14 Q14 14 50 14 L50 22 Q40 18 14 22 Z" fill="#ffffff" opacity="0.10"/>
      <path
        d="M18 42 Q32 48 46 42"
        stroke="#ffffff" strokeOpacity="0.35" strokeWidth="2" strokeLinecap="round" fill="none"
      />
      <circle cx="20" cy="40" r="9"  fill={`url(#${b})`} opacity="0.85"/>
      <circle cx="44" cy="40" r="9"  fill={`url(#${b})`} opacity="0.85"/>
      <circle cx="32" cy="28" r="11" fill={`url(#${b})`}/>
      <circle cx="32" cy="28" r="3.5" fill={`url(#${a})`}/>
    </svg>
  );
}
