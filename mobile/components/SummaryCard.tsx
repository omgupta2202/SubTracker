import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radius, spacing, font } from '@/constants/theme';

interface Props {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  danger?: boolean;
}

export function SummaryCard({ label, value, sub, accent, danger }: Props) {
  const valueColor = danger ? colors.red : accent ? colors.accent : colors.text;

  return (
    <View style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, { color: valueColor }]}>{value}</Text>
      {sub && <Text style={styles.sub}>{sub}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    minHeight: 88,
    justifyContent: 'space-between',
  },
  label: {
    fontSize: font.xs,
    color: colors.textMuted,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  value: {
    fontSize: font.xl,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  sub: {
    fontSize: font.xs,
    color: colors.textFaint,
    marginTop: spacing.xs,
  },
});
