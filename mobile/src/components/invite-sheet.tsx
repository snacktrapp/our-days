import { useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  acceptCircleInvitation,
  requestCircleInvitation,
} from "../lib/invites";
import { postableCircles, type CircleMembership } from "../lib/journal";
import { getSupabase } from "../lib/supabase";
import { useAppTheme } from "../lib/theme";
import { face } from "../lib/tokens";

export function InviteSendSheet({
  circles,
  onClose,
}: Readonly<{
  circles: readonly CircleMembership[];
  onClose: () => void;
}>) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const organizers = postableCircles(circles).filter((circle) => circle.role === "organizer");
  const [circleId, setCircleId] = useState(organizers[0]?.circleId ?? "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    const supabase = getSupabase();
    if (!supabase || busy) return;
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
      <Pressable style={styles.scrim} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.cream, paddingBottom: Math.max(16, insets.bottom) }]}>
        <Text style={[face(colors, 650), styles.title, { color: colors.ink }]}>Invite someone</Text>
        <Text style={[face(colors, 400), { color: colors.muted, fontSize: 14 }]}>
          They’ll get a private invitation for this circle.
        </Text>
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send invitation"
          disabled={busy}
          onPress={() => void send()}
          style={[styles.post, { backgroundColor: colors.action }]}
        >
          <Text style={[face(colors, 650), { color: colors.actionInk, fontSize: 16 }]}>
            {busy ? "Sending…" : "Send invitation"}
          </Text>
        </Pressable>
      </View>
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
  title: { fontSize: 18 },
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
