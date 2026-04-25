/**
 * Mobile design tokens. Mirrors web/src/lib/tokens.ts so both
 * surfaces feel like the same product.
 *
 * Keep these in sync with the web file. The legacy field names
 * (red, green, yellow, borderLight, textMuted) are aliased so
 * existing components keep compiling while we migrate.
 */

export const colors = {
  // Surfaces
  bg:           '#09090b', // zinc-950
  surface:      '#18181b', // zinc-900
  surfaceMute:  '#0c0c0f',
  surfaceLight: '#27272a', // zinc-800 — subtle inset
  border:       'rgba(63,63,70,0.6)',
  borderHi:     '#3f3f46', // zinc-700
  borderLight:  '#3f3f46', // legacy alias
  // Text
  text:           '#f4f4f5', // zinc-100
  textSecondary:  '#d4d4d8', // zinc-300
  textMuted:      '#71717a', // zinc-500
  textFaint:      '#52525b', // zinc-600
  // Accent
  accent:       '#8b5cf6',
  accentDark:   '#7c3aed',
  accentBg:     'rgba(139,92,246,0.12)',
  accentBorder: 'rgba(139,92,246,0.30)',
  // Semantic
  good:    '#34d399',
  goodBg:  'rgba(52,211,153,0.12)',
  bad:     '#f87171',
  badBg:   'rgba(248,113,113,0.12)',
  warn:    '#fbbf24',
  warnBg:  'rgba(251,191,36,0.10)',
  white:   '#ffffff',
  // Legacy aliases
  red:    '#f87171',
  redBg:  'rgba(248,113,113,0.12)',
  green:  '#34d399',
  yellow: '#fbbf24',
  // Bank dots
  bankHDFC: '#38bdf8', bankAxis: '#a78bfa', bankSBI: '#fbbf24',
  bankCash: '#34d399', bankSlice: '#fb7185',
};

export const spacing = {
  xs:  4,
  sm:  8,
  md:  16,
  lg:  24,
  xl:  32,
  xxl: 48,
};

export const radius = {
  sm:  8,
  md:  12,
  lg:  16,
  xl:  20,
  full: 9999,
};

export const font = {
  xs:   11,
  sm:   13,
  base: 15,
  md:   17,
  lg:   20,
  xl:   24,
  xxl:  30,
  hero: 40,
};

export const fontWeight = {
  regular: '400' as const,
  medium:  '500' as const,
  semibold:'600' as const,
  bold:    '700' as const,
};

/* ── Money + format helpers (mirror web/src/lib/tokens.ts) ───── */

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');

export function inr(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return '₹' + fmt(n);
}

export function inrCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const abs  = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 10_000_000) return `${sign}₹${(abs/10_000_000).toFixed(1)}Cr`;
  if (abs >= 100_000)    return `${sign}₹${(abs/100_000).toFixed(1)}L`;
  if (abs >= 1_000)      return `${sign}₹${(abs/1_000).toFixed(1)}k`;
  return `${sign}₹${fmt(abs)}`;
}

export function relativeDay(daysAway: number): string {
  if (daysAway === 0)  return 'today';
  if (daysAway === 1)  return 'tomorrow';
  if (daysAway === -1) return 'yesterday';
  if (daysAway > 0)    return `in ${daysAway}d`;
  return `${Math.abs(daysAway)}d ago`;
}

export function bankDot(bank?: string): string {
  switch ((bank || '').split(' ')[0]) {
    case 'HDFC':  return colors.bankHDFC;
    case 'Axis':  return colors.bankAxis;
    case 'SBI':   return colors.bankSBI;
    case 'Cash':  return colors.bankCash;
    case 'Slice': return colors.bankSlice;
    default:      return colors.textFaint;
  }
}
