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
import { colors, spacing, font, radius } from '@/constants/theme';
import type { GmailStatus, SyncResult } from '@/types';
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
    try {
      const status = await getGmailStatus();
      setGmailStatus(status);
    } catch {}
  };

  useEffect(() => {
    refreshGmailStatus().finally(() => setGmailLoading(false));
  }, []);

  const handleConnectGmail = async () => {
    setConnecting(true);
    setGmailError(null);
    try {
      const { oauth_url } = await getGmailConnectUrl();
      // Opens an in-app browser; catches the custom-scheme redirect from the backend callback.
      // Requires backend to be accessible via HTTPS (ngrok or production).
      // The backend callback will redirect to subtracker://gmail-connected on success.
      const result = await WebBrowser.openAuthSessionAsync(oauth_url, 'subtracker://');
      if (result.type === 'success') {
        await refreshGmailStatus();
        setSyncResult(null);
      } else if (result.type === 'cancel') {
        // user dismissed
      }
    } catch (e: any) {
      setGmailError(e.message || 'Could not open Gmail connect flow.');
    } finally {
      setConnecting(false);
    }
  };

  const handleSaveProfile = async () => {
    if (password && password !== confirm) { Alert.alert('Error', 'Passwords do not match.'); return; }
    if (password && password.length < 8) { Alert.alert('Error', 'Password must be at least 8 characters.'); return; }
    setProfileSaving(true);
    try {
      const updated = await updateUser({ name: name.trim(), email: email.trim().toLowerCase(), ...(password ? { password } : {}) });
      await updateLocalUser(updated);
      setPassword(''); setConfirm('');
      Alert.alert('Saved', 'Profile updated successfully.');
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setProfileSaving(false); }
  };

  const handleSync = async () => {
    setSyncing(true); setGmailError(null); setSyncResult(null);
    try {
      const result = await syncGmail();
      setSyncResult(result);
      await refreshGmailStatus();
    } catch (e: any) { setGmailError(e.message || 'Sync failed'); }
    finally { setSyncing(false); }
  };

  const handleDisconnectGmail = () => {
    Alert.alert('Disconnect Gmail', 'Disconnect your Gmail account?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: async () => {
        try { await disconnectGmail(); setGmailStatus(s => s ? { ...s, connected: false, connected_at: null } : null); setSyncResult(null); }
        catch (e: any) { Alert.alert('Error', e.message); }
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
        {/* Avatar */}
        <View style={styles.avatarRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(user?.name || user?.email || 'U')[0].toUpperCase()}
            </Text>
          </View>
          <View>
            <Text style={styles.displayName}>{user?.name || 'No name set'}</Text>
            <Text style={styles.displayEmail}>{user?.email}</Text>
          </View>
        </View>

        {/* Profile form */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Account Info</Text>
          <FormField label="Full Name">
            <TextInput style={inputStyle} placeholder="John Doe" placeholderTextColor={colors.textFaint} value={name} onChangeText={setName} autoCapitalize="words" />
          </FormField>
          <FormField label="Email">
            <TextInput style={inputStyle} placeholder="you@example.com" placeholderTextColor={colors.textFaint} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          </FormField>
          <Text style={styles.sectionSub}>Security — leave blank to keep current password</Text>
          <FormField label="New Password">
            <TextInput style={inputStyle} placeholder="••••••••" placeholderTextColor={colors.textFaint} value={password} onChangeText={setPassword} secureTextEntry />
          </FormField>
          <FormField label="Confirm Password">
            <TextInput style={inputStyle} placeholder="••••••••" placeholderTextColor={colors.textFaint} value={confirm} onChangeText={setConfirm} secureTextEntry />
          </FormField>
          <TouchableOpacity style={[styles.btn, profileSaving && styles.btnDisabled]} onPress={handleSaveProfile} disabled={profileSaving} activeOpacity={0.85}>
            <Text style={styles.btnText}>{profileSaving ? 'Saving…' : 'Save Profile'}</Text>
          </TouchableOpacity>
        </View>

        {/* Gmail */}
        <View style={styles.card}>
          <View style={styles.cardTitleRow}>
            <Ionicons name="mail-outline" size={16} color={colors.textMuted} />
            <Text style={styles.cardTitle}>Gmail Sync</Text>
            {gmailStatus?.connected && (
              <View style={styles.connectedPill}>
                <Ionicons name="checkmark-circle" size={11} color={colors.green} />
                <Text style={styles.connectedText}>Connected</Text>
              </View>
            )}
          </View>

          {gmailLoading ? (
            <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: spacing.sm }} />
          ) : !gmailStatus?.connected ? (
            <>
              <Text style={styles.gmailHint}>
                Connect Gmail to auto-import credit card transaction alerts and statements from any bank.
              </Text>
              {gmailError && <Text style={styles.errorText}>{gmailError}</Text>}
              <TouchableOpacity
                style={[styles.btn, connecting && styles.btnDisabled]}
                onPress={handleConnectGmail}
                disabled={connecting}
                activeOpacity={0.85}
              >
                {connecting
                  ? <ActivityIndicator size="small" color={colors.white} />
                  : <><Ionicons name="mail-outline" size={15} color={colors.white} /><Text style={styles.btnText}> Connect Gmail</Text></>
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
                {gmailStatus.last_synced_at ? (
                  <Text style={styles.gmailMetaText}>Last synced {formatDateTime(gmailStatus.last_synced_at)}</Text>
                ) : (
                  <Text style={styles.gmailMetaText}>Never synced</Text>
                )}
              </View>

              {gmailError && <Text style={styles.errorText}>{gmailError}</Text>}

              {syncResult && (
                <View style={styles.syncResultBox}>
                  <Text style={styles.syncResultText}>
                    {syncResult.txns_created} transaction{syncResult.txns_created !== 1 ? 's' : ''} · {syncResult.stmts_created} statement{syncResult.stmts_created !== 1 ? 's' : ''} imported from {syncResult.emails_found} emails
                    {syncResult.errors.length > 0 ? ` · ${syncResult.errors.length} skipped` : ''}
                  </Text>
                </View>
              )}

              <View style={styles.gmailActions}>
                <TouchableOpacity style={[styles.btn, styles.btnFlex, syncing && styles.btnDisabled]} onPress={handleSync} disabled={syncing} activeOpacity={0.85}>
                  {syncing
                    ? <ActivityIndicator size="small" color={colors.white} />
                    : <><Ionicons name="refresh-outline" size={15} color={colors.white} /><Text style={styles.btnText}> Sync Now</Text></>
                  }
                </TouchableOpacity>
                <TouchableOpacity onPress={handleDisconnectGmail} style={styles.disconnectBtn}>
                  <Text style={styles.disconnectText}>Disconnect</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

        {/* Logout */}
        <TouchableOpacity style={styles.outlineBtn} onPress={handleLogout} activeOpacity={0.85}>
          <Ionicons name="log-out-outline" size={16} color={colors.textMuted} />
          <Text style={styles.outlineBtnText}>Sign out</Text>
        </TouchableOpacity>

        {/* Danger zone */}
        <View style={styles.dangerCard}>
          <Text style={styles.dangerTitle}>Danger Zone</Text>
          <Text style={styles.dangerHint}>Deleting your account is permanent. All data will be inaccessible.</Text>
          <TouchableOpacity style={styles.deleteBtn} onPress={handleDeleteAccount} activeOpacity={0.85}>
            <Ionicons name="trash-outline" size={14} color={colors.red} />
            <Text style={styles.deleteBtnText}>Delete Account</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { padding: spacing.md, paddingBottom: 48, gap: spacing.md },
  pageHeader: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  pageTitle: { fontSize: font.xl, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: font.xl, fontWeight: '700', color: colors.white },
  displayName: { fontSize: font.md, fontWeight: '700', color: colors.text },
  displayEmail: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.md },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  cardTitle: { fontSize: font.base, fontWeight: '700', color: colors.text },
  sectionSub: { fontSize: font.xs, color: colors.textFaint, marginTop: -spacing.xs },
  btn: { backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4 },
  btnFlex: { flex: 1 },
  btnDisabled: { opacity: 0.5 },
  btnText: { fontSize: font.base, fontWeight: '700', color: colors.white },
  connectedPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(74,222,128,0.1)', borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2, borderWidth: 1, borderColor: 'rgba(74,222,128,0.3)', marginLeft: 'auto' },
  connectedText: { fontSize: font.xs, fontWeight: '600', color: colors.green },
  gmailHint: { fontSize: font.sm, color: colors.textMuted, lineHeight: 20 },
  gmailMeta: { gap: 2 },
  gmailMetaText: { fontSize: font.xs, color: colors.textFaint },
  gmailActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  disconnectBtn: { paddingHorizontal: spacing.sm, paddingVertical: 13 },
  disconnectText: { fontSize: font.sm, color: colors.textFaint },
  syncResultBox: { backgroundColor: colors.surfaceLight, borderRadius: radius.sm, padding: spacing.sm },
  syncResultText: { fontSize: font.xs, color: colors.textMuted },
  errorText: { fontSize: font.xs, color: colors.red },
  refreshBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  refreshText: { fontSize: font.xs, color: colors.textFaint },
  outlineBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingVertical: 14 },
  outlineBtnText: { fontSize: font.base, fontWeight: '600', color: colors.textMuted },
  dangerCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)', padding: spacing.md, gap: spacing.sm },
  dangerTitle: { fontSize: font.sm, fontWeight: '700', color: colors.red, textTransform: 'uppercase', letterSpacing: 0.5 },
  dangerHint: { fontSize: font.xs, color: colors.textFaint },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: radius.md, borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  deleteBtnText: { fontSize: font.sm, fontWeight: '600', color: colors.red },
});
