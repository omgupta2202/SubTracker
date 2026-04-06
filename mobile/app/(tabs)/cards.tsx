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
  getCards, createCard, updateCard, deleteCard,
  getCardTransactions, addCardTransaction, deleteCardTransaction,
} from '@/services/api';
import { formatINR, formatDate } from '@/lib/utils';
import { colors, spacing, font, radius } from '@/constants/theme';
import type { CreditCard, CardTransaction } from '@/types';

type CardForm = { name: string; bank: string; last4: string; outstanding: string; minimum_due: string; due_day: string };
const emptyForm = (): CardForm => ({ name: '', bank: '', last4: '', outstanding: '', minimum_due: '', due_day: '' });

export default function CardsScreen() {
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingCard, setEditingCard] = useState<CreditCard | null>(null);
  const [form, setForm] = useState<CardForm>(emptyForm());
  const [saving, setSaving] = useState(false);

  // Transaction panel
  const [txnCard, setTxnCard] = useState<CreditCard | null>(null);
  const [txns, setTxns] = useState<CardTransaction[]>([]);
  const [txnLoading, setTxnLoading] = useState(false);
  const [txnDesc, setTxnDesc] = useState('');
  const [txnAmount, setTxnAmount] = useState('');
  const [txnDate, setTxnDate] = useState('');
  const [addingTxn, setAddingTxn] = useState(false);

  const fetchCards = useCallback(async () => {
    try { setCards(await getCards()); }
    catch { /* silent */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchCards(); }, [fetchCards]);

  const openAdd = () => { setEditingCard(null); setForm(emptyForm()); setShowForm(true); };
  const openEdit = (card: CreditCard) => {
    setEditingCard(card);
    setForm({ name: card.name, bank: card.bank, last4: card.last4, outstanding: String(card.outstanding), minimum_due: String(card.minimum_due), due_day: String(card.due_day ?? '') });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { Alert.alert('Error', 'Card name is required.'); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(), bank: form.bank.trim(), last4: form.last4.trim(),
      outstanding: parseFloat(form.outstanding) || 0,
      minimum_due: parseFloat(form.minimum_due) || 0,
      due_day: parseInt(form.due_day) || 1,
    };
    try {
      if (editingCard) await updateCard(editingCard.id, payload);
      else await createCard(payload as any);
      setShowForm(false);
      fetchCards();
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = (card: CreditCard) => {
    Alert.alert('Delete card', `Delete "${card.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteCard(card.id); fetchCards(); } },
    ]);
  };

  const openTxns = async (card: CreditCard) => {
    setTxnCard(card); setTxnLoading(true); setTxns([]);
    try { setTxns(await getCardTransactions(card.id)); }
    catch { /* silent */ }
    finally { setTxnLoading(false); }
  };

  const handleAddTxn = async () => {
    if (!txnDesc.trim() || !txnAmount) return;
    setAddingTxn(true);
    try {
      await addCardTransaction(txnCard!.id, { description: txnDesc.trim(), amount: parseFloat(txnAmount), txn_date: txnDate || undefined });
      setTxnDesc(''); setTxnAmount(''); setTxnDate('');
      setTxns(await getCardTransactions(txnCard!.id));
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setAddingTxn(false); }
  };

  const handleDeleteTxn = async (txn: CardTransaction) => {
    if (txn.statement_id) { Alert.alert('Cannot delete', 'Billed transactions cannot be deleted.'); return; }
    await deleteCardTransaction(txnCard!.id, txn.id);
    setTxns(await getCardTransactions(txnCard!.id));
  };

  if (loading) return <Loader />;

  // Transaction panel
  if (txnCard) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.subHeader}>
          <TouchableOpacity onPress={() => setTxnCard(null)} style={styles.backBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={20} color={colors.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.subTitle}>{txnCard.name} · Transactions</Text>
          </View>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Add transaction */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Add Transaction</Text>
            <TextInput style={inputStyle} placeholder="Description" placeholderTextColor={colors.textFaint} value={txnDesc} onChangeText={setTxnDesc} />
            <TextInput style={inputStyle} placeholder="Amount (₹)" placeholderTextColor={colors.textFaint} value={txnAmount} onChangeText={setTxnAmount} keyboardType="decimal-pad" />
            <TextInput style={inputStyle} placeholder="Date (YYYY-MM-DD, optional)" placeholderTextColor={colors.textFaint} value={txnDate} onChangeText={setTxnDate} />
            <PrimaryButton label={addingTxn ? 'Adding…' : 'Add Transaction'} onPress={handleAddTxn} disabled={addingTxn} />
          </View>

          {txnLoading ? <Loader /> : txns.length === 0 ? (
            <EmptyState icon="receipt-outline" title="No transactions" subtitle="Add your first transaction above" />
          ) : txns.map(t => (
            <ItemCard
              key={t.id}
              title={t.description}
              subtitle={formatDate(t.txn_date)}
              badge={t.statement_id ? 'Billed' : 'Unbilled'}
              amount={formatINR(t.amount)}
              onDelete={() => handleDeleteTxn(t)}
            />
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.pageHeader}>
        <Text style={styles.pageTitle}>Credit Cards</Text>
        <TouchableOpacity style={styles.addBtn} onPress={openAdd} activeOpacity={0.8}>
          <Ionicons name="add" size={20} color={colors.white} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchCards(); }} tintColor={colors.accent} />}
        showsVerticalScrollIndicator={false}
      >
        {cards.length === 0 ? (
          <EmptyState icon="card-outline" title="No cards yet" subtitle="Tap + to add your first credit card" />
        ) : cards.map(card => (
          <ItemCard
            key={card.id}
            title={card.last4 ? `${card.name} ···· ${card.last4}` : card.name}
            subtitle={`${card.bank} · due day ${card.due_day}`}
            badge={`Min ${formatINR(card.minimum_due)}`}
            amount={formatINR(card.outstanding)}
            amountDanger={card.outstanding > 0}
            progress={card.outstanding > 0 ? card.minimum_due / card.outstanding : 0}
            onEdit={() => openEdit(card)}
            onDelete={() => handleDelete(card)}
          >
            <TouchableOpacity onPress={() => openTxns(card)} style={styles.txnLink}>
              <Ionicons name="list-outline" size={13} color={colors.accent} />
              <Text style={styles.txnLinkText}>View Transactions</Text>
            </TouchableOpacity>
          </ItemCard>
        ))}
      </ScrollView>

      <FormModal visible={showForm} title={editingCard ? 'Edit Card' : 'Add Card'} onClose={() => setShowForm(false)}>
        <FormField label="Card Name"><TextInput style={inputStyle} placeholder="HDFC Millennia" placeholderTextColor={colors.textFaint} value={form.name} onChangeText={v => setForm(f => ({ ...f, name: v }))} /></FormField>
        <FormField label="Bank"><TextInput style={inputStyle} placeholder="HDFC" placeholderTextColor={colors.textFaint} value={form.bank} onChangeText={v => setForm(f => ({ ...f, bank: v }))} /></FormField>
        <FormField label="Last 4 Digits"><TextInput style={inputStyle} placeholder="1234" placeholderTextColor={colors.textFaint} value={form.last4} onChangeText={v => setForm(f => ({ ...f, last4: v }))} keyboardType="number-pad" maxLength={4} /></FormField>
        <FormField label="Outstanding (₹)"><TextInput style={inputStyle} placeholder="0" placeholderTextColor={colors.textFaint} value={form.outstanding} onChangeText={v => setForm(f => ({ ...f, outstanding: v }))} keyboardType="decimal-pad" /></FormField>
        <FormField label="Minimum Due (₹)"><TextInput style={inputStyle} placeholder="0" placeholderTextColor={colors.textFaint} value={form.minimum_due} onChangeText={v => setForm(f => ({ ...f, minimum_due: v }))} keyboardType="decimal-pad" /></FormField>
        <FormField label="Due Day (1–31)"><TextInput style={inputStyle} placeholder="15" placeholderTextColor={colors.textFaint} value={form.due_day} onChangeText={v => setForm(f => ({ ...f, due_day: v }))} keyboardType="number-pad" /></FormField>
        <PrimaryButton label={saving ? 'Saving…' : editingCard ? 'Update Card' : 'Add Card'} onPress={handleSave} disabled={saving} />
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
  subHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  backBtn: { padding: spacing.xs },
  subTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.md },
  sectionTitle: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  txnLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  txnLinkText: { fontSize: font.xs, color: colors.accent, fontWeight: '600' },
});
