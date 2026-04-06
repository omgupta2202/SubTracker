import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { SummaryCard } from '@/components/SummaryCard';
import { ItemCard } from '@/components/ItemCard';
import { Loader } from '@/components/Loader';
import { getSmartAllocation, getCards, getAccounts, getSubscriptions, getEmis } from '@/services/api';
import { formatINR } from '@/lib/utils';
import { colors, spacing, font, radius } from '@/constants/theme';
import type { SmartAllocationResponse, CreditCard, BankAccount } from '@/types';

export default function HomeScreen() {
  const { user } = useAuth();
  const [allocation, setAllocation] = useState<SmartAllocationResponse | null>(null);
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [subTotal, setSubTotal] = useState(0);
  const [emiTotal, setEmiTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [alloc, c, a, subs, emis] = await Promise.all([
        getSmartAllocation(), getCards(), getAccounts(), getSubscriptions(), getEmis(),
      ]);
      setAllocation(alloc);
      setCards(c);
      setAccounts(a);
      setSubTotal(subs.reduce((s, x) => s + x.amount, 0));
      setEmiTotal(emis.reduce((s, x) => s + x.amount, 0));
    } catch { /* handled silently */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const onRefresh = () => { setRefreshing(true); fetchAll(); };

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  if (loading) return <Loader />;

  const summary = allocation?.summary;
  const totalLiquid = accounts.reduce((s, a) => s + a.balance, 0);
  const totalCC = cards.reduce((s, c) => s + c.outstanding, 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>{greeting()},</Text>
            <Text style={styles.userName}>{user?.name || user?.email?.split('@')[0] || 'there'} 👋</Text>
          </View>
        </View>

        {/* Summary grid */}
        <View style={styles.grid2}>
          <SummaryCard label="Liquid Assets" value={formatINR(totalLiquid)} accent />
          <SummaryCard label="CC Outstanding" value={formatINR(totalCC)} danger={totalCC > 0} />
        </View>
        <View style={styles.grid2}>
          <SummaryCard label="Monthly Subs" value={formatINR(subTotal)} sub="recurring" />
          <SummaryCard label="Monthly EMIs" value={formatINR(emiTotal)} sub="instalments" />
        </View>

        {/* Post-payment */}
        {summary && (
          <View style={styles.netCard}>
            <Text style={styles.netLabel}>After paying all cards</Text>
            <Text style={[styles.netValue, { color: summary.post_payment_liquid >= 0 ? colors.green : colors.red }]}>
              {formatINR(summary.post_payment_liquid)}
            </Text>
            <View style={[styles.pill, summary.fully_covered ? styles.pillGreen : styles.pillRed]}>
              <Ionicons
                name={summary.fully_covered ? 'checkmark-circle' : 'warning'}
                size={12}
                color={summary.fully_covered ? colors.green : colors.red}
              />
              <Text style={[styles.pillText, { color: summary.fully_covered ? colors.green : colors.red }]}>
                {summary.fully_covered ? 'All cards covered' : 'Insufficient funds'}
              </Text>
            </View>
          </View>
        )}

        {/* Credit cards */}
        {cards.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Credit Cards</Text>
            {cards.slice(0, 3).map(card => (
              <ItemCard
                key={card.id}
                title={card.last4 ? `${card.name} ···· ${card.last4}` : card.name}
                subtitle={`${card.bank} · due day ${card.due_day}`}
                badge={`Min ${formatINR(card.minimum_due)}`}
                amount={formatINR(card.outstanding)}
                amountDanger={card.outstanding > 0}
                progress={card.outstanding > 0 ? card.minimum_due / card.outstanding : 0}
              />
            ))}
            {cards.length > 3 && (
              <Text style={styles.moreText}>+{cards.length - 3} more — see Cards tab</Text>
            )}
          </View>
        )}

        {/* Accounts */}
        {accounts.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Bank Accounts</Text>
            {accounts.map(a => (
              <ItemCard
                key={a.id}
                title={a.name}
                subtitle={a.bank}
                amount={formatINR(a.balance)}
                accent
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
  },
  greeting: { fontSize: font.sm, color: colors.textMuted },
  userName: { fontSize: font.xl, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  grid2: { flexDirection: 'row', gap: spacing.sm },
  netCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  netLabel: { fontSize: font.xs, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '600' },
  netValue: { fontSize: font.xxl, fontWeight: '800', letterSpacing: -1 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  pillGreen: { backgroundColor: 'rgba(74,222,128,0.1)', borderColor: 'rgba(74,222,128,0.3)' },
  pillRed: { backgroundColor: 'rgba(248,113,113,0.1)', borderColor: 'rgba(248,113,113,0.3)' },
  pillText: { fontSize: font.xs, fontWeight: '600' },
  section: { gap: spacing.xs },
  sectionTitle: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  moreText: { fontSize: font.xs, color: colors.textFaint, textAlign: 'center', paddingTop: spacing.xs },
});
