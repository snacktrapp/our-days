import { Redirect } from "expo-router";
import * as Linking from "expo-linking";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { sentMessage, useAuth } from "../components/auth-provider";
import { InviteAcceptForm } from "../components/invite-sheet";
import { invitationTokenFromLink } from "../lib/invites";
import { GridBackground } from "../components/grid-background";
import { Wordmark } from "../components/wordmark";
import { useAppTheme } from "../lib/theme";
import { face, type ColorScheme } from "../lib/tokens";

/** globals.css color-mix(cream 88%, transparent) on the OAuth buttons. */
function oauthSurface(scheme: ColorScheme) {
  return {
    backgroundColor:
      scheme === "light" ? "rgba(255, 255, 255, 0.9)" : "rgba(27, 32, 40, 0.88)",
  };
}

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
  const { colors } = useAppTheme();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteToken, setInviteToken] = useState("");
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    const read = (url: string | null) => {
      const token = invitationTokenFromLink(url ?? "");
      if (!token) return;
      setInviteToken(token);
      setJoining(true);
    };
    void Linking.getInitialURL().then(read);
    const subscription = Linking.addEventListener("url", (event) => read(event.url));
    return () => subscription.remove();
  }, []);

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
    if (result.ok) setMessage(null);
  }

  const label = face(colors, 650);
  const body = face(colors, 400);

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.gridSurface }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <GridBackground color={colors.gridLine} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View
            style={[
              styles.card,
              {
                backgroundColor: colors.cream,
                borderColor: colors.hairline,
                borderRadius: colors.appearance === "retro" ? 2 : 10,
                shadowOpacity: colors.appearance === "retro" ? 0 : 0.32,
              },
            ]}
        >
          <View style={styles.wordmark}>
            <Wordmark color={colors.ink} width={168} />
          </View>
          <Text style={[styles.title, face(colors, 600), { color: colors.ink }]}>
            Open your journal.
          </Text>
          <Text
            style={[
              styles.copy,
              body,
              colors.appearance === "retro"
                ? { color: colors.ink, fontSize: 15, lineHeight: 23 }
                : { color: colors.muted },
            ]}
          >
            Use the Google or X account that received your invitation.
          </Text>
          <View style={styles.oauthList}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign in with Google"
            style={[
              styles.oauth,
              colors.appearance === "retro"
                ? { backgroundColor: colors.action, borderColor: colors.action, borderRadius: 2 }
                : oauthSurface(colors.scheme),
              colors.appearance === "retro" ? null : { borderColor: colors.hairline },
            ]}
          >
            {/* TODO(noop): Google sign-in. See src/lib/noop-controls.ts */}
            <Text
              style={[
                styles.oauthLabel,
                face(colors, colors.appearance === "retro" ? 700 : 650),
                {
                  color: colors.appearance === "retro" ? colors.actionInk : colors.ink,
                  textTransform: colors.appearance === "retro" ? "uppercase" : "none",
                  letterSpacing: colors.appearance === "retro" ? 1.1 : 0,
                },
              ]}
            >
              Sign in with Google
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign in with X"
            style={[
              styles.oauth,
              colors.appearance === "retro"
                ? { backgroundColor: colors.action, borderColor: colors.action, borderRadius: 2 }
                : oauthSurface(colors.scheme),
              colors.appearance === "retro" ? null : { borderColor: colors.hairline },
            ]}
          >
            {/* TODO(noop): X sign-in. See src/lib/noop-controls.ts */}
            <Text
              style={[
                styles.oauthLabel,
                face(colors, colors.appearance === "retro" ? 700 : 650),
                {
                  color: colors.appearance === "retro" ? colors.actionInk : colors.ink,
                  textTransform: colors.appearance === "retro" ? "uppercase" : "none",
                  letterSpacing: colors.appearance === "retro" ? 1.1 : 0,
                },
              ]}
            >
              Sign in with X
            </Text>
          </Pressable>
          </View>
          <View style={[styles.backup, { borderTopColor: colors.hairline }]}>
            <Text style={[styles.backupCopy, body, { color: colors.muted }]}>
              Or email a private sign-in link
            </Text>
            <Text style={[styles.hint, body, { color: colors.muted }]}>
              Enter the email address that received your invitation.
            </Text>
            {configured ? null : (
              <Text style={[styles.warning, body, { color: colors.ink }]}>
                Set EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in mobile/.env before
                signing in. The project URL is already the Our Days Supabase
                project.
              </Text>
            )}
            <Text style={[styles.fieldLabel, label, { color: colors.muted }]}>
              Email address
            </Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              placeholder=""
              placeholderTextColor={colors.muted}
              accessibilityLabel="Email address"
              style={[
                styles.input,
                face(colors, 400),
                {
                  color: colors.ink,
                  borderColor: colors.hairline,
                  borderRadius: colors.appearance === "retro" ? 2 : 7,
                  backgroundColor:
                    colors.appearance === "retro"
                      ? colors.surface
                      : colors.scheme === "light"
                        ? colors.cream
                        : colors.surface,
                },
              ]}
              editable={!busy}
            />
            {sent ? (
              <>
                <Text style={[styles.fieldLabel, label, { color: colors.muted }]}>
                  Six-digit code
                </Text>
                <TextInput
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  maxLength={6}
                  placeholder="000000"
                  placeholderTextColor={colors.muted}
                  accessibilityLabel="Six-digit code"
                  style={[
                    styles.input,
                    face(colors, 600, "record"),
                    {
                      color: colors.ink,
                      borderColor: colors.hairline,
                      borderRadius: colors.appearance === "retro" ? 2 : 7,
                      backgroundColor:
                        colors.appearance === "retro" || colors.scheme !== "light"
                          ? colors.surface
                          : colors.cream,
                      letterSpacing: 4,
                    },
                  ]}
                  editable={!busy}
                />
              </>
            ) : null}
            {authError ? (
              <Text accessibilityRole="alert" style={[styles.error, face(colors, 600), { color: colors.danger }]}>
                {authError}
              </Text>
            ) : message ? (
              <Text style={[styles.status, body, { color: colors.muted }]}>{message}</Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={busy || !configured}
              onPress={() => void (sent ? onVerify() : onSend())}
              style={[
                styles.submit,
                {
                  backgroundColor: colors.action,
                  borderColor: colors.action,
                  borderRadius: colors.appearance === "retro" ? 2 : 7,
                },
                (busy || !configured) && styles.disabled,
              ]}
            >
              {busy ? (
                <ActivityIndicator color={colors.actionInk} />
              ) : (
                <Text
                  style={[
                    styles.submitLabel,
                    face(colors, colors.appearance === "retro" ? 700 : 650),
                    {
                      color: colors.actionInk,
                      textTransform: colors.appearance === "retro" ? "uppercase" : "none",
                      letterSpacing: colors.appearance === "retro" ? 1.1 : 0,
                    },
                  ]}
                >
                  {sent ? "Sign in" : "Email me a sign-in link"}
                </Text>
              )}
            </Pressable>
            {sent ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void onSend()}
                style={styles.again}
              >
                <Text style={[body, { color: colors.action, fontSize: 13 }]}>
                  Send another code
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Join with an invitation"
              onPress={() => setJoining((current) => !current)}
              style={styles.again}
            >
              <Text style={[body, { color: colors.action, fontSize: 13 }]}>
                Join with an invitation
              </Text>
            </Pressable>
            {joining ? (
              <InviteAcceptForm
                initialToken={inviteToken}
                onAccepted={() => {
                  setJoining(false);
                }}
              />
            ) : null}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  card: {
    width: "100%",
    maxWidth: 390,
    alignSelf: "center",
    paddingTop: 28,
    paddingHorizontal: 22,
    paddingBottom: 24,
    borderWidth: 1,
    borderRadius: 10,
    shadowColor: "#000",
    shadowOpacity: 0.32,
    shadowRadius: 21,
    shadowOffset: { width: 0, height: 18 },
    elevation: 8,
  },
  wordmark: {
    alignItems: "center",
    marginBottom: 24,
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
    textAlign: "center",
  },
  copy: {
    marginTop: 20,
    marginBottom: 14,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  hint: {
    marginTop: 0,
    marginBottom: 12,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  oauthList: {
    gap: 11,
  },
  oauth: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  oauthLabel: {
    fontSize: 14,
  },
  backup: {
    marginTop: 20,
    paddingTop: 18,
    borderTopWidth: 1,
  },
  backupCopy: {
    marginTop: 0,
    marginBottom: 12,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  fieldLabel: {
    fontSize: 11,
    marginBottom: 9,
  },
  input: {
    minHeight: 50,
    marginBottom: 9,
    paddingVertical: 12,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderRadius: 7,
    fontSize: 16,
  },
  warning: {
    marginBottom: 12,
    fontSize: 13,
    lineHeight: 18,
  },
  status: {
    marginBottom: 8,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  error: {
    marginBottom: 8,
    fontSize: 14,
    lineHeight: 20,
  },
  submit: {
    minHeight: 48,
    marginTop: 3,
    borderWidth: 1,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  submitLabel: {
    fontSize: 14,
  },
  disabled: {
    opacity: 0.5,
  },
  again: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});
