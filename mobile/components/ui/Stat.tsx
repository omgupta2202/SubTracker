import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { colors, font, fontWeight, spacing } from '@/constants/theme';
import { inr, inrCompact } from '@/constants/theme';

type Tone = 'neutral' | 'good' | 'bad' | 'warn' | 'accent' | 'muted';
type Size = 'hero' | 'lg' | 'md' | 'sm';

const toneColor: Record<Tone, string> = {
  neutral: colors.text,
  good:    colors.good,
  bad:     colors.bad,
  warn:    colors.warn,
  accent:  colors.accent,
  muted:   colors.textMuted,
};

const sizeFont: Record<Size, number> = {
  hero: font.hero,
  lg:   font.xl,
  md:   font.md,
  sm:   font.sm,
};

const sizeWeight: Record<Size, '600' | '700'> = {
  hero: '700',
  lg:   '700',
  md:   '600',
  sm:   '600',
};

interface StatProps {
  label?: string;
  value: number | null | undefined;
  format?: 'full' | 'compact';
  size?: Size;
  tone?: Tone;
  helper?: string;
  align?: 'left' | 'right';
}

/**
 * Money stat: small label, big number, optional helper. The number is
 * always monospace + tabular so multiple stats stacked together align.
 */
export function Stat({
  label, value, format = 'full', size = 'lg', tone = 'neutral', helper, align = 'left',
}: StatProps) {
  const display = format === 'compact' ? inrCompact(value) : inr(value);
  return (
    <View style={[align === 'right' && { alignItems: 'flex-end' }]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Text style={[
        styles.num,
        { fontSize: sizeFont[size], color: toneColor[tone], fontWeight: sizeWeight[size] },
      ]}>
        {display}
      </Text>
      {helper ? <Text style={styles.helper}>{helper}</Text> : null}
    </View>
  );
}

interface RowProps {
  label: React.ReactNode;
  value: React.ReactNode;
  valueTone?: Tone;
  dot?: string;
  helper?: React.ReactNode;
  onPress?: () => void;
}

/** Single key/value row. */
export function Row({ label, value, valueTone = 'neutral', dot, helper, onPress }: RowProps) {
  const Wrap: any = onPress ? TouchableOpacity : View;
  return (
    <Wrap
      activeOpacity={0.6}
      onPress={onPress}
      style={styles.row}
    >
      {dot ? <View style={[styles.dot, { backgroundColor: dot }]} /> : null}
      <View style={{ flex: 1 }}>
        {typeof label === 'string'
          ? <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
          : label}
      </View>
      {helper ? (
        typeof helper === 'string'
          ? <Text style={styles.rowHelper}>{helper}</Text>
          : <View style={{ marginRight: spacing.sm }}>{helper}</View>
      ) : null}
      <Text style={[styles.rowValue, { color: toneColor[valueTone] }]} numberOfLines={1}>
        {value}
      </Text>
    </Wrap>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: font.xs,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: fontWeight.semibold,
    marginBottom: 2,
  },
  num: {
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
    letterSpacing: -0.5,
    includeFontPadding: false,
  },
  helper: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  dot: {
    width: 8, height: 8, borderRadius: 4,
    marginRight: spacing.sm,
  },
  rowLabel: { fontSize: font.sm, color: colors.textSecondary },
  rowHelper: { fontSize: font.xs, color: colors.textMuted, marginRight: spacing.sm },
  rowValue: {
    fontSize: font.sm,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontWeight: fontWeight.semibold,
  },
});
