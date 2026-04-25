import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, RefreshControl,
  TouchableOpacity, TextInput, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Stat, Row } from '@/components/ui/Stat';
import { EmptyState } from '@/components/EmptyState';
import { Loader } from '@/components/Loader';
import { FormModal, FormField, PrimaryButton, inputStyle } from '@/components/FormModal';
import {
  getSubscriptions, createSubscription, updateSubscription, deleteSubscription,
  getEmis, createEmi, updateEmi, deleteEmi,
} from '@/services/api';
import {
  colors, spacing, font, fontWeight, radius,
  inrCompact,
} from '@/constants/theme';
import type { Subscription, EMI } from '@/types';

type SubForm = { name: string; amount: string; billing_cycle: string; due_day: string; category: string };
type EmiForm = { name: string; lender: string; amount: string; due_day: string; total_months: string; paid_months: string };
const emptySub = (): SubForm => ({ name: '', amount: '', billing_cycle: 'monthly', due_day: '', category: '' });
const emptyEmi = (): EmiForm => ({ name: '', lender: '', amount: '', due_day: '', total_months: '', paid_months: '0' });

export default function BudgetScreen() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [emis, setEmis] = useState<EMI[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showSubForm, setShowSubForm] = useState(false);
  const [editingSub, setEditingSub] = useState<Subscription | null>(null);
  const [subForm, setSubForm] = useState<SubForm>(emptySub());
  const [showEmiForm, setShowEmiForm] = useState(false);
  const [editingEmi, setEditingEmi] = useState<EMI | null>(null);
  const [emiForm, setEmiForm] = useState<EmiForm>(emptyEmi());
  const [saving, setSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [s, e] = await Promise.all([getSubscriptions(), getEmis()]);
      setSubs(s); setEmis(e);
    } catch { /* silent */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const saveSub = async () => {
    if (!subForm.name.trim()) { Alert.alert('Error', 'Name is required.'); return; }
    setSaving(true);
    const payload = {
      name: subForm.name.trim(),
      amount: parseFloat(subForm.amount) || 0,
      billing_cycle: subForm.billing_cycle as Subscription['billing_cycle'],
      due_day: parseInt(subForm.due_day) || 1,
      category: subForm.category.trim(),
    };
    try {
      if (editingSub) await updateSubscription(editingSub.id, payload);
      else await createSubscription(payload);
      setShowSubForm(false); fetchAll();
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSaving(false); }
  };
  const deleteSub = (sub: Subscription) => {
    Alert.alert('Delete', `Delete "${sub.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteSubscription(sub.id); fetchAll(); } },
    ]);
  };

  const saveEmi = async () => {
    if (!emiForm.name.trim()) { Alert.alert('Error', 'Name is required.'); return; }
    setSaving(true);
    const payload = {
      name: emiForm.name.trim(), lender: emiForm.lender.trim(),
      amount: parseFloat(emiForm.amount) || 0,
      due_day: parseInt(emiForm.due_day) || 1,
      total_months: parseInt(emiForm.total_months) || 1,
      paid_months: parseInt(emiForm.paid_months) || 0,
    };
    try {
      if (editingEmi) await updateEmi(editingEmi.id, payload);
      else await createEmi(payload);
      setShowEmiForm(false); fetchAll();
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSaving(false); }
  };
  const deleteEmiItem = (emi: EMI) => {
    Alert.alert('Delete', `Delete "${emi.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteEmi(emi.id); fetchAll(); } },
    ]);
  };

  if (loading) return <Loader />;

  const subTotal = subs.reduce((s, x) => s + x.amount, 0);
  const emiTotal = emis.reduce((s, x) => s + x.amount, 0);
  const totalMonthly = subTotal + emiTotal;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.pageHeader}>
        <Text style={styles.pageTitle}>Budget</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAll(); }} tintColor={colors.accent} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero summary */}
        <Card variant="hero">
          <CardHeader>
            <CardTitle icon={<Ionicons name="flame-outline" size={13} color={colors.accent} />}>
              Monthly commitments
            </CardTitle>
          </CardHeader>

          <Stat
            value={totalMonthly}
            size="hero"
            tone="neutral"
            helper={`${subs.length} subs · ${emis.length} EMIs`}
          />

          {totalMonthly > 0 && (
            <View style={{ flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', marginTop: spacing.sm, gap: 1 }}>
              <View style={{ flex: subTotal / totalMonthly, backgroundColor: colors.accent, minWidth: subTotal > 0 ? 2 : 0 }} />
              <View style={{ flex: emiTotal / totalMonthly, backgroundColor: colors.bankHDFC, minWidth: emiTotal > 0 ? 2 : 0 }} />
            </View>
          )}

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={[styles.legendDot, { backgroundColor: colors.accent }]} />
              <Text style={styles.legendText}>Subs {inrCompact(subTotal)}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={[styles.legendDot, { backgroundColor: colors.bankHDFC }]} />
              <Text style={styles.legendText}>EMIs {inrCompact(emiTotal)}</Text>
            </View>
          </View>
        </Card>

        {/* Subscriptions */}
        <Card style={{ marginTop: spacing.md }}>
          <CardHeader
            action={
              <TouchableOpacity
                onPress={() => { setEditingSub(null); setSubForm(emptySub()); setShowSubForm(true); }}
                hitSlop={6}
              >
                <Ionicons name="add" size={18} color={colors.accent} />
              </TouchableOpacity>
            }
          >
            <CardTitle icon={<Ionicons name="repeat-outline" size={13} color={colors.accent} />}>
              Subscriptions · {subs.length}
            </CardTitle>
          </CardHeader>

          {subs.length === 0 ? (
            <EmptyState icon="repeat-outline" title="No subscriptions" subtitle="Tap + to add a recurring subscription" />
          ) : (
            <View style={{ gap: 2 }}>
              {subs.map(s => (
                <TouchableOpacity
                  key={s.id}
                  onPress={() => {
                    setEditingSub(s);
                    setSubForm({ name: s.name, amount: String(s.amount), billing_cycle: s.billing_cycle, due_day: String(s.due_day), category: s.category });
                    setShowSubForm(true);
                  }}
                  onLongPress={() => deleteSub(s)}
                  delayLongPress={400}
                >
                  <Row
                    dot={colors.accent}
                    label={
                      <View>
                        <Text style={styles.itemName}>{s.name}</Text>
                        <Text style={styles.itemMeta}>
                          {s.billing_cycle} · {s.category || 'Other'} · day {s.due_day}
                        </Text>
                      </View>
                    }
                    value={inrCompact(s.amount)}
                  />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </Card>

        {/* EMIs */}
        <Card style={{ marginTop: spacing.md }}>
          <CardHeader
            action={
              <TouchableOpacity
                onPress={() => { setEditingEmi(null); setEmiForm(emptyEmi()); setShowEmiForm(true); }}
                hitSlop={6}
              >
                <Ionicons name="add" size={18} color={colors.accent} />
              </TouchableOpacity>
            }
          >
            <CardTitle icon={<Ionicons name="trending-down-outline" size={13} color={colors.accent} />}>
              EMIs · {emis.length}
            </CardTitle>
          </CardHeader>

          {emis.length === 0 ? (
            <EmptyState icon="trending-down-outline" title="No EMIs" subtitle="Tap + to add a loan instalment" />
          ) : (
            <View style={{ gap: spacing.sm }}>
              {emis.map(e => {
                const total = Math.max(0, e.total_months || 0);
                const paid = Math.max(0, Math.min(e.paid_months || 0, total));
                const pct = total > 0 ? (paid / total) * 100 : 0;
                return (
                  <TouchableOpacity
                    key={e.id}
                    onPress={() => {
                      setEditingEmi(e);
                      setEmiForm({ name: e.name, lender: e.lender, amount: String(e.amount), due_day: String(e.due_day), total_months: String(e.total_months), paid_months: String(e.paid_months) });
                      setShowEmiForm(true);
                    }}
                    onLongPress={() => deleteEmiItem(e)}
                    delayLongPress={400}
                  >
                    <View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                        <View style={[styles.legendDot, { backgroundColor: colors.bankHDFC }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.itemName}>{e.name}</Text>
                          <Text style={styles.itemMeta}>
                            {e.lender} · day {e.due_day}
                          </Text>
                        </View>
                        <Text style={styles.itemAmount}>{inrCompact(e.amount)}/mo</Text>
                      </View>
                      <View style={styles.emiTrack}>
                        <View style={[styles.emiFill, { width: `${pct}%` }]} />
                      </View>
                      <Text style={styles.emiCaption}>
                        {paid}/{total} paid · {Math.round(pct)}%
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </Card>

        <Text style={styles.hint}>Tap to edit · long-press to delete</Text>
      </ScrollView>

      {/* Subscription form */}
      <FormModal visible={showSubForm} title={editingSub ? 'Edit subscription' : 'Add subscription'} onClose={() => setShowSubForm(false)}>
        <FormField label="Name"><TextInput style={inputStyle} placeholder="Netflix" placeholderTextColor={colors.textFaint} value={subForm.name} onChangeText={v => setSubForm(f => ({ ...f, name: v }))} /></FormField>
        <FormField label="Amount (₹)"><TextInput style={inputStyle} placeholder="649" placeholderTextColor={colors.textFaint} value={subForm.amount} onChangeText={v => setSubForm(f => ({ ...f, amount: v }))} keyboardType="decimal-pad" /></FormField>
        <FormField label="Billing cycle"><TextInput style={inputStyle} placeholder="monthly" placeholderTextColor={colors.textFaint} value={subForm.billing_cycle} onChangeText={v => setSubForm(f => ({ ...f, billing_cycle: v }))} /></FormField>
        <FormField label="Due day (1–31)"><TextInput style={inputStyle} placeholder="5" placeholderTextColor={colors.textFaint} value={subForm.due_day} onChangeText={v => setSubForm(f => ({ ...f, due_day: v }))} keyboardType="number-pad" /></FormField>
        <FormField label="Category"><TextInput style={inputStyle} placeholder="Entertainment" placeholderTextColor={colors.textFaint} value={subForm.category} onChangeText={v => setSubForm(f => ({ ...f, category: v }))} /></FormField>
        <PrimaryButton label={saving ? 'Saving…' : editingSub ? 'Update' : 'Add subscription'} onPress={saveSub} disabled={saving} />
      </FormModal>

      {/* EMI form */}
      <FormModal visible={showEmiForm} title={editingEmi ? 'Edit EMI' : 'Add EMI'} onClose={() => setShowEmiForm(false)}>
        <FormField label="Name"><TextInput style={inputStyle} placeholder="Home loan" placeholderTextColor={colors.textFaint} value={emiForm.name} onChangeText={v => setEmiForm(f => ({ ...f, name: v }))} /></FormField>
        <FormField label="Lender"><TextInput style={inputStyle} placeholder="SBI" placeholderTextColor={colors.textFaint} value={emiForm.lender} onChangeText={v => setEmiForm(f => ({ ...f, lender: v }))} /></FormField>
        <FormField label="Monthly amount (₹)"><TextInput style={inputStyle} placeholder="25000" placeholderTextColor={colors.textFaint} value={emiForm.amount} onChangeText={v => setEmiForm(f => ({ ...f, amount: v }))} keyboardType="decimal-pad" /></FormField>
        <FormField label="Due day (1–31)"><TextInput style={inputStyle} placeholder="5" placeholderTextColor={colors.textFaint} value={emiForm.due_day} onChangeText={v => setEmiForm(f => ({ ...f, due_day: v }))} keyboardType="number-pad" /></FormField>
        <FormField label="Total months"><TextInput style={inputStyle} placeholder="240" placeholderTextColor={colors.textFaint} value={emiForm.total_months} onChangeText={v => setEmiForm(f => ({ ...f, total_months: v }))} keyboardType="number-pad" /></FormField>
        <FormField label="Paid months"><TextInput style={inputStyle} placeholder="12" placeholderTextColor={colors.textFaint} value={emiForm.paid_months} onChangeText={v => setEmiForm(f => ({ ...f, paid_months: v }))} keyboardType="number-pad" /></FormField>
        <PrimaryButton label={saving ? 'Saving…' : editingEmi ? 'Update' : 'Add EMI'} onPress={saveEmi} disabled={saving} />
      </FormModal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  pageHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  pageTitle: { fontSize: font.xl, fontWeight: fontWeight.bold, color: colors.text, letterSpacing: -0.5 },
  legendDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  legendText: { fontSize: font.xs, color: colors.textMuted, fontFamily: 'monospace' },
  itemName: { fontSize: font.sm, color: colors.textSecondary },
  itemMeta: { fontSize: font.xs, color: colors.textFaint, marginTop: 1 },
  itemAmount: { fontSize: font.sm, color: colors.text, fontFamily: 'monospace', fontWeight: fontWeight.semibold },
  emiTrack: { height: 4, borderRadius: 2, backgroundColor: colors.surfaceLight, overflow: 'hidden' },
  emiFill: { height: 4, backgroundColor: colors.accent, borderRadius: 2 },
  emiCaption: { fontSize: font.xs, color: colors.textFaint, marginTop: 4 },
  hint: { fontSize: font.xs, color: colors.textFaint, textAlign: 'center', marginTop: spacing.md, fontStyle: 'italic' },
});
