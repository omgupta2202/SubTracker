import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { useAuth } from '@/hooks/useAuth';
import { loginUser, loginWithGoogle } from '@/services/api';
import { colors, spacing, radius, font } from '@/constants/theme';
import { GOOGLE_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID } from '@/constants/api';

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Google Sign-In requires an Android OAuth client (created in Google Cloud Console → Android).
  // Set GOOGLE_ANDROID_CLIENT_ID in constants/api.ts once you have one.
  // Until then, the button is hidden.
  const [, googleResponse, promptGoogleSignIn] = Google.useAuthRequest({
    androidClientId: GOOGLE_ANDROID_CLIENT_ID || undefined,
    clientId: GOOGLE_CLIENT_ID,
    scopes: ['openid', 'profile', 'email'],
  });

  const googleEnabled = Boolean(GOOGLE_ANDROID_CLIENT_ID);

  React.useEffect(() => {
    if (googleResponse?.type === 'success') {
      const idToken = googleResponse.authentication?.idToken;
      if (idToken) {
        handleGoogleLogin(idToken);
      } else {
        Alert.alert('Google Sign-In failed', 'No ID token received. Please try again.');
      }
    } else if (googleResponse?.type === 'error') {
      Alert.alert('Google Sign-In failed', googleResponse.error?.message ?? 'Unknown error.');
    }
  }, [googleResponse]);

  const handleGoogleLogin = async (idToken: string) => {
    setGoogleLoading(true);
    try {
      const { access_token, user } = await loginWithGoogle(idToken);
      await login(access_token, user);
      router.replace('/(tabs)');
    } catch (e: any) {
      Alert.alert('Sign-in failed', e.message || 'Could not sign in with Google.');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Error', 'Please enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      const { access_token, user } = await loginUser(email.trim().toLowerCase(), password);
      await login(access_token, user);
      router.replace('/(tabs)');
    } catch (e: any) {
      Alert.alert('Login failed', e.message || 'Invalid credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {/* Logo / heading */}
        <View style={styles.hero}>
          <View style={styles.logoBox}>
            <Text style={styles.logoText}>ST</Text>
          </View>
          <Text style={styles.appName}>SubTracker</Text>
          <Text style={styles.tagline}>Your finances, organised.</Text>
        </View>

        {/* Form */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sign in</Text>

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
              placeholder="••••••••"
              placeholderTextColor={colors.textFaint}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
            />
          </View>

          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>{loading ? 'Signing in…' : 'Sign in'}</Text>
          </TouchableOpacity>

          {/* Divider + Google Sign-In — visible only when Android client ID is configured */}
          {googleEnabled && (
            <>
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>
              <TouchableOpacity
                style={[styles.googleBtn, (googleLoading || loading) && styles.btnDisabled]}
                onPress={() => promptGoogleSignIn()}
                disabled={googleLoading || loading}
                activeOpacity={0.85}
              >
                {googleLoading ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : (
                  <>
                    <Text style={styles.googleG}>G</Text>
                    <Text style={styles.googleBtnText}>Continue with Google</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>

        <TouchableOpacity onPress={() => router.push('/(auth)/register')} style={styles.switchRow}>
          <Text style={styles.switchText}>Don't have an account? </Text>
          <Text style={styles.switchLink}>Create one</Text>
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
  hero: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  logoBox: {
    width: 64,
    height: 64,
    borderRadius: radius.xl,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  logoText: {
    fontSize: font.xl,
    fontWeight: '800',
    color: colors.white,
    letterSpacing: -1,
  },
  appName: {
    fontSize: font.xxl,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -1,
  },
  tagline: {
    fontSize: font.base,
    color: colors.textMuted,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardTitle: {
    fontSize: font.lg,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  field: { gap: spacing.xs },
  label: {
    fontSize: font.xs,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
    fontSize: font.base,
    color: colors.text,
  },
  btn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { fontSize: font.base, fontWeight: '700', color: colors.white },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginVertical: spacing.xs,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { fontSize: font.xs, color: colors.textFaint },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceLight,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 13,
  },
  googleG: {
    fontSize: font.base,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.5,
  },
  googleBtnText: { fontSize: font.base, fontWeight: '600', color: colors.text },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingTop: spacing.sm,
  },
  switchText: { fontSize: font.sm, color: colors.textMuted },
  switchLink: { fontSize: font.sm, color: colors.accent, fontWeight: '600' },
});
