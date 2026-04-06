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
  getAccounts, createAccount, updateAccount, deleteAccount,
  getReceivables, createReceivable, updateReceivable, deleteReceivable,
  getCapex, createCapex, updateCapex, deleteCapex,
  getRent, updateRent,
} from '@/services/api';
import { formatINR } from '@/lib/utils';
import { colors, spacing, font, radius } from '@/constants/theme';
import type { BankAccount, Receivable, CapExItem, Rent } from '@/types';

type Section = 'accounts' | 'receivables' | 'capex' | 'rent';

export default function MoreScreen() {
  const [section, setSection] = useState<Section>('accounts');
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const [capex, setCapex] = useState<CapExItem[]>([]);
  const [rent, setRent] = useState<Rent>({ amount: 0, due_day: 1 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Forms
  const [showAcctForm, setShowAcctForm] = useState(false);
  const [editingAcct, setEditingAcct] = useState<BankAccount | null>(null);
  const [acctForm, setAcctForm] = useState({ name: '', bank: '', balance: '' });

  const [showRxForm, setShowRxForm] = useState(false);
  const [editingRx, setEditingRx] = useState<Receivable | null>(null);
  const [rxForm, setRxForm] = useState({ name: '', source: '', amount: '', expected_day: '' });

  const [showCapexForm, setShowCapexForm] = useState(false);
  const [editingCapex, setEditingCapex] = useState<CapExItem | null>(null);
  const [capexForm, setCapexForm] = useState({ name: '', amount: '', category: '' });

  const [rentForm, setRentForm] = useState({ amount: '', due_day: '' });

  const fetchAll = useCallback(async () => {
    try {
      const [a, r, c, rn] = await Promise.all([getAccounts(), getReceivables(), getCapex(), getRent()]);
      setAccounts(a); setReceivables(r); setCapex(c); setRent(rn);
      setRentForm({ amount: String(rn.amount), due_day: String(rn.due_day) });
    } catch { /* silent */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Accounts
  const saveAcct = async () => {
    setSaving(true);
    const p = { name: acctForm.name.trim(), bank: acctForm.bank.trim(), balance: parseFloat(acctForm.balance) || 0 };
    try { if (editingAcct) await updateAccount(editingAcct.id, p); else await createAccount(p); setShowAcctForm(false); fetchAll(); }
    catch (e: any) { Alert.alert('Error', e.message); } finally { setSaving(false); }
  };
  const delAcct = (a: BankAccount) => Alert.alert('Delete', `Delete "${a.name}"?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await deleteAccount(a.id); fetchAll(); } }]);

  // Receivables
  const saveRx = async () => {
    setSaving(true);
    const p = { name: rxForm.name.trim(), source: rxForm.source.trim(), amount: parseFloat(rxForm.amount) || 0, expected_day: parseInt(rxForm.expected_day) || 1 };
    try { if (editingRx) await updateReceivable(editingRx.id, p); else await createReceivable(p); setShowRxForm(false); fetchAll(); }
    catch (e: any) { Alert.alert('Error', e.message); } finally { setSaving(false); }
  };
  const delRx = (r: Receivable) => Alert.alert('Delete', `Delete "${r.name}"?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await deleteReceivable(r.id); fetchAll(); } }]);

  // CapEx
  const saveCapexItem = async () => {
    setSaving(true);
    const p = { name: capexForm.name.trim(), amount: parseFloat(capexForm.amount) || 0, category: capexForm.category.trim() };
    try { if (editingCapex) await updateCapex(editingCapex.id, p); else await createCapex(p); setShowCapexForm(false); fetchAll(); }
    catch (e: any) { Alert.alert('Error', e.message); } finally { setSaving(false); }
  };
  const delCapex = (c: CapExItem) => Alert.alert('Delete', `Delete "${c.name}"?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await deleteCapex(c.id); fetchAll(); } }]);

  // Rent
  const saveRent = async () => {
    setSaving(true);
    try { await updateRent({ amount: parseFloat(rentForm.amount) || 0, due_day: parseInt(rentForm.due_day) || 1 }); Alert.alert('Saved', 'Rent updated.'); fetchAll(); }
    catch (e: any) { Alert.alert('Error', e.message); } finally { setSaving(false); }
  };

  if (loading) return <Loader />;

  const sections: { key: Section; label: string; icon: string }[] = [
    { key: 'accounts', label: 'Accounts', icon: 'business-outline' },
    { key: 'receivables', label: 'Inflows', icon: 'arrow-down-circle-outline' },
    { key: 'capex', label: 'CapEx', icon: 'flag-outline' },
    { key: 'rent', label: 'Rent', icon: 'home-outline' },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.pageHeader}>
        <Text style={styles.pageTitle}>More</Text>
        {section !== 'rent' && (
          <TouchableOpacity style={styles.addBtn} activeOpacity={0.8} onPress={() => {
            if (section === 'accounts') { setEditingAcct(null); setAcctForm({ name: '', bank: '', balance: '' }); setShowAcctForm(true); }
            else if (section === 'receivables') { setEditingRx(null); setRxForm({ name: '', source: '', amount: '', expected_day: '' }); setShowRxForm(true); }
            else if (section === 'capex') { setEditingCapex(null); setCapexForm({ name: '', amount: '', category: '' }); setShowCapexForm(true); }
          }}>
            <Ionicons name="add" size={20} color={colors.white} />
          </TouchableOpacity>
        )}
      </View>

      {/* Section nav */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.navRow}>
        {sections.map(s => (
          <TouchableOpacity key={s.key} style={[styles.navBtn, section === s.key && styles.navBtnActive]} onPress={() => setSection(s.key)}>
            <Ionicons name={s.icon as any} size={14} color={section === s.key ? colors.accent : colors.textMuted} />
            <Text style={[styles.navLabel, section === s.key && styles.navLabelActive]}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAll(); }} tintColor={colors.accent} />}
        showsVerticalScrollIndicator={false}
      >
        {section === 'accounts' && (
          accounts.length === 0 ? <EmptyState icon="business-outline" title="No accounts" subtitle="Tap + to add a bank account" /> :
          accounts.map(a => <ItemCard key={a.id} title={a.name} subtitle={a.bank} amount={formatINR(a.balance)} accent onEdit={() => { setEditingAcct(a); setAcctForm({ name: a.name, bank: a.bank, balance: String(a.balance) }); setShowAcctForm(true); }} onDelete={() => delAcct(a)} />)
        )}

        {section === 'receivables' && (
          receivables.length === 0 ? <EmptyState icon="arrow-down-circle-outline" title="No inflows" subtitle="Tap + to add expected income" /> :
          receivables.map(r => <ItemCard key={r.id} title={r.name} subtitle={`${r.source} · expected day ${r.expected_day}`} amount={formatINR(r.amount)} onEdit={() => { setEditingRx(r); setRxForm({ name: r.name, source: r.source, amount: String(r.amount), expected_day: String(r.expected_day) }); setShowRxForm(true); }} onDelete={() => delRx(r)} />)
        )}

        {section === 'capex' && (
          capex.length === 0 ? <EmptyState icon="flag-outline" title="No CapEx" subtitle="Tap + to add a planned spend" /> :
          capex.map(c => <ItemCard key={c.id} title={c.name} badge={c.category} amount={formatINR(c.amount)} onEdit={() => { setEditingCapex(c); setCapexForm({ name: c.name, amount: String(c.amount), category: c.category }); setShowCapexForm(true); }} onDelete={() => delCapex(c)} />)
        )}

        {section === 'rent' && (
          <View style={styles.card}>
            <Text style={styles.cardHint}>Fixed monthly rent deducted from net liquidity.</Text>
            <FormField label="Monthly Rent (₹)"><TextInput style={inputStyle} placeholder="0" placeholderTextColor={colors.textFaint} value={rentForm.amount} onChangeText={v => setRentForm(f => ({ ...f, amount: v }))} keyboardType="decimal-pad" /></FormField>
            <FormField label="Due Day (1–31)"><TextInput style={inputStyle} placeholder="1" placeholderTextColor={colors.textFaint} value={rentForm.due_day} onChangeText={v => setRentForm(f => ({ ...f, due_day: v }))} keyboardType="number-pad" /></FormField>
            <PrimaryButton label={saving ? 'Saving…' : 'Update Rent'} onPress={saveRent} disabled={saving} />
          </View>
        )}
      </ScrollView>

      {/* Account form */}
      <FormModal visible={showAcctForm} title={editingAcct ? 'Edit Account' : 'Add Account'} onClose={() => setShowAcctForm(false)}>
        <FormField label="Account Name"><TextInput style={inputStyle} placeholder="HDFC Savings" placeholderTextColor={colors.textFaint} value={acctForm.name} onChangeText={v => setAcctForm(f => ({ ...f, name: v }))} /></FormField>
        <FormField label="Bank"><TextInput style={inputStyle} placeholder="HDFC" placeholderTextColor={colors.textFaint} value={acctForm.bank} onChangeText={v => setAcctForm(f => ({ ...f, bank: v }))} /></FormField>
        <FormField label="Balance (₹)"><TextInput style={inputStyle} placeholder="0" placeholderTextColor={colors.textFaint} value={acctForm.balance} onChangeText={v => setAcctForm(f => ({ ...f, balance: v }))} keyboardType="decimal-pad" /></FormField>
        <PrimaryButton label={saving ? 'Saving…' : editingAcct ? 'Update' : 'Add Account'} onPress={saveAcct} disabled={saving} />
      </FormModal>

      {/* Receivable form */}
      <FormModal visible={showRxForm} title={editingRx ? 'Edit Inflow' : 'Add Inflow'} onClose={() => setShowRxForm(false)}>
        <FormField label="Name"><TextInput style={inputStyle} placeholder="Salary" placeholderTextColor={colors.textFaint} value={rxForm.name} onChangeText={v => setRxForm(f => ({ ...f, name: v }))} /></FormField>
        <FormField label="Source"><TextInput style={inputStyle} placeholder="Employer" placeholderTextColor={colors.textFaint} value={rxForm.source} onChangeText={v => setRxForm(f => ({ ...f, source: v }))} /></FormField>
        <FormField label="Amount (₹)"><TextInput style={inputStyle} placeholder="0" placeholderTextColor={colors.textFaint} value={rxForm.amount} onChangeText={v => setRxForm(f => ({ ...f, amount: v }))} keyboardType="decimal-pad" /></FormField>
        <FormField label="Expected Day (1–31)"><TextInput style={inputStyle} placeholder="1" placeholderTextColor={colors.textFaint} value={rxForm.expected_day} onChangeText={v => setRxForm(f => ({ ...f, expected_day: v }))} keyboardType="number-pad" /></FormField>
        <PrimaryButton label={saving ? 'Saving…' : editingRx ? 'Update' : 'Add Inflow'} onPress={saveRx} disabled={saving} />
      </FormModal>

      {/* CapEx form */}
      <FormModal visible={showCapexForm} title={editingCapex ? 'Edit CapEx' : 'Add CapEx'} onClose={() => setShowCapexForm(false)}>
        <FormField label="Name"><TextInput style={inputStyle} placeholder="MacBook Pro" placeholderTextColor={colors.textFaint} value={capexForm.name} onChangeText={v => setCapexForm(f => ({ ...f, name: v }))} /></FormField>
        <FormField label="Amount (₹)"><TextInput style={inputStyle} placeholder="0" placeholderTextColor={colors.textFaint} value={capexForm.amount} onChangeText={v => setCapexForm(f => ({ ...f, amount: v }))} keyboardType="decimal-pad" /></FormField>
        <FormField label="Category"><TextInput style={inputStyle} placeholder="Tech" placeholderTextColor={colors.textFaint} value={capexForm.category} onChangeText={v => setCapexForm(f => ({ ...f, category: v }))} /></FormField>
        <PrimaryButton label={saving ? 'Saving…' : editingCapex ? 'Update' : 'Add CapEx'} onPress={saveCapexItem} disabled={saving} />
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
  navRow: { paddingHorizontal: spacing.md, gap: spacing.xs, paddingBottom: spacing.sm },
  navBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  navBtnActive: { backgroundColor: colors.accentBg, borderColor: colors.accentBorder },
  navLabel: { fontSize: font.sm, fontWeight: '600', color: colors.textMuted },
  navLabelActive: { color: colors.accent },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.md },
  cardHint: { fontSize: font.sm, color: colors.textFaint },
});
