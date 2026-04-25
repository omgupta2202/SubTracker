import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '@/hooks/useAuth';
import {
  updateUser, deleteUser, getGmailStatus, syncGmail,
  disconnectGmail, getGmailConnectUrl,
} from '@/services/api';
import { formatDateTime } from '@/lib/utils';
import { colors, spacing, font, fontWeight, radius } from '@/constants/theme';
import type { GmailStatus, SyncResult } from '@/types';
import { Card, CardHeader, CardTitle, Divider } from '@/components/ui/Card';
import { FormField, inputStyle } from '@/components/FormModal';

export default function ProfileScreen() {
  const router = useRouter();
  const { user, logout, updateUser: updateLocalUser } = useAuth();

  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [gmailLoading, setGmailLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [gmailError, setGmailError] = useState<string | null>(null);

  const refreshGmailStatus = async () => {
    try { setGmailStatus(await getGmailStatus()); } catch {}
  };

  useEffect(() => {
    refreshGmailStatus().finally(() => setGmailLoading(false));
  }, []);

  const handleConnectGmail = async () => {
    setConnecting(true); setGmailError(null);
    try {
      const { oauth_url } = await getGmailConnectUrl();
      const result = await WebBrowser.openAuthSessionAsync(oauth_url, 'subtracker://');
      if (result.type === 'success') { await refreshGmailStatus(); setSyncResult(null); }
    } catch (e: any) {
      setGmailError(e.message || 'Could not open Gmail connect flow.');
    } finally { setConnecting(false); }
  };

  const handleSaveProfile = async () => {
    if (password && password !== confirm) { Alert.alert('Error', 'Passwords do not match.'); return; }
    if (password && password.length < 8)  { Alert.alert('Error', 'Password must be at least 8 characters.'); return; }
    setProfileSaving(true);
    try {
      const updated = await updateUser({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        ...(password ? { password } : {}),
      });
      await updateLocalUser(updated);
      setPassword(''); setConfirm('');
      Alert.alert('Saved', 'Profile updated successfully.');
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setProfileSaving(false); }
  };

  const handleSync = async () => {
    setSyncing(true); setGmailError(null); setSyncResult(null);
    try { setSyncResult(await syncGmail()); await refreshGmailStatus(); }
    catch (e: any) { setGmailError(e.message || 'Sync failed'); }
    finally { setSyncing(false); }
  };

  const handleDisconnectGmail = () => {
    Alert.alert('Disconnect Gmail', 'Disconnect your Gmail account?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: async () => {
        try {
          await disconnectGmail();
          setGmailStatus(s => s ? { ...s, connected: false, connected_at: null } : null);
          setSyncResult(null);
        } catch (e: any) { Alert.alert('Error', e.message); }
      }},
    ]);
  };

  const handleLogout = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => { await logout(); router.replace('/(auth)/login'); } },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert('Delete account', 'This is permanent and cannot be undone. All your data will be lost.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await deleteUser(); await logout(); router.replace('/(auth)/login'); }
        catch (e: any) { Alert.alert('Error', e.message); }
      }},
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.pageHeader}>
        <Text style={styles.pageTitle}>Profile</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Identity */}
        <Card variant="hero">
          <View style={styles.avatarRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(user?.name || user?.email || 'U')[0].toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.displayName}>{user?.name || 'No name set'}</Text>
              <Text style={styles.displayEmail}>{user?.email}</Text>
            </View>
          </View>
        </Card>

        {/* Account info */}
        <Card style={{ marginTop: spacing.md }}>
          <CardHeader>
            <CardTitle icon={<Ionicons name="person-outline" size={13} color={colors.accent} />}>
              Account info
            </CardTitle>
          </CardHeader>

          <View style={{ gap: spacing.sm }}>
            <FormField label="Full name">
              <TextInput style={inputStyle} placeholder="John Doe" placeholderTextColor={colors.textFaint}
                         value={name} onChangeText={setName} autoCapitalize="words" />
            </FormField>
            <FormField label="Email">
              <TextInput style={inputStyle} placeholder="you@example.com" placeholderTextColor={colors.textFaint}
                         value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
            </FormField>
          </View>

          <Divider />
          <Text style={styles.sectionSub}>Security — leave blank to keep current password</Text>

          <View style={{ gap: spacing.sm }}>
            <FormField label="New password">
              <TextInput style={inputStyle} placeholder="••••••••" placeholderTextColor={colors.textFaint}
                         value={password} onChangeText={setPassword} secureTextEntry />
            </FormField>
            <FormField label="Confirm password">
              <TextInput style={inputStyle} placeholder="••••••••" placeholderTextColor={colors.textFaint}
                         value={confirm} onChangeText={setConfirm} secureTextEntry />
            </FormField>
          </View>

          <TouchableOpacity
            style={[styles.btn, profileSaving && styles.btnDisabled]}
            onPress={handleSaveProfile}
            disabled={profileSaving}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>{profileSaving ? 'Saving…' : 'Save profile'}</Text>
          </TouchableOpacity>
        </Card>

        {/* Gmail */}
        <Card style={{ marginTop: spacing.md }}>
          <CardHeader
            action={
              gmailStatus?.connected ? (
                <View style={styles.connectedPill}>
                  <Ionicons name="checkmark-circle" size={11} color={colors.good} />
                  <Text style={styles.connectedText}>Connected</Text>
                </View>
              ) : null
            }
          >
            <CardTitle icon={<Ionicons name="mail-outline" size={13} color={colors.accent} />}>
              Gmail sync
            </CardTitle>
          </CardHeader>

          {gmailLoading ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : !gmailStatus?.connected ? (
            <>
              <Text style={styles.gmailHint}>
                Connect Gmail to auto-import credit card transaction alerts and statements.
              </Text>
              {gmailError ? <Text style={styles.errorText}>{gmailError}</Text> : null}
              <TouchableOpacity
                style={[styles.btn, connecting && styles.btnDisabled, { marginTop: spacing.sm }]}
                onPress={handleConnectGmail}
                disabled={connecting}
                activeOpacity={0.85}
              >
                {connecting
                  ? <ActivityIndicator size="small" color={colors.white} />
                  : (
                    <>
                      <Ionicons name="mail-outline" size={15} color={colors.white} />
                      <Text style={styles.btnText}>  Connect Gmail</Text>
                    </>
                  )
                }
              </TouchableOpacity>
              <TouchableOpacity onPress={refreshGmailStatus} style={styles.refreshBtn}>
                <Ionicons name="refresh-outline" size={13} color={colors.textFaint} />
                <Text style={styles.refreshText}>Refresh status</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.gmailMeta}>
                {gmailStatus.connected_at && (
                  <Text style={styles.gmailMetaText}>Connected {formatDateTime(gmailStatus.connected_at)}</Text>
                )}
                {gmailStatus.last_synced_at
                  ? <Text style={styles.gmailMetaText}>Last synced {formatDateTime(gmailStatus.last_synced_at)}</Text>
                  : <Text style={styles.gmailMetaText}>Never synced</Text>}
              </View>

              {gmailError ? <Text style={styles.errorText}>{gmailError}</Text> : null}

              {syncResult && (
                <View style={styles.syncResultBox}>
                  <Text style={styles.syncResultText}>
                    {syncResult.txns_created} txn{syncResult.txns_created !== 1 ? 's' : ''} ·{' '}
                    {syncResult.stmts_created} statement{syncResult.stmts_created !== 1 ? 's' : ''} from{' '}
                    {syncResult.emails_found} emails
                    {syncResult.errors.length > 0 ? ` · ${syncResult.errors.length} skipped` : ''}
                  </Text>
                </View>
              )}

              <View style={styles.gmailActions}>
                <TouchableOpacity
                  style={[styles.btn, styles.btnFlex, syncing && styles.btnDisabled]}
                  onPress={handleSync}
                  disabled={syncing}
                  activeOpacity={0.85}
                >
                  {syncing
                    ? <ActivityIndicator size="small" color={colors.white} />
                    : (
                      <>
                        <Ionicons name="refresh-outline" size={15} color={colors.white} />
                        <Text style={styles.btnText}>  Sync now</Text>
                      </>
                    )
                  }
                </TouchableOpacity>
                <TouchableOpacity onPress={handleDisconnectGmail} style={styles.disconnectBtn}>
                  <Text style={styles.disconnectText}>Disconnect</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </Card>

        {/* Sign out */}
        <TouchableOpacity style={styles.outlineBtn} onPress={handleLogout} activeOpacity={0.85}>
          <Ionicons name="log-out-outline" size={16} color={colors.textMuted} />
          <Text style={styles.outlineBtnText}>  Sign out</Text>
        </TouchableOpacity>

        {/* Danger zone */}
        <Card style={[styles.dangerCard, { marginTop: spacing.md }]}>
          <CardHeader>
            <CardTitle icon={<Ionicons name="warning-outline" size={13} color={colors.bad} />}>
              <Text style={{ color: colors.bad }}>Danger zone</Text>
            </CardTitle>
          </CardHeader>
          <Text style={styles.dangerHint}>
            Deleting your account is permanent. All data will be inaccessible.
          </Text>
          <TouchableOpacity style={styles.deleteBtn} onPress={handleDeleteAccount} activeOpacity={0.85}>
            <Ionicons name="trash-outline" size={14} color={colors.bad} />
            <Text style={styles.deleteBtnText}>  Delete account</Text>
          </TouchableOpacity>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { padding: spacing.md, paddingBottom: 48 },
  pageHeader: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  pageTitle: { fontSize: font.xl, fontWeight: fontWeight.bold, color: colors.text, letterSpacing: -0.5 },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accentBg, borderWidth: 1, borderColor: colors.accentBorder, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: font.xl, fontWeight: fontWeight.bold, color: colors.accent },
  displayName: { fontSize: font.md, fontWeight: fontWeight.bold, color: colors.text },
  displayEmail: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },
  sectionSub: { fontSize: font.xs, color: colors.textFaint, marginBottom: spacing.xs },
  btn: { backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', marginTop: spacing.sm },
  btnFlex: { flex: 1 },
  btnDisabled: { opacity: 0.5 },
  btnText: { fontSize: font.base, fontWeight: fontWeight.semibold, color: colors.white },
  connectedPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.goodBg, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2, borderWidth: 1, borderColor: 'rgba(52,211,153,0.30)' },
  connectedText: { fontSize: font.xs, fontWeight: fontWeight.semibold, color: colors.good },
  gmailHint: { fontSize: font.sm, color: colors.textMuted, lineHeight: 20 },
  gmailMeta: { gap: 2 },
  gmailMetaText: { fontSize: font.xs, color: colors.textFaint },
  gmailActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  disconnectBtn: { paddingHorizontal: spacing.sm, paddingVertical: 12 },
  disconnectText: { fontSize: font.sm, color: colors.textFaint },
  syncResultBox: { backgroundColor: colors.surfaceLight, borderRadius: radius.sm, padding: spacing.sm, marginTop: spacing.sm },
  syncResultText: { fontSize: font.xs, color: colors.textMuted },
  errorText: { fontSize: font.xs, color: colors.bad, marginTop: spacing.xs },
  refreshBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: spacing.sm },
  refreshText: { fontSize: font.xs, color: colors.textFaint },
  outlineBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingVertical: 14, marginTop: spacing.md },
  outlineBtnText: { fontSize: font.base, fontWeight: fontWeight.semibold, color: colors.textMuted },
  dangerCard: { borderColor: 'rgba(248,113,113,0.25)' },
  dangerHint: { fontSize: font.xs, color: colors.textFaint, marginBottom: spacing.sm },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: colors.badBg, borderRadius: radius.md, borderWidth: 1, borderColor: 'rgba(248,113,113,0.25)', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  deleteBtnText: { fontSize: font.sm, fontWeight: fontWeight.semibold, color: colors.bad },
});
