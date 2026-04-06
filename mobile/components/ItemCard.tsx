import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, font } from '@/constants/theme';

interface Props {
  title: string;
  subtitle?: string;
  badge?: string;
  amount?: string;
  amountDanger?: boolean;
  progress?: number; // 0–1
  onEdit?: () => void;
  onDelete?: () => void;
  children?: React.ReactNode;
}

export function ItemCard({
  title, subtitle, badge, amount, amountDanger, progress, onEdit, onDelete, children,
}: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
          {badge && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          )}
        </View>
        <View style={styles.right}>
          {amount && (
            <Text style={[styles.amount, amountDanger && { color: colors.red }]}>{amount}</Text>
          )}
          <View style={styles.actions}>
            {onEdit && (
              <TouchableOpacity style={styles.actionBtn} onPress={onEdit} hitSlop={8}>
                <Ionicons name="pencil-outline" size={15} color={colors.textMuted} />
              </TouchableOpacity>
            )}
            {onDelete && (
              <TouchableOpacity style={styles.actionBtn} onPress={onDelete} hitSlop={8}>
                <Ionicons name="trash-outline" size={15} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {typeof progress === 'number' && (
        <View style={styles.progressBg}>
          <View style={[styles.progressFill, { width: `${Math.min(progress * 100, 100)}%` }]} />
        </View>
      )}

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  info: {
    flex: 1,
    gap: 3,
  },
  title: {
    fontSize: font.base,
    fontWeight: '600',
    color: colors.text,
  },
  subtitle: {
    fontSize: font.sm,
    color: colors.textMuted,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceLight,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 2,
  },
  badgeText: {
    fontSize: font.xs,
    color: colors.textMuted,
    fontWeight: '500',
  },
  right: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  amount: {
    fontSize: font.md,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  actions: {
    flexDirection: 'row',
    gap: 4,
  },
  actionBtn: {
    padding: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceLight,
  },
  progressBg: {
    height: 4,
    backgroundColor: colors.surfaceLight,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: radius.full,
  },
});
