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
import { openExternalUrl } from "../components/safety-sheets";
import { legalUrl } from "../lib/safety";
import { InviteAcceptForm } from "../components/invite-sheet";
import { invitationTokenFromLink } from "../lib/invites";
import { GridBackground } from "../components/grid-background";
import { KeyboardDoneBar } from "../components/keyboard-form";
import { Wordmark } from "../components/wordmark";
import { useAppTheme } from "../lib/theme";
import { face } from "../lib/tokens";

export default function SignInScreen() {
  const {
    ready,
    configured,
    session,
    authError,
    clearAuthError,
    notice,
    sendCode,
    verifyCode,
    signInWithPassword,
  } = useAuth();
  const { colors } = useAppTheme();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteToken, setInviteToken] = useState("");
  const [joining, setJoining] = useState(false);
  const [passwordMode, setPasswordMode] = useState(false);
  const [password, setPassword] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

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

  async function onPassword() {
    clearAuthError();
    setBusy(true);
    setMessage(null);
    const result = await signInWithPassword(email, password);
    setBusy(false);
    if (!result.ok) setMessage(result.message);
  }

  async function openLegal(path: "privacy" | "terms" | "support") {
    setLinkError(null);
    const opened = await openExternalUrl(legalUrl(path));
    if (!opened) setLinkError("That page could not be opened.");
  }

  const label = face(colors, 650);
  const body = face(colors, 400);

  return (
    <View style={[styles.screen, { backgroundColor: colors.gridSurface }]}>
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <GridBackground color={colors.gridLine} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
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
            We’ll email a 6-digit code to the address that received your invitation.
          </Text>
          <View style={styles.form}>
            <Text style={[styles.hint, body, { color: colors.muted }]}>
              Enter the email address that received your invitation.
            </Text>
            {configured ? null : (
              <Text style={[styles.warning, body, { color: colors.ink }]}>
                Sign-in is unavailable right now.
              </Text>
            )}
            <Text style={[styles.fieldLabel, label, { color: colors.muted }]}>
              Email address
            </Text>
            <TextInput
              keyboardAppearance={colors.scheme}
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
            {sent && !passwordMode ? (
              <>
                <Text style={[styles.fieldLabel, label, { color: colors.muted }]}>
                  Six-digit code
                </Text>
                <TextInput
                  keyboardAppearance={colors.scheme}
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
            {passwordMode ? (
              <>
                <Text style={[styles.fieldLabel, label, { color: colors.muted }]}>Password</Text>
                <TextInput
                  keyboardAppearance={colors.scheme}
                  value={password}
                  onChangeText={setPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  textContentType="password"
                  accessibilityLabel="Password"
                  style={[
                    styles.input,
                    face(colors, 400),
                    {
                      color: colors.ink,
                      borderColor: colors.hairline,
                      borderRadius: colors.appearance === "retro" ? 2 : 7,
                      backgroundColor:
                        colors.appearance === "retro" || colors.scheme !== "light"
                          ? colors.surface
                          : colors.cream,
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
            ) : notice ? (
              <Text style={[styles.status, body, { color: colors.muted }]}>{notice}</Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={busy || !configured}
              onPress={() => void (passwordMode ? onPassword() : sent ? onVerify() : onSend())}
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
                  {passwordMode || sent ? "Sign in" : "Email me a code"}
                </Text>
              )}
            </Pressable>
            {sent && !passwordMode ? (
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
              accessibilityLabel={passwordMode ? "Email me a code" : "Sign in with a password"}
              onPress={() => {
                setPasswordMode((current) => !current);
                setMessage(null);
                clearAuthError();
              }}
              style={styles.again}
            >
              <Text style={[body, { color: colors.action, fontSize: 13 }]}>
                {passwordMode ? "Email me a code" : "Sign in with a password"}
              </Text>
            </Pressable>
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
        <View style={styles.legal}>
          <Pressable accessibilityRole="link" onPress={() => void openLegal("privacy")}>
            <Text style={[body, { color: colors.muted, fontSize: 13 }]}>Privacy</Text>
          </Pressable>
          <Text style={[body, { color: colors.muted, fontSize: 13 }]}>·</Text>
          <Pressable accessibilityRole="link" onPress={() => void openLegal("terms")}>
            <Text style={[body, { color: colors.muted, fontSize: 13 }]}>Terms</Text>
          </Pressable>
          <Text style={[body, { color: colors.muted, fontSize: 13 }]}>·</Text>
          <Pressable accessibilityRole="link" onPress={() => void openLegal("support")}>
            <Text style={[body, { color: colors.muted, fontSize: 13 }]}>Support</Text>
          </Pressable>
        </View>
        {linkError ? (
          <Text style={[styles.status, body, { color: colors.danger, textAlign: "center" }]}>{linkError}</Text>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
    <KeyboardDoneBar />
    </View>
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
  form: {
    marginTop: 8,
  },
  legal: {
    marginTop: 18,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
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
