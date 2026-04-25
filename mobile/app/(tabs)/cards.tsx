import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, RefreshControl,
  TouchableOpacity, TextInput, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Card, CardHeader, CardTitle, Divider } from '@/components/ui/Card';
import { Stat, Row } from '@/components/ui/Stat';
import { EmptyState } from '@/components/EmptyState';
import { Loader } from '@/components/Loader';
import { FormModal, FormField, PrimaryButton, inputStyle } from '@/components/FormModal';
import {
  getCards, createCard, updateCard, deleteCard,
  getCardTransactions, addCardTransaction, deleteCardTransaction,
} from '@/services/api';
import { formatDate } from '@/lib/utils';
import {
  colors, spacing, font, fontWeight, radius,
  inrCompact, relativeDay, bankDot,
} from '@/constants/theme';
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

  // expanded card id → its transactions
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [txns, setTxns] = useState<CardTransaction[]>([]);
  const [txnLoading, setTxnLoading] = useState(false);
  const [txnDesc, setTxnDesc] = useState('');
  const [txnAmount, setTxnAmount] = useState('');
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
    setForm({
      name: card.name, bank: card.bank, last4: card.last4,
      outstanding: String(card.outstanding), minimum_due: String(card.minimum_due),
      due_day: String(card.due_day ?? ''),
    });
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

  const toggleExpand = async (cardId: string) => {
    if (expandedId === cardId) {
      setExpandedId(null); setTxns([]); return;
    }
    setExpandedId(cardId);
    setTxnLoading(true); setTxns([]);
    try { setTxns(await getCardTransactions(cardId)); }
    catch { /* silent */ }
    finally { setTxnLoading(false); }
  };

  const handleAddTxn = async () => {
    if (!expandedId || !txnDesc.trim() || !txnAmount) return;
    setAddingTxn(true);
    try {
      await addCardTransaction(expandedId, { description: txnDesc.trim(), amount: parseFloat(txnAmount) });
      setTxnDesc(''); setTxnAmount('');
      setTxns(await getCardTransactions(expandedId));
      fetchCards(); // refresh outstanding
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setAddingTxn(false); }
  };

  const handleDeleteTxn = async (txn: CardTransaction) => {
    if (!expandedId) return;
    if (txn.statement_id) { Alert.alert('Cannot delete', 'Billed transactions cannot be deleted.'); return; }
    await deleteCardTransaction(expandedId, txn.id);
    setTxns(await getCardTransactions(expandedId));
    fetchCards();
  };

  if (loading) return <Loader />;

  const totalOutstanding = cards.reduce((s, c) => s + c.outstanding, 0);
  const totalMinDue      = cards.reduce((s, c) => s + c.minimum_due, 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.pageHeader}>
        <Text style={styles.pageTitle}>Credit cards</Text>
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
        {/* Hero summary */}
        {cards.length > 0 && (
          <Card variant="hero">
            <View style={styles.heroRow}>
              <Stat
                label="Total outstanding"
                value={totalOutstanding}
                size="hero"
                tone={totalOutstanding > 0 ? 'bad' : 'good'}
              />
              <Stat label="Min due" value={totalMinDue} size="sm" align="right" tone="warn" />
            </View>
          </Card>
        )}

        {cards.length === 0 ? (
          <EmptyState icon="card-outline" title="No cards yet" subtitle="Tap + to add your first credit card" />
        ) : cards.map(card => {
          const due = card.due_date_offset ?? 99;
          const tone = due <= 3 ? colors.bad : due <= 7 ? colors.warn : colors.textMuted;
          const minPct = card.outstanding > 0 ? Math.min((card.minimum_due / card.outstanding) * 100, 100) : 0;
          const isOpen = expandedId === card.id;

          return (
            <Card key={card.id} style={{ marginTop: spacing.md }}>
              <CardHeader
                action={
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    <TouchableOpacity onPress={() => openEdit(card)} style={styles.iconBtn} hitSlop={6}>
                      <Ionicons name="pencil-outline" size={14} color={colors.textMuted} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDelete(card)} style={styles.iconBtn} hitSlop={6}>
                      <Ionicons name="trash-outline" size={14} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                }
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  <View style={[styles.bankPill, { backgroundColor: bankDot(card.bank) }]} />
                  <View>
                    <Text style={styles.cardName}>{card.name}</Text>
                    {card.last4 ? <Text style={styles.cardLast4}>···· {card.last4}</Text> : null}
                  </View>
                </View>
              </CardHeader>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <Stat
                  value={card.outstanding}
                  size="lg"
                  tone={card.outstanding > 0 ? 'bad' : 'good'}
                  label="Outstanding"
                />
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.metaLabel}>Min due</Text>
                  <Text style={styles.metaValue}>{inrCompact(card.minimum_due)}</Text>
                  <Text style={[styles.dueText, { color: tone }]}>{relativeDay(due)}</Text>
                </View>
              </View>

              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${minPct}%` }]} />
              </View>
              <Text style={styles.barCaption}>
                {Math.round(minPct)}% of outstanding is min-due
              </Text>

              <Divider />

              <TouchableOpacity onPress={() => toggleExpand(card.id)} style={styles.expandRow}>
                <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
                <Text style={styles.expandLabel}>
                  {isOpen ? 'Hide transactions' : 'View transactions'}
                </Text>
              </TouchableOpacity>

              {isOpen && (
                <View style={{ gap: spacing.sm }}>
                  {/* Quick-add inline */}
                  <View style={styles.txnAddRow}>
                    <TextInput
                      style={[inputStyle, { flex: 2 }]}
                      placeholder="Description"
                      placeholderTextColor={colors.textFaint}
                      value={txnDesc}
                      onChangeText={setTxnDesc}
                    />
                    <TextInput
                      style={[inputStyle, { flex: 1 }]}
                      placeholder="₹"
                      placeholderTextColor={colors.textFaint}
                      value={txnAmount}
                      onChangeText={setTxnAmount}
                      keyboardType="decimal-pad"
                    />
                    <TouchableOpacity
                      style={[styles.txnAddBtn, addingTxn && { opacity: 0.5 }]}
                      onPress={handleAddTxn}
                      disabled={addingTxn}
                    >
                      <Ionicons name="add" size={16} color={colors.white} />
                    </TouchableOpacity>
                  </View>

                  {txnLoading ? (
                    <Text style={styles.empty}>Loading…</Text>
                  ) : txns.length === 0 ? (
                    <Text style={styles.empty}>No transactions yet.</Text>
                  ) : (
                    txns.slice(0, 8).map(t => (
                      <TouchableOpacity
                        key={t.id}
                        onLongPress={() => handleDeleteTxn(t)}
                        delayLongPress={300}
                      >
                        <Row
                          dot={t.statement_id ? colors.textFaint : colors.accent}
                          label={
                            <View>
                              <Text style={{ fontSize: font.sm, color: colors.textSecondary }}>{t.description}</Text>
                              <Text style={{ fontSize: font.xs, color: colors.textFaint, marginTop: 1 }}>
                                {formatDate(t.txn_date)} · {t.statement_id ? 'billed' : 'unbilled'}
                              </Text>
                            </View>
                          }
                          value={inrCompact(t.amount)}
                        />
                      </TouchableOpacity>
                    ))
                  )}
                  {txns.length > 8 && (
                    <Text style={styles.empty}>+{txns.length - 8} older</Text>
                  )}
                </View>
              )}
            </Card>
          );
        })}
      </ScrollView>

      <FormModal visible={showForm} title={editingCard ? 'Edit card' : 'Add card'} onClose={() => setShowForm(false)}>
        <FormField label="Card name"><TextInput style={inputStyle} placeholder="HDFC Millennia" placeholderTextColor={colors.textFaint} value={form.name} onChangeText={v => setForm(f => ({ ...f, name: v }))} /></FormField>
        <FormField label="Bank"><TextInput style={inputStyle} placeholder="HDFC" placeholderTextColor={colors.textFaint} value={form.bank} onChangeText={v => setForm(f => ({ ...f, bank: v }))} /></FormField>
        <FormField label="Last 4 digits"><TextInput style={inputStyle} placeholder="1234" placeholderTextColor={colors.textFaint} value={form.last4} onChangeText={v => setForm(f => ({ ...f, last4: v }))} keyboardType="number-pad" maxLength={4} /></FormField>
        <FormField label="Outstanding (₹)"><TextInput style={inputStyle} placeholder="0" placeholderTextColor={colors.textFaint} value={form.outstanding} onChangeText={v => setForm(f => ({ ...f, outstanding: v }))} keyboardType="decimal-pad" /></FormField>
        <FormField label="Minimum due (₹)"><TextInput style={inputStyle} placeholder="0" placeholderTextColor={colors.textFaint} value={form.minimum_due} onChangeText={v => setForm(f => ({ ...f, minimum_due: v }))} keyboardType="decimal-pad" /></FormField>
        <FormField label="Due day (1–31)"><TextInput style={inputStyle} placeholder="15" placeholderTextColor={colors.textFaint} value={form.due_day} onChangeText={v => setForm(f => ({ ...f, due_day: v }))} keyboardType="number-pad" /></FormField>
        <PrimaryButton label={saving ? 'Saving…' : editingCard ? 'Update card' : 'Add card'} onPress={handleSave} disabled={saving} />
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
  addBtn: { backgroundColor: colors.accent, width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  heroRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  bankPill: { width: 6, height: 26, borderRadius: 3, marginRight: spacing.sm },
  cardName: { fontSize: font.base, fontWeight: fontWeight.semibold, color: colors.text },
  cardLast4: { fontSize: font.xs, color: colors.textFaint, marginTop: 1, fontFamily: 'monospace' },
  iconBtn: { padding: 6, borderRadius: radius.sm },
  metaLabel: { fontSize: font.xs, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, fontWeight: fontWeight.semibold },
  metaValue: { fontSize: font.sm, color: colors.text, fontFamily: 'monospace', marginTop: 2 },
  dueText: { fontSize: font.xs, fontFamily: 'monospace', marginTop: 2 },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceLight, overflow: 'hidden', marginTop: spacing.sm },
  barFill: { height: 6, backgroundColor: colors.bad, borderRadius: 3 },
  barCaption: { fontSize: font.xs, color: colors.textFaint, marginTop: 4 },
  expandRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  expandLabel: { fontSize: font.sm, color: colors.textMuted, fontWeight: fontWeight.medium },
  txnAddRow: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
  txnAddBtn: { backgroundColor: colors.accent, width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  empty: { fontSize: font.xs, color: colors.textFaint, textAlign: 'center', paddingVertical: spacing.xs },
});
