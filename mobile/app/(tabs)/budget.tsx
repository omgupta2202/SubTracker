import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, RefreshControl,
  TouchableOpacity, TextInput, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ItemCard } from '@/components/ItemCard';
import { EmptyState } from '@/components/EmptyState';
import { Loader } from '@/components/Loader';
import { FormModal, FormField, PrimaryButton, inputStyle } from '@/components/FormModal';
import {
  getSubscriptions, createSubscription, updateSubscription, deleteSubscription,
  getEmis, createEmi, updateEmi, deleteEmi,
} from '@/services/api';
import { formatINR } from '@/lib/utils';
import { colors, spacing, font, radius } from '@/constants/theme';
import type { Subscription, EMI } from '@/types';

type ActiveTab = 'subs' | 'emis';

type SubForm = { name: string; amount: string; billing_cycle: string; due_day: string; category: string };
type EmiForm = { name: string; lender: string; amount: string; due_day: string; total_months: string; paid_months: string };
const emptySub = (): SubForm => ({ name: '', amount: '', billing_cycle: 'monthly', due_day: '', category: '' });
const emptyEmi = (): EmiForm => ({ name: '', lender: '', amount: '', due_day: '', total_months: '', paid_months: '0' });

export default function BudgetScreen() {
  const [tab, setTab] = useState<ActiveTab>('subs');
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

  // Subscriptions
  const saveSub = async () => {
    if (!subForm.name.trim()) { Alert.alert('Error', 'Name is required.'); return; }
    setSaving(true);
    const payload = { name: subForm.name.trim(), amount: parseFloat(subForm.amount) || 0, billing_cycle: subForm.billing_cycle, due_day: parseInt(subForm.due_day) || 1, category: subForm.category.trim() };
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

  // EMIs
  const saveEmi = async () => {
    if (!emiForm.name.trim()) { Alert.alert('Error', 'Name is required.'); return; }
    setSaving(true);
    const payload = { name: emiForm.name.trim(), lender: emiForm.lender.trim(), amount: parseFloat(emiForm.amount) || 0, due_day: parseInt(emiForm.due_day) || 1, total_months: parseInt(emiForm.total_months) || 1, paid_months: parseInt(emiForm.paid_months) || 0 };
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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.pageHeader}>
        <Text style={styles.pageTitle}>Budget</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => { if (tab === 'subs') { setEditingSub(null); setSubForm(emptySub()); setShowSubForm(true); } else { setEditingEmi(null); setEmiForm(emptyEmi()); setShowEmiForm(true); } }}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={20} color={colors.white} />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        <TouchableOpacity style={[styles.tabBtn, tab === 'subs' && styles.tabBtnActive]} onPress={() => setTab('subs')}>
          <Text style={[styles.tabLabel, tab === 'subs' && styles.tabLabelActive]}>Subscriptions</Text>
          <Text style={[styles.tabAmount, tab === 'subs' && styles.tabLabelActive]}>{formatINR(subTotal)}/mo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, tab === 'emis' && styles.tabBtnActive]} onPress={() => setTab('emis')}>
          <Text style={[styles.tabLabel, tab === 'emis' && styles.tabLabelActive]}>EMIs</Text>
          <Text style={[styles.tabAmount, tab === 'emis' && styles.tabLabelActive]}>{formatINR(emiTotal)}/mo</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAll(); }} tintColor={colors.accent} />}
        showsVerticalScrollIndicator={false}
      >
        {tab === 'subs' && (
          subs.length === 0 ? <EmptyState icon="receipt-outline" title="No subscriptions" subtitle="Tap + to add a recurring subscription" /> :
          subs.map(s => (
            <ItemCard
              key={s.id}
              title={s.name}
              subtitle={`${s.billing_cycle} · due day ${s.due_day}`}
              badge={s.category}
              amount={formatINR(s.amount)}
              onEdit={() => { setEditingSub(s); setSubForm({ name: s.name, amount: String(s.amount), billing_cycle: s.billing_cycle, due_day: String(s.due_day), category: s.category }); setShowSubForm(true); }}
              onDelete={() => deleteSub(s)}
            />
          ))
        )}

        {tab === 'emis' && (
          emis.length === 0 ? <EmptyState icon="trending-down-outline" title="No EMIs" subtitle="Tap + to add a loan instalment" /> :
          emis.map(e => (
            <ItemCard
              key={e.id}
              title={e.name}
              subtitle={`${e.lender} · due day ${e.due_day}`}
              badge={`${e.paid_months}/${e.total_months} months`}
              amount={formatINR(e.amount)}
              progress={e.total_months > 0 ? e.paid_months / e.total_months : 0}
              onEdit={() => { setEditingEmi(e); setEmiForm({ name: e.name, lender: e.lender, amount: String(e.amount), due_day: String(e.due_day), total_months: String(e.total_months), paid_months: String(e.paid_months) }); setShowEmiForm(true); }}
              onDelete={() => deleteEmiItem(e)}
            />
          ))
        )}
      </ScrollView>

      {/* Subscription form */}
      <FormModal visible={showSubForm} title={editingSub ? 'Edit Subscription' : 'Add Subscription'} onClose={() => setShowSubForm(false)}>
        <FormField label="Name"><TextInput style={inputStyle} placeholder="Netflix" placeholderTextColor={colors.textFaint} value={subForm.name} onChangeText={v => setSubForm(f => ({ ...f, name: v }))} /></FormField>
        <FormField label="Amount (₹)"><TextInput style={inputStyle} placeholder="649" placeholderTextColor={colors.textFaint} value={subForm.amount} onChangeText={v => setSubForm(f => ({ ...f, amount: v }))} keyboardType="decimal-pad" /></FormField>
        <FormField label="Billing Cycle"><TextInput style={inputStyle} placeholder="monthly" placeholderTextColor={colors.textFaint} value={subForm.billing_cycle} onChangeText={v => setSubForm(f => ({ ...f, billing_cycle: v }))} /></FormField>
        <FormField label="Due Day (1–31)"><TextInput style={inputStyle} placeholder="5" placeholderTextColor={colors.textFaint} value={subForm.due_day} onChangeText={v => setSubForm(f => ({ ...f, due_day: v }))} keyboardType="number-pad" /></FormField>
        <FormField label="Category"><TextInput style={inputStyle} placeholder="Entertainment" placeholderTextColor={colors.textFaint} value={subForm.category} onChangeText={v => setSubForm(f => ({ ...f, category: v }))} /></FormField>
        <PrimaryButton label={saving ? 'Saving…' : editingSub ? 'Update' : 'Add Subscription'} onPress={saveSub} disabled={saving} />
      </FormModal>

      {/* EMI form */}
      <FormModal visible={showEmiForm} title={editingEmi ? 'Edit EMI' : 'Add EMI'} onClose={() => setShowEmiForm(false)}>
        <FormField label="Name"><TextInput style={inputStyle} placeholder="Home Loan" placeholderTextColor={colors.textFaint} value={emiForm.name} onChangeText={v => setEmiForm(f => ({ ...f, name: v }))} /></FormField>
        <FormField label="Lender"><TextInput style={inputStyle} placeholder="SBI" placeholderTextColor={colors.textFaint} value={emiForm.lender} onChangeText={v => setEmiForm(f => ({ ...f, lender: v }))} /></FormField>
        <FormField label="Monthly Amount (₹)"><TextInput style={inputStyle} placeholder="25000" placeholderTextColor={colors.textFaint} value={emiForm.amount} onChangeText={v => setEmiForm(f => ({ ...f, amount: v }))} keyboardType="decimal-pad" /></FormField>
        <FormField label="Due Day (1–31)"><TextInput style={inputStyle} placeholder="5" placeholderTextColor={colors.textFaint} value={emiForm.due_day} onChangeText={v => setEmiForm(f => ({ ...f, due_day: v }))} keyboardType="number-pad" /></FormField>
        <FormField label="Total Months"><TextInput style={inputStyle} placeholder="240" placeholderTextColor={colors.textFaint} value={emiForm.total_months} onChangeText={v => setEmiForm(f => ({ ...f, total_months: v }))} keyboardType="number-pad" /></FormField>
        <FormField label="Paid Months"><TextInput style={inputStyle} placeholder="12" placeholderTextColor={colors.textFaint} value={emiForm.paid_months} onChangeText={v => setEmiForm(f => ({ ...f, paid_months: v }))} keyboardType="number-pad" /></FormField>
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
  pageTitle: { fontSize: font.xl, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  addBtn: { backgroundColor: colors.accent, width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  tabRow: { flexDirection: 'row', marginHorizontal: spacing.md, marginBottom: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 4, borderWidth: 1, borderColor: colors.border },
  tabBtn: { flex: 1, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radius.md, alignItems: 'center' },
  tabBtnActive: { backgroundColor: colors.accentBg, borderWidth: 1, borderColor: colors.accentBorder },
  tabLabel: { fontSize: font.sm, fontWeight: '600', color: colors.textMuted },
  tabLabelActive: { color: colors.accent },
  tabAmount: { fontSize: font.xs, color: colors.textFaint, marginTop: 1 },
});
