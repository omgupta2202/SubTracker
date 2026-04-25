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
  getAccounts, createAccount, updateAccount, deleteAccount,
  getReceivables, createReceivable, updateReceivable, deleteReceivable,
  getCapex, createCapex, updateCapex, deleteCapex,
  getRent, updateRent,
} from '@/services/api';
import {
  colors, spacing, font, fontWeight, radius,
  inrCompact, bankDot,
} from '@/constants/theme';
import type { BankAccount, Receivable, CapExItem, Rent } from '@/types';

export default function MoreScreen() {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const [capex, setCapex] = useState<CapExItem[]>([]);
  const [rent, setRent] = useState<Rent>({ amount: 0, due_day: 1 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [showAcctForm, setShowAcctForm] = useState(false);
  const [editingAcct, setEditingAcct] = useState<BankAccount | null>(null);
  const [acctForm, setAcctForm] = useState({ name: '', bank: '', balance: '' });

  const [showRxForm, setShowRxForm] = useState(false);
  const [editingRx, setEditingRx] = useState<Receivable | null>(null);
  const [rxForm, setRxForm] = useState({ name: '', source: '', amount: '', expected_day: '' });

  const [showCapexForm, setShowCapexForm] = useState(false);
  const [editingCapex, setEditingCapex] = useState<CapExItem | null>(null);
  const [capexForm, setCapexForm] = useState({ name: '', amount: '', category: '' });

  const [showRentForm, setShowRentForm] = useState(false);
  const [rentForm, setRentForm] = useState({ amount: '', due_day: '' });

  const fetchAll = useCallback(async () => {
    try {
      const [a, r, c, rn] = await Promise.all([getAccounts(), getReceivables(), getCapex(), getRent()]);
      setAccounts(a); setReceivables(r); setCapex(c); setRent(rn);
      setRentForm({ amount: String(rn.amount || 0), due_day: String(rn.due_day || 1) });
    } catch { /* silent */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const saveAcct = async () => {
    setSaving(true);
    const p = { name: acctForm.name.trim(), bank: acctForm.bank.trim(), balance: parseFloat(acctForm.balance) || 0 };
    try {
      if (editingAcct) await updateAccount(editingAcct.id, p);
      else await createAccount(p);
      setShowAcctForm(false); fetchAll();
    } catch (e: any) { Alert.alert('Error', e.message); } finally { setSaving(false); }
  };
  const delAcct = (a: BankAccount) => Alert.alert('Delete', `Delete "${a.name}"?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => { await deleteAccount(a.id); fetchAll(); } },
  ]);

  const saveRx = async () => {
    setSaving(true);
    const p = { name: rxForm.name.trim(), source: rxForm.source.trim(), amount: parseFloat(rxForm.amount) || 0, expected_day: parseInt(rxForm.expected_day) || 1 };
    try {
      if (editingRx) await updateReceivable(editingRx.id, p);
      else await createReceivable(p);
      setShowRxForm(false); fetchAll();
    } catch (e: any) { Alert.alert('Error', e.message); } finally { setSaving(false); }
  };
  const delRx = (r: Receivable) => Alert.alert('Delete', `Delete "${r.name}"?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => { await deleteReceivable(r.id); fetchAll(); } },
  ]);

  const saveCapexItem = async () => {
    setSaving(true);
    const p = { name: capexForm.name.trim(), amount: parseFloat(capexForm.amount) || 0, category: capexForm.category.trim() };
    try {
      if (editingCapex) await updateCapex(editingCapex.id, p);
      else await createCapex(p);
      setShowCapexForm(false); fetchAll();
    } catch (e: any) { Alert.alert('Error', e.message); } finally { setSaving(false); }
  };
  const delCapex = (c: CapExItem) => Alert.alert('Delete', `Delete "${c.name}"?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => { await deleteCapex(c.id); fetchAll(); } },
  ]);

  const saveRentValue = async () => {
    setSaving(true);
    try {
      await updateRent({ amount: parseFloat(rentForm.amount) || 0, due_day: parseInt(rentForm.due_day) || 1 });
      setShowRentForm(false); fetchAll();
    } catch (e: any) { Alert.alert('Error', e.message); } finally { setSaving(false); }
  };

  if (loading) return <Loader />;

  const totalLiquid = accounts.reduce((s, a) => s + a.balance, 0);
  const totalRx = receivables.reduce((s, r) => s + r.amount, 0);
  const totalCapex = capex.reduce((s, c) => s + c.amount, 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.pageHeader}>
        <Text style={styles.pageTitle}>More</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAll(); }} tintColor={colors.accent} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Accounts */}
        <Card>
          <CardHeader
            action={
              <TouchableOpacity onPress={() => { setEditingAcct(null); setAcctForm({ name: '', bank: '', balance: '' }); setShowAcctForm(true); }} hitSlop={6}>
                <Ionicons name="add" size={18} color={colors.accent} />
              </TouchableOpacity>
            }
          >
            <CardTitle icon={<Ionicons name="business-outline" size={13} color={colors.accent} />}>
              Accounts · {accounts.length}
            </CardTitle>
          </CardHeader>

          <Stat label="Total liquid" value={totalLiquid} size="lg" tone="good" />

          {accounts.length === 0 ? (
            <EmptyState icon="business-outline" title="No accounts" subtitle="Tap + to add a bank account" />
          ) : (
            <View style={{ gap: 2, marginTop: spacing.sm }}>
              {accounts.map(a => (
                <TouchableOpacity
                  key={a.id}
                  onPress={() => { setEditingAcct(a); setAcctForm({ name: a.name, bank: a.bank, balance: String(a.balance) }); setShowAcctForm(true); }}
                  onLongPress={() => delAcct(a)}
                  delayLongPress={400}
                >
                  <Row dot={bankDot(a.bank)} label={a.name} helper={a.bank} value={inrCompact(a.balance)} />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </Card>

        {/* Receivables */}
        <Card style={{ marginTop: spacing.md }}>
          <CardHeader
            action={
              <TouchableOpacity onPress={() => { setEditingRx(null); setRxForm({ name: '', source: '', amount: '', expected_day: '' }); setShowRxForm(true); }} hitSlop={6}>
                <Ionicons name="add" size={18} color={colors.accent} />
              </TouchableOpacity>
            }
          >
            <CardTitle icon={<Ionicons name="arrow-down-circle-outline" size={13} color={colors.accent} />}>
              Inflows · {receivables.length}
            </CardTitle>
          </CardHeader>

          <Stat label="Owed to me" value={totalRx} size="lg" tone="good" />

          {receivables.length === 0 ? (
            <EmptyState icon="arrow-down-circle-outline" title="No inflows" subtitle="Tap + to add expected income" />
          ) : (
            <View style={{ gap: 2, marginTop: spacing.sm }}>
              {receivables.map(r => (
                <TouchableOpacity
                  key={r.id}
                  onPress={() => { setEditingRx(r); setRxForm({ name: r.name, source: r.source, amount: String(r.amount), expected_day: String(r.expected_day) }); setShowRxForm(true); }}
                  onLongPress={() => delRx(r)}
                  delayLongPress={400}
                >
                  <Row
                    dot={colors.good}
                    label={
                      <View>
                        <Text style={styles.itemName}>{r.name}</Text>
                        <Text style={styles.itemMeta}>{r.source} · day {r.expected_day}</Text>
                      </View>
                    }
                    valueTone="good"
                    value={inrCompact(r.amount)}
                  />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </Card>

        {/* CapEx */}
        <Card style={{ marginTop: spacing.md }}>
          <CardHeader
            action={
              <TouchableOpacity onPress={() => { setEditingCapex(null); setCapexForm({ name: '', amount: '', category: '' }); setShowCapexForm(true); }} hitSlop={6}>
                <Ionicons name="add" size={18} color={colors.accent} />
              </TouchableOpacity>
            }
          >
            <CardTitle icon={<Ionicons name="flag-outline" size={13} color={colors.accent} />}>
              Planned CapEx · {capex.length}
            </CardTitle>
          </CardHeader>

          <Stat label="Planned spend" value={totalCapex} size="lg" tone="warn" />

          {capex.length === 0 ? (
            <EmptyState icon="flag-outline" title="No CapEx" subtitle="Tap + to add a planned spend" />
          ) : (
            <View style={{ gap: 2, marginTop: spacing.sm }}>
              {capex.map(c => (
                <TouchableOpacity
                  key={c.id}
                  onPress={() => { setEditingCapex(c); setCapexForm({ name: c.name, amount: String(c.amount), category: c.category }); setShowCapexForm(true); }}
                  onLongPress={() => delCapex(c)}
                  delayLongPress={400}
                >
                  <Row
                    dot={colors.warn}
                    label={
                      <View>
                        <Text style={styles.itemName}>{c.name}</Text>
                        <Text style={styles.itemMeta}>{c.category}</Text>
                      </View>
                    }
                    value={inrCompact(c.amount)}
                  />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </Card>

        {/* Rent */}
        <Card style={{ marginTop: spacing.md }}>
          <CardHeader
            action={
              <TouchableOpacity onPress={() => { setRentForm({ amount: String(rent.amount || 0), due_day: String(rent.due_day || 1) }); setShowRentForm(true); }} hitSlop={6}>
                <Ionicons name="pencil-outline" size={14} color={colors.textMuted} />
              </TouchableOpacity>
            }
          >
            <CardTitle icon={<Ionicons name="home-outline" size={13} color={colors.accent} />}>
              Rent
            </CardTitle>
          </CardHeader>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <Stat
              value={rent.amount}
              size="lg"
              tone={rent.amount > 0 ? 'bad' : 'muted'}
              label="Monthly"
              helper={rent.amount > 0 ? `due day ${rent.due_day}` : 'tap to set'}
            />
          </View>
        </Card>

        <Text style={styles.hint}>Tap to edit · long-press to delete</Text>
      </ScrollView>

      {/* Account form */}
      <FormModal visible={showAcctForm} title={editingAcct ? 'Edit account' : 'Add account'} onClose={() => setShowAcctForm(false)}>
        <FormField label="Account name"><TextInput style={inputStyle} placeholder="HDFC Savings" placeholderTextColor={colors.textFaint} value={acctForm.name} onChangeText={v => setAcctForm(f => ({ ...f, name: v }))} /></FormField>
        <FormField label="Bank"><TextInput style={inputStyle} placeholder="HDFC" placeholderTextColor={colors.textFaint} value={acctForm.bank} onChangeText={v => setAcctForm(f => ({ ...f, bank: v }))} /></FormField>
        <FormField label="Balance (₹)"><TextInput style={inputStyle} placeholder="0" placeholderTextColor={colors.textFaint} value={acctForm.balance} onChangeText={v => setAcctForm(f => ({ ...f, balance: v }))} keyboardType="decimal-pad" /></FormField>
        <PrimaryButton label={saving ? 'Saving…' : editingAcct ? 'Update' : 'Add account'} onPress={saveAcct} disabled={saving} />
      </FormModal>

      {/* Receivable form */}
      <FormModal visible={showRxForm} title={editingRx ? 'Edit inflow' : 'Add inflow'} onClose={() => setShowRxForm(false)}>
        <FormField label="Name"><TextInput style={inputStyle} placeholder="Salary" placeholderTextColor={colors.textFaint} value={rxForm.name} onChangeText={v => setRxForm(f => ({ ...f, name: v }))} /></FormField>
        <FormField label="Source"><TextInput style={inputStyle} placeholder="Employer" placeholderTextColor={colors.textFaint} value={rxForm.source} onChangeText={v => setRxForm(f => ({ ...f, source: v }))} /></FormField>
        <FormField label="Amount (₹)"><TextInput style={inputStyle} placeholder="0" placeholderTextColor={colors.textFaint} value={rxForm.amount} onChangeText={v => setRxForm(f => ({ ...f, amount: v }))} keyboardType="decimal-pad" /></FormField>
        <FormField label="Expected day (1–31)"><TextInput style={inputStyle} placeholder="1" placeholderTextColor={colors.textFaint} value={rxForm.expected_day} onChangeText={v => setRxForm(f => ({ ...f, expected_day: v }))} keyboardType="number-pad" /></FormField>
        <PrimaryButton label={saving ? 'Saving…' : editingRx ? 'Update' : 'Add inflow'} onPress={saveRx} disabled={saving} />
      </FormModal>

      {/* CapEx form */}
      <FormModal visible={showCapexForm} title={editingCapex ? 'Edit CapEx' : 'Add CapEx'} onClose={() => setShowCapexForm(false)}>
        <FormField label="Name"><TextInput style={inputStyle} placeholder="MacBook Pro" placeholderTextColor={colors.textFaint} value={capexForm.name} onChangeText={v => setCapexForm(f => ({ ...f, name: v }))} /></FormField>
        <FormField label="Amount (₹)"><TextInput style={inputStyle} placeholder="0" placeholderTextColor={colors.textFaint} value={capexForm.amount} onChangeText={v => setCapexForm(f => ({ ...f, amount: v }))} keyboardType="decimal-pad" /></FormField>
        <FormField label="Category"><TextInput style={inputStyle} placeholder="Tech" placeholderTextColor={colors.textFaint} value={capexForm.category} onChangeText={v => setCapexForm(f => ({ ...f, category: v }))} /></FormField>
        <PrimaryButton label={saving ? 'Saving…' : editingCapex ? 'Update' : 'Add CapEx'} onPress={saveCapexItem} disabled={saving} />
      </FormModal>

      {/* Rent form */}
      <FormModal visible={showRentForm} title="Edit rent" onClose={() => setShowRentForm(false)}>
        <FormField label="Monthly rent (₹)"><TextInput style={inputStyle} placeholder="0" placeholderTextColor={colors.textFaint} value={rentForm.amount} onChangeText={v => setRentForm(f => ({ ...f, amount: v }))} keyboardType="decimal-pad" /></FormField>
        <FormField label="Due day (1–31)"><TextInput style={inputStyle} placeholder="1" placeholderTextColor={colors.textFaint} value={rentForm.due_day} onChangeText={v => setRentForm(f => ({ ...f, due_day: v }))} keyboardType="number-pad" /></FormField>
        <PrimaryButton label={saving ? 'Saving…' : 'Update rent'} onPress={saveRentValue} disabled={saving} />
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
  itemName: { fontSize: font.sm, color: colors.textSecondary },
  itemMeta: { fontSize: font.xs, color: colors.textFaint, marginTop: 1 },
  hint: { fontSize: font.xs, color: colors.textFaint, textAlign: 'center', marginTop: spacing.md, fontStyle: 'italic' },
});
