import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { registerUser } from '@/services/api';
import { colors, spacing, radius, font } from '@/constants/theme';

export default function RegisterScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Error', 'Email and password are required.');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    try {
      const result = await registerUser(email.trim().toLowerCase(), password, name.trim() || undefined);
      Alert.alert('Account created!', result.message || 'You can now sign in.', [
        { text: 'Sign in', onPress: () => router.replace('/(auth)/login') },
      ]);
    } catch (e: any) {
      Alert.alert('Registration failed', e.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.logoBox}>
            <Text style={styles.logoText}>ST</Text>
          </View>
          <Text style={styles.appName}>Create account</Text>
          <Text style={styles.tagline}>Start tracking your finances</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sign up</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Full Name</Text>
            <TextInput
              style={styles.input}
              placeholder="John Doe"
              placeholderTextColor={colors.textFaint}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={colors.textFaint}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="Minimum 8 characters"
              placeholderTextColor={colors.textFaint}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          </View>

          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={handleRegister}
            disabled={loading}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>{loading ? 'Creating account…' : 'Create account'}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={() => router.back()} style={styles.switchRow}>
          <Text style={styles.switchText}>Already have an account? </Text>
          <Text style={styles.switchLink}>Sign in</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.lg,
  },
  hero: { alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.md },
  logoBox: {
    width: 64, height: 64, borderRadius: radius.xl,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  logoText: { fontSize: font.xl, fontWeight: '800', color: colors.white, letterSpacing: -1 },
  appName: { fontSize: font.xxl, fontWeight: '800', color: colors.text, letterSpacing: -1 },
  tagline: { fontSize: font.base, color: colors.textMuted },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.xl,
    borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.md,
  },
  cardTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
  field: { gap: spacing.xs },
  label: {
    fontSize: font.xs, fontWeight: '700', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  input: {
    backgroundColor: colors.surfaceLight, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 13,
    fontSize: font.base, color: colors.text,
  },
  btn: {
    backgroundColor: colors.accent, borderRadius: radius.md,
    paddingVertical: 14, alignItems: 'center', marginTop: spacing.xs,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { fontSize: font.base, fontWeight: '700', color: colors.white },
  switchRow: { flexDirection: 'row', justifyContent: 'center', paddingTop: spacing.sm },
  switchText: { fontSize: font.sm, color: colors.textMuted },
  switchLink: { fontSize: font.sm, color: colors.accent, fontWeight: '600' },
});
