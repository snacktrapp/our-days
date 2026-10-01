import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  acceptCircleInvitation,
  defaultInviteCircleId,
  requestCircleInvitation,
  validInvitationEmail,
} from "../lib/invites";
import { postableCircles, type CircleMembership } from "../lib/journal";
import { getSupabase } from "../lib/supabase";
import { useAppTheme } from "../lib/theme";
import { face } from "../lib/tokens";
import { KeyboardDoneBar } from "./keyboard-form";

export function InviteSendSheet({
  circles,
  viewedCircleId = null,
  onClose,
}: Readonly<{
  circles: readonly CircleMembership[];
  /** The circle feed open behind settings, if any. */
  viewedCircleId?: string | null;
  onClose: () => void;
}>) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const organizers = postableCircles(circles).filter((circle) => circle.role === "organizer");
  const [circleId, setCircleId] = useState(() =>
    defaultInviteCircleId(
      organizers.map((circle) => circle.circleId),
      viewedCircleId,
    ),
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = Boolean(circleId) && name.trim().length > 0 && validInvitationEmail(email);

  async function send() {
    const supabase = getSupabase();
    if (!supabase || busy || !ready) return;
    if (!circleId) {
      setMessage("Choose which circle to invite them to.");
      return;
    }
    setBusy(true);
    const result = await requestCircleInvitation(supabase, {
      circleId,
      displayName: name,
      email,
    });
    setBusy(false);
    setMessage(result.message);
    if (result.ok) {
      setName("");
      setEmail("");
    }
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Pressable style={styles.scrim} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.cream, paddingBottom: Math.max(16, insets.bottom) }]}>
        <View style={styles.bar}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onClose} style={styles.barSide}>
            <Text style={[face(colors, 400), { color: colors.ink, fontSize: 17 }]}>Cancel</Text>
          </Pressable>
          <Text style={[face(colors, 650), styles.title, { color: colors.ink }]}>Invite someone</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send invitation"
            accessibilityState={{ disabled: busy || !ready }}
            disabled={busy || !ready}
            onPress={() => void send()}
            style={[styles.barSide, styles.barEnd]}
          >
            <Text style={[face(colors, 700), { color: colors.action, fontSize: 17, opacity: ready ? 1 : 0.4 }]}>
              {busy ? "Sending…" : "Send"}
            </Text>
          </Pressable>
        </View>
        <Text style={[face(colors, 400), { color: colors.muted, fontSize: 14 }]}>
          {circleId
            ? "They’ll get a private invitation for this circle."
            : "Choose which circle to invite them to."}
        </Text>
        <Text style={[face(colors, 600, "record"), styles.circleLabel, { color: colors.muted }]}>Circle</Text>
        <View style={styles.chips}>
          {organizers.map((circle) => {
            const selected = circle.circleId === circleId;
            return (
              <Pressable
                key={circle.circleId}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setCircleId(circle.circleId)}
                style={[styles.chip, { borderColor: selected ? colors.action : colors.hairline }]}
              >
                <Text style={[face(colors, 600), { color: colors.ink, fontSize: 14 }]}>{circle.name}</Text>
              </Pressable>
            );
          })}
        </View>
        <TextInput
          value={name}
          onChangeText={setName}
          accessibilityLabel="Their name"
          placeholder="Their name"
          placeholderTextColor={colors.muted}
          style={[styles.input, face(colors, 400), { color: colors.ink, borderColor: colors.hairline }]}
        />
        <TextInput
          value={email}
          onChangeText={setEmail}
          accessibilityLabel="Email address"
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="Email address"
          placeholderTextColor={colors.muted}
          style={[styles.input, face(colors, 400), { color: colors.ink, borderColor: colors.hairline }]}
        />
        {message ? <Text style={[face(colors, 400), { color: colors.ink }]}>{message}</Text> : null}
      </View>
      </KeyboardAvoidingView>
      <KeyboardDoneBar />
    </Modal>
  );
}

export function InviteAcceptForm({
  initialToken = "",
  onAccepted,
}: Readonly<{ initialToken?: string; onAccepted: () => void }>) {
  const { colors } = useAppTheme();
  const [link, setLink] = useState(initialToken);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function join() {
    const supabase = getSupabase();
    if (!supabase || busy) return;
    setBusy(true);
    const result = await acceptCircleInvitation(supabase, { email, code, token: link });
    setBusy(false);
    setMessage(result.message);
    if (result.ok) onAccepted();
  }

  return (
    <View style={styles.accept}>
      <Text style={[face(colors, 650), { color: colors.ink, fontSize: 16 }]}>Join your circle.</Text>
      <TextInput
        value={link}
        onChangeText={setLink}
        accessibilityLabel="Invitation link"
        autoCapitalize="none"
        placeholder="Invitation link"
        placeholderTextColor={colors.muted}
        style={[styles.input, face(colors, 400), { color: colors.ink, borderColor: colors.hairline }]}
      />
      <TextInput
        value={email}
        onChangeText={setEmail}
        accessibilityLabel="Invitation email"
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="Email address"
        placeholderTextColor={colors.muted}
        style={[styles.input, face(colors, 400), { color: colors.ink, borderColor: colors.hairline }]}
      />
      <TextInput
        value={code}
        onChangeText={setCode}
        accessibilityLabel="Invitation code"
        keyboardType="number-pad"
        maxLength={6}
        placeholder="000000"
        placeholderTextColor={colors.muted}
        style={[styles.input, face(colors, 600), { color: colors.ink, borderColor: colors.hairline }]}
      />
      {message ? <Text style={[face(colors, 400), { color: colors.ink }]}>{message}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Join your circle"
        disabled={busy}
        onPress={() => void join()}
        style={[styles.post, { backgroundColor: colors.action }]}
      >
        <Text style={[face(colors, 650), { color: colors.actionInk, fontSize: 16 }]}>
          {busy ? "Joining…" : "Join your circle"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    gap: 10,
  },
  bar: { minHeight: 44, flexDirection: "row", alignItems: "center" },
  barSide: { minWidth: 64, minHeight: 44, justifyContent: "center" },
  barEnd: { alignItems: "flex-end" },
  title: { flex: 1, textAlign: "center", fontSize: 17 },
  circleLabel: { fontSize: 9, letterSpacing: 0.8, textTransform: "uppercase" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  post: {
    minHeight: 48,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  accept: { gap: 10, marginTop: 8 },
});
