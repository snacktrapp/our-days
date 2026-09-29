import { Redirect } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { sentMessage, useAuth } from "../components/auth-provider";
import { colors, record } from "../lib/theme";

export default function SignInScreen() {
  const {
    ready,
    configured,
    session,
    authError,
    clearAuthError,
    sendCode,
    verifyCode,
  } = useAuth();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Hold the redirect while verify runs so the journal does not mount (and
  // query) before the sign-in checks finish.
  if (ready && session && !busy) return <Redirect href="/journal" />;

  async function onSend() {
    clearAuthError();
    setBusy(true);
    const result = await sendCode(email);
    setBusy(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setSent(true);
    setMessage(sentMessage);
  }

  async function onVerify() {
    setBusy(true);
    setMessage(null);
    const result = await verifyCode(email, code);
    setBusy(false);
    // Failures are shown through authError, which survives remounts.
    if (result.ok) setMessage(null);
  }

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { paddingTop: insets.top + 32 }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Text style={styles.eyebrow}>Our Days</Text>
      <Text style={styles.title}>Sign in</Text>
      <Text style={styles.copy}>
        Use the same email code the journal sends on the web. There is no
        password.
      </Text>
      {configured ? null : (
        <Text style={styles.warning}>
          Set EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in mobile/.env before
          signing in. The project URL is already the Our Days Supabase project.
        </Text>
      )}
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        placeholder="Email"
        placeholderTextColor={colors.muted}
        accessibilityLabel="Email"
        style={styles.input}
        editable={!busy}
      />
      {sent ? (
        <TextInput
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          maxLength={6}
          placeholder="Six-digit code"
          placeholderTextColor={colors.muted}
          accessibilityLabel="Six-digit code"
          style={[styles.input, styles.code]}
          editable={!busy}
        />
      ) : null}
      {authError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {authError}
        </Text>
      ) : message ? (
        <Text style={styles.message}>{message}</Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={busy || !configured}
        onPress={() => void (sent ? onVerify() : onSend())}
        style={[styles.button, (busy || !configured) && styles.buttonDisabled]}
      >
        {busy ? (
          <ActivityIndicator color={colors.actionInk} />
        ) : (
          <Text style={styles.buttonLabel}>
            {sent ? "Sign in" : "Email me a code"}
          </Text>
        )}
      </Pressable>
      {sent ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void onSend()}
        >
          <Text style={styles.again}>Send another code</Text>
        </Pressable>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    gap: 14,
    paddingHorizontal: 24,
    backgroundColor: colors.paper,
  },
  eyebrow: {
    ...record,
    fontSize: 12,
    letterSpacing: 0.4,
  },
  title: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: "600",
  },
  copy: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  warning: {
    color: colors.ink,
    fontSize: 14,
    lineHeight: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.ink,
    backgroundColor: colors.cream,
    fontSize: 16,
  },
  code: {
    ...record,
    fontSize: 20,
    color: colors.ink,
  },
  message: {
    ...record,
    fontSize: 13,
    lineHeight: 18,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
  },
  button: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: colors.action,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonLabel: {
    color: colors.actionInk,
    fontSize: 16,
    fontWeight: "600",
  },
  again: {
    color: colors.action,
    fontSize: 14,
  },
});
