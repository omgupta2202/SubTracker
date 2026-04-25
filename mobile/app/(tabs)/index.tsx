import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardHeader, CardTitle, Divider } from '@/components/ui/Card';
import { Stat, Row } from '@/components/ui/Stat';
import { Loader } from '@/components/Loader';
import {
  getSmartAllocation, getCards, getAccounts,
  getSubscriptions, getEmis, getRent,
} from '@/services/api';
import {
  colors, spacing, font, fontWeight, radius,
  inr, inrCompact, relativeDay, bankDot,
} from '@/constants/theme';
import type {
  SmartAllocationResponse, CreditCard, BankAccount,
  Subscription, EMI, Rent,
} from '@/types';

export default function HomeScreen() {
  const { user } = useAuth();
  const [allocation, setAllocation] = useState<SmartAllocationResponse | null>(null);
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [emis, setEmis] = useState<EMI[]>([]);
  const [rent, setRent] = useState<Rent>({ amount: 0, due_day: 1 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [a, c, ac, s, e, r] = await Promise.all([
        getSmartAllocation(), getCards(), getAccounts(),
        getSubscriptions(), getEmis(), getRent(),
      ]);
      setAllocation(a); setCards(c); setAccounts(ac);
      setSubs(s); setEmis(e); setRent(r);
    } catch { /* silently */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  const onRefresh = () => { setRefreshing(true); fetchAll(); };

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  if (loading) return <Loader />;

  const totalLiquid = accounts.reduce((s, a) => s + a.balance, 0);
  const totalCC     = cards.reduce((s, c) => s + c.outstanding, 0);
  const netAfterCC  = totalLiquid - totalCC - (rent.amount || 0);
  const subTotal    = subs.reduce((s, x) => s + x.amount, 0);
  const emiTotal    = emis.reduce((s, x) => s + x.amount, 0);

  const upcoming = [...cards.map(c => ({
    name: c.last4 ? `${c.name} ···· ${c.last4}` : c.name,
    amount: c.minimum_due,
    daysLeft: c.due_date_offset,
    type: 'card' as const,
    color: colors.good,
  })), ...emis.map(e => ({
    name: e.name,
    amount: e.amount,
    daysLeft: 99,
    type: 'emi' as const,
    color: colors.bankHDFC,
  })), ...subs.map(s => ({
    name: s.name,
    amount: s.amount,
    daysLeft: 99,
    type: 'sub' as const,
    color: colors.accent,
  }))]
    .filter(it => (it.daysLeft ?? 999) >= 0 && (it.daysLeft ?? 999) <= 7)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Greeting */}
        <View style={styles.greetingRow}>
          <View>
            <Text style={styles.greeting}>{greeting},</Text>
            <Text style={styles.userName}>{user?.name || user?.email?.split('@')[0] || 'there'}</Text>
          </View>
        </View>

        {/* Net worth hero */}
        <Card variant="hero">
          <CardHeader>
            <CardTitle icon={<Ionicons name="wallet-outline" size={13} color={colors.accent} />}>
              Net worth
            </CardTitle>
          </CardHeader>

          <Stat
            value={netAfterCC}
            size="hero"
            tone={netAfterCC >= 0 ? 'good' : 'bad'}
            helper="net after CC + rent"
          />

          <Divider />

          <View style={{ gap: 2 }}>
            <Row
              dot={colors.good}
              label="Liquid"
              value={inrCompact(totalLiquid)}
              helper={`${accounts.length} acct${accounts.length === 1 ? '' : 's'}`}
            />
            <Row
              dot={colors.bad}
              label="Credit cards"
              value={`− ${inrCompact(totalCC)}`}
              valueTone="bad"
              helper={`${cards.length} card${cards.length === 1 ? '' : 's'}`}
            />
            {(rent.amount || 0) > 0 && (
              <Row
                dot={colors.bad}
                label="Rent"
                value={`− ${inrCompact(rent.amount || 0)}`}
                valueTone="bad"
                helper="monthly"
              />
            )}
          </View>
        </Card>

        {/* Monthly burn */}
        <Card>
          <CardHeader>
            <CardTitle icon={<Ionicons name="flame-outline" size={13} color={colors.accent} />}>
              This month
            </CardTitle>
          </CardHeader>

          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <Stat label="Spent" value={emiTotal + subTotal + (rent.amount || 0)} size="lg" />
            <Stat
              label="Composition"
              value={emiTotal + subTotal + (rent.amount || 0)}
              size="sm"
              align="right"
              format="compact"
              tone="muted"
            />
          </View>

          <View style={{ flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', marginTop: spacing.sm, gap: 1 }}>
            {(() => {
              const total = Math.max(emiTotal + subTotal + (rent.amount || 0), 1);
              return [
                { c: colors.accent,   v: subTotal,         k: 's' },
                { c: colors.bankHDFC, v: emiTotal,         k: 'e' },
                { c: colors.warn,     v: rent.amount || 0, k: 'r' },
              ].map(p => (
                <View key={p.k} style={{ flex: p.v / total, backgroundColor: p.c, minWidth: p.v > 0 ? 2 : 0 }} />
              ));
            })()}
          </View>

          <View style={{ marginTop: spacing.sm, gap: 2 }}>
            <Row dot={colors.accent}   label={`Subscriptions · ${subs.length}`}              value={inrCompact(subTotal)} />
            <Row dot={colors.bankHDFC} label={`EMIs · ${emis.length}`}                       value={inrCompact(emiTotal)} />
            <Row dot={colors.warn}     label="Rent" value={inrCompact(rent.amount || 0)} />
          </View>
        </Card>

        {/* 7-day horizon */}
        <Card>
          <CardHeader
            action={upcoming.length > 0 ? <Stat value={upcoming.reduce((s, i) => s + i.amount, 0)} size="sm" align="right" format="compact" /> : null}
          >
            <CardTitle icon={<Ionicons name="time-outline" size={13} color={colors.accent} />}>
              7-day horizon
            </CardTitle>
          </CardHeader>

          {upcoming.length === 0 ? (
            <Text style={styles.empty}>Nothing due this week.</Text>
          ) : (
            <View style={{ gap: 2 }}>
              {upcoming.map((it, i) => {
                const tone = it.daysLeft === 0 ? colors.bad : it.daysLeft <= 3 ? colors.warn : colors.textMuted;
                return (
                  <View key={i} style={styles.horizonRow}>
                    <View style={[styles.dot, { backgroundColor: it.color }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.horizonLabel} numberOfLines={1}>{it.name}</Text>
                      <Text style={[styles.horizonMeta, { color: tone }]}>
                        {it.type === 'sub' ? 'sub' : it.type.toUpperCase()} · {relativeDay(it.daysLeft ?? 0)}
                      </Text>
                    </View>
                    <Text style={[styles.horizonAmount, { color: tone === colors.textMuted ? colors.text : tone }]}>
                      {inrCompact(it.amount)}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </Card>

        {/* Smart pay plan */}
        {allocation?.allocations?.length ? (
          <Card>
            <CardHeader>
              <CardTitle icon={<Ionicons name="bulb-outline" size={13} color={colors.accent} />}>
                Smart pay plan
              </CardTitle>
            </CardHeader>
            <View style={{ gap: 2 }}>
              {allocation.allocations.slice(0, 5).map((a, i) => {
                const days = a.days_left ?? 99;
                const tone = days <= 3 ? colors.bad : days <= 7 ? colors.warn : colors.textMuted;
                return (
                  <View key={i} style={styles.allocRow}>
                    <View style={[styles.dot, { backgroundColor: tone }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.allocCard} numberOfLines={1}>{a.card_name ?? a.card ?? 'Card'}</Text>
                      <Text style={styles.allocMeta} numberOfLines={1}>
                        {a.from_account_name ?? a.pay_from ?? '—'} · {days <= 0 ? 'today' : `${days}d`}
                      </Text>
                    </View>
                    <Text style={styles.allocAmount}>{inrCompact(a.allocatable ?? a.amount ?? 0)}</Text>
                  </View>
                );
              })}
            </View>
          </Card>
        ) : null}

        {/* Cards list */}
        {cards.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle icon={<Ionicons name="card-outline" size={13} color={colors.accent} />}>
                Credit cards
              </CardTitle>
            </CardHeader>
            <View style={{ gap: 2 }}>
              {cards.map(c => {
                const due = c.due_date_offset ?? 99;
                const tone = due <= 3 ? colors.bad : due <= 7 ? colors.warn : colors.textMuted;
                return (
                  <View key={c.id} style={styles.cardRow}>
                    <View style={[styles.dot, { backgroundColor: bankDot(c.bank) }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardName} numberOfLines={1}>
                        {c.name}{c.last4 ? `  ···· ${c.last4}` : ''}
                      </Text>
                      <Text style={styles.cardMeta}>
                        min {inrCompact(c.minimum_due)} · <Text style={{ color: tone }}>{relativeDay(due)}</Text>
                      </Text>
                    </View>
                    <Text style={styles.cardAmount}>{inrCompact(c.outstanding)}</Text>
                  </View>
                );
              })}
            </View>
          </Card>
        )}

        {/* Accounts list */}
        {accounts.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle icon={<Ionicons name="business-outline" size={13} color={colors.accent} />}>
                Accounts
              </CardTitle>
            </CardHeader>
            <View style={{ gap: 2 }}>
              {accounts.map(a => (
                <Row
                  key={a.id}
                  dot={bankDot(a.bank)}
                  label={a.name}
                  helper={a.bank}
                  value={inrCompact(a.balance)}
                />
              ))}
            </View>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  greetingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  greeting: { fontSize: font.sm, color: colors.textMuted },
  userName: {
    fontSize: font.lg, fontWeight: fontWeight.bold, color: colors.text, letterSpacing: -0.5,
  },
  empty: { fontSize: font.sm, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.md },
  horizonRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  horizonLabel: { fontSize: font.sm, color: colors.text },
  horizonMeta: { fontSize: font.xs, marginTop: 1 },
  horizonAmount: {
    fontSize: font.sm, fontWeight: fontWeight.semibold,
    fontFamily: 'monospace',
  },
  allocRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  allocCard: { fontSize: font.sm, color: colors.textSecondary },
  allocMeta: { fontSize: font.xs, color: colors.textMuted, marginTop: 1 },
  allocAmount: { fontSize: font.sm, color: colors.text, fontFamily: 'monospace', fontWeight: fontWeight.semibold },
  cardRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  cardName: { fontSize: font.sm, color: colors.textSecondary },
  cardMeta: { fontSize: font.xs, color: colors.textMuted, marginTop: 1 },
  cardAmount: { fontSize: font.sm, color: colors.text, fontFamily: 'monospace', fontWeight: fontWeight.semibold },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.sm },
});
