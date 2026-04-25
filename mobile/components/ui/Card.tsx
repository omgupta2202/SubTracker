import React from 'react';
import { View, Text, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { colors, spacing, radius, font, fontWeight } from '@/constants/theme';

interface CardProps {
  children: React.ReactNode;
  variant?: 'default' | 'hero';
  style?: StyleProp<ViewStyle>;
  /** Skip the default 16px padding (for cards that need bleed-to-edge headers). */
  bare?: boolean;
}

/**
 * Flat surface card. Mirrors the web Card primitive.
 * No nested boxes — use a Divider when you need visual separation inside.
 */
export function Card({ children, variant = 'default', style, bare = false }: CardProps) {
  return (
    <View style={[
      styles.base,
      variant === 'hero' && styles.hero,
      !bare && { padding: spacing.md },
      style,
    ]}>
      {children}
    </View>
  );
}

export function CardHeader({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>{children}</View>
      {action ? <View>{action}</View> : null}
    </View>
  );
}

export function CardTitle({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <View style={styles.title}>
      {icon ? <View style={{ marginRight: 6 }}>{icon}</View> : null}
      <Text style={styles.titleText}>{children}</Text>
    </View>
  );
}

export function Divider({ vertical }: { vertical?: boolean }) {
  return <View style={vertical ? styles.dividerV : styles.dividerH} />;
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  hero: {
    backgroundColor: colors.surfaceMute,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  title: { flexDirection: 'row', alignItems: 'center' },
  titleText: {
    fontSize: font.xs,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: fontWeight.semibold,
  },
  dividerH: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.sm },
  dividerV: { width: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginHorizontal: spacing.sm },
});
