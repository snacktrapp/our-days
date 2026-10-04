import { useEffect, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "./auth-provider";
import { getSupabase } from "../lib/supabase";
import {
  acceptTerms,
  blockMember,
  deletionConfirmCopy,
  freshRequestKey,
  getMyAccountClosureStatus,
  getMyTermsAcceptance,
  legalUrl,
  listMyBlocks,
  plainSafetyMessage,
  reportContent,
  reportReasons,
  reportThanks,
  requestAccountClosure,
  unblockMember,
  zeroToleranceCopy,
  type BlockedPerson,
  type ClosureView,
  type ReportReason,
  type ReportTargetKind,
} from "../lib/safety";
import { useAppTheme } from "../lib/theme";
import { face } from "../lib/tokens";
import { GridBackground } from "./grid-background";
import { Wordmark } from "./wordmark";

export async function openExternalUrl(url: string) {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

export function ReportSheet({
  visible,
  targetKind,
  targetId,
  onClose,
  onReported,
}: Readonly<{
  visible: boolean;
  targetKind: ReportTargetKind;
  targetId: string;
  onClose: () => void;
  onReported: () => void;
}>) {
  const { colors } = useAppTheme();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thanks, setThanks] = useState(false);
  const radius = colors.appearance === "retro" ? 2 : 16;

  if (!visible) return null;

  async function submit() {
    if (!reason || busy) return;
    const supabase = getSupabase();
    if (!supabase) {
      setError(plainSafetyMessage("report"));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await reportContent(supabase, {
      targetKind,
      targetId,
      reason,
      details,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setThanks(true);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.backdrop}
      >
        <Pressable accessibilityLabel="Close report" onPress={onClose} style={styles.scrim} />
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.cream,
              borderColor: colors.hairline,
              borderRadius: radius,
            },
          ]}
        >
          {thanks ? (
            <>
              <Text style={[face(colors, 600), styles.title, { color: colors.ink }]}>Report</Text>
              <Text style={[face(colors, 400), styles.body, { color: colors.ink }]}>{reportThanks}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  onReported();
                  onClose();
                }}
                style={[styles.primary, { backgroundColor: colors.action, borderRadius: radius === 2 ? 2 : 8 }]}
              >
                <Text style={[face(colors, 650), { color: colors.actionInk, fontSize: 15 }]}>OK</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={[face(colors, 600), styles.title, { color: colors.ink }]}>Report</Text>
              <Text style={[face(colors, 400), styles.body, { color: colors.muted }]}>
                Why are you reporting this?
              </Text>
              <ScrollView style={styles.reasons} keyboardShouldPersistTaps="handled">
                {reportReasons.map((option) => {
                  const selected = reason === option.id;
                  return (
                    <Pressable
                      key={option.id}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      onPress={() => setReason(option.id)}
                      style={styles.reason}
                    >
                      <View
                        style={[
                          styles.radio,
                          {
                            borderColor: selected ? colors.action : colors.line,
                            backgroundColor: selected ? colors.action : "transparent",
                          },
                        ]}
                      />
                      <Text style={[face(colors, 500), { color: colors.ink, fontSize: 15 }]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <TextInput
                value={details}
                onChangeText={setDetails}
                placeholder="Add details (optional)"
                placeholderTextColor={colors.muted}
                accessibilityLabel="Report details"
                multiline
                maxLength={2000}
                keyboardAppearance={colors.scheme}
                style={[
                  styles.input,
                  face(colors, 400),
                  {
                    color: colors.ink,
                    borderColor: colors.hairline,
                    backgroundColor: colors.surface,
                    borderRadius: radius === 2 ? 2 : 8,
                  },
                ]}
              />
              {error ? (
                <Text accessibilityRole="alert" style={[face(colors, 500), styles.error, { color: colors.danger }]}>
                  {error}
                </Text>
              ) : null}
              <View style={styles.actions}>
                <Pressable accessibilityRole="button" onPress={onClose} style={styles.secondary}>
                  <Text style={[face(colors, 600), { color: colors.ink, fontSize: 15 }]}>Cancel</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={!reason || busy}
                  onPress={() => void submit()}
                  style={[
                    styles.primary,
                    { backgroundColor: colors.action, borderRadius: radius === 2 ? 2 : 8 },
                    (!reason || busy) && styles.disabled,
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.actionInk} />
                  ) : (
                    <Text style={[face(colors, 650), { color: colors.actionInk, fontSize: 15 }]}>
                      Send report
                    </Text>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function BlockSheet({
  visible,
  name,
  membershipId,
  onClose,
  onBlocked,
}: Readonly<{
  visible: boolean;
  name: string;
  membershipId: string;
  onClose: () => void;
  onBlocked: () => void;
}>) {
  const { colors } = useAppTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const radius = colors.appearance === "retro" ? 2 : 16;
  const who = name.trim() || "this person";

  if (!visible) return null;

  async function confirm() {
    if (busy) return;
    const supabase = getSupabase();
    if (!supabase || !membershipId) {
      setError(plainSafetyMessage("block"));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await blockMember(supabase, membershipId);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onBlocked();
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel="Close block" onPress={onClose} style={styles.scrim} />
        <View
          style={[
            styles.card,
            { backgroundColor: colors.cream, borderColor: colors.hairline, borderRadius: radius },
          ]}
        >
          <Text style={[face(colors, 600), styles.title, { color: colors.ink }]}>Block {who}?</Text>
          <Text style={[face(colors, 400), styles.body, { color: colors.ink }]}>
            You won’t see their posts or comments. They won’t be told.
          </Text>
          {error ? (
            <Text accessibilityRole="alert" style={[face(colors, 500), styles.error, { color: colors.danger }]}>
              {error}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.secondary}>
              <Text style={[face(colors, 600), { color: colors.ink, fontSize: 15 }]}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void confirm()}
              style={[
                styles.primary,
                { backgroundColor: colors.danger, borderRadius: radius === 2 ? 2 : 8 },
                busy && styles.disabled,
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={[face(colors, 650), { color: "#ffffff", fontSize: 15 }]}>Block</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function DeleteAccountSheet({
  visible,
  onClose,
  onRequested,
}: Readonly<{
  visible: boolean;
  onClose: () => void;
  onRequested: () => void;
}>) {
  const { colors } = useAppTheme();
  const [view, setView] = useState<ClosureView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const radius = colors.appearance === "retro" ? 2 : 16;

  useEffect(() => {
    let active = true;
    const supabase = getSupabase();
    void (async () => {
      const next = supabase
        ? (await getMyAccountClosureStatus(supabase)).view
        : ({ kind: "confirm", notice: plainSafetyMessage("closureStatus") } satisfies ClosureView);
      if (active) setView(next);
    })();
    return () => {
      active = false;
    };
  }, []);

  async function confirm() {
    if (busy) return;
    const supabase = getSupabase();
    if (!supabase) {
      setError(plainSafetyMessage("closure"));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await requestAccountClosure(supabase, freshRequestKey());
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onRequested();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel="Close delete account" onPress={onClose} style={styles.scrim} />
        <View
          style={[
            styles.card,
            { backgroundColor: colors.cream, borderColor: colors.hairline, borderRadius: radius },
          ]}
        >
          <Text style={[face(colors, 600), styles.title, { color: colors.ink }]}>Delete account</Text>
          {!view ? (
            <ActivityIndicator color={colors.ink} style={styles.spinner} />
          ) : (
            <DeleteAccountBody
              view={view}
              busy={busy}
              error={error}
              onClose={onClose}
              onConfirm={() => void confirm()}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

export function DeleteAccountBody({
  view,
  busy,
  error,
  onClose,
  onConfirm,
}: Readonly<{
  view: ClosureView;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}>) {
  const { colors } = useAppTheme();
  const radius = colors.appearance === "retro" ? 2 : 8;
  return (
    <>
      {view.kind === "requested" ? (
        <Text style={[face(colors, 400), styles.body, { color: colors.ink }]}>{view.label}</Text>
      ) : null}
      {view.kind === "last-organizer" ? (
        <>
          <Text style={[face(colors, 400), styles.body, { color: colors.ink }]}>{view.message}</Text>
          {view.circles.map((name) => (
            <Text key={name} style={[face(colors, 600), styles.circle, { color: colors.ink }]}>
              {name}
            </Text>
          ))}
        </>
      ) : null}
      {view.kind === "confirm" ? (
        <>
          <Text style={[face(colors, 400), styles.body, { color: colors.ink }]}>
            {deletionConfirmCopy}
          </Text>
          {view.notice ? (
            <Text style={[face(colors, 400), styles.body, { color: colors.muted }]}>{view.notice}</Text>
          ) : null}
        </>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={[face(colors, 500), styles.error, { color: colors.danger }]}>
          {error}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.secondary}>
          <Text style={[face(colors, 600), { color: colors.ink, fontSize: 15 }]}>
            {view.kind === "confirm" ? "Cancel" : "Close"}
          </Text>
        </Pressable>
        {view.kind === "confirm" ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={onConfirm}
            style={[
              styles.primary,
              { backgroundColor: colors.danger, borderRadius: radius },
              busy && styles.disabled,
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={[face(colors, 650), { color: "#ffffff", fontSize: 15 }]}>Delete account</Text>
            )}
          </Pressable>
        ) : null}
      </View>
    </>
  );
}

export function BlockedPeopleScreen({
  onClose,
  onUnblocked,
}: Readonly<{
  onClose: () => void;
  onUnblocked: (membershipId: string) => void;
}>) {
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const radius = colors.appearance === "retro" ? 2 : 18;
  const [people, setPeople] = useState<readonly BlockedPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function load() {
    setError(null);
    const supabase = getSupabase();
    if (!supabase) {
      setPeople([]);
      setError(plainSafetyMessage("blocks"));
      return;
    }
    const result = await listMyBlocks(supabase);
    if (!result.ok) {
      setPeople([]);
      setError(result.message);
      return;
    }
    setPeople(result.data);
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      const supabase = getSupabase();
      const result = supabase ? await listMyBlocks(supabase) : null;
      if (!active) return;
      if (!result || !result.ok) {
        setPeople([]);
        setError(!result || result.ok ? plainSafetyMessage("blocks") : result.message);
        return;
      }
      setPeople(result.data);
    })();
    return () => {
      active = false;
    };
  }, []);

  async function unblock(person: BlockedPerson) {
    if (pendingId) return;
    const supabase = getSupabase();
    if (!supabase) {
      setError(plainSafetyMessage("unblock"));
      return;
    }
    setPendingId(person.membershipId);
    setError(null);
    const result = await unblockMember(supabase, person.membershipId);
    setPendingId(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setPeople((current) => (current ?? []).filter((item) => item.membershipId !== person.membershipId));
    onUnblocked(person.membershipId);
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.gridSurface, paddingTop: insets.top + 12 }]}>
      <Pressable accessibilityRole="button" onPress={onClose} style={styles.back}>
        <Text style={[face(colors, 600), { color: colors.action, fontSize: 15 }]}>Settings</Text>
      </Pressable>
      <Text style={[face(colors, 650), styles.screenTitle, { color: colors.ink }]}>Blocked people</Text>
      <ScrollView contentContainerStyle={styles.blockedScroll}>
        {error ? (
          <Text accessibilityRole="alert" style={[face(colors, 400), styles.blockedNote, { color: colors.danger }]}>
            {error}
          </Text>
        ) : null}
        {people === null ? (
          <ActivityIndicator color={colors.ink} style={styles.spinner} />
        ) : people.length === 0 && !error ? (
          <Text style={[face(colors, 400), styles.blockedNote, { color: colors.muted }]}>
            You haven’t blocked anyone.
          </Text>
        ) : (
          <View style={[styles.group, { backgroundColor: colors.cream, borderRadius: radius }]}>
            {people.map((person) => (
              <View key={person.membershipId} style={styles.personRow}>
                <Text style={[face(colors, 600), { color: colors.ink, fontSize: 15, flex: 1 }]} numberOfLines={1}>
                  {person.name}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Unblock ${person.name}`}
                  disabled={pendingId === person.membershipId}
                  onPress={() => void unblock(person)}
                  style={styles.unblock}
                >
                  <Text style={[face(colors, 600), { color: colors.action, fontSize: 14 }]}>
                    {pendingId === person.membershipId ? "Unblocking…" : "Unblock"}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
        {error ? (
          <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondary}>
            <Text style={[face(colors, 600), { color: colors.ink, fontSize: 15 }]}>Try again</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

export function TermsGate({ children }: Readonly<{ children: ReactNode }>) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [gateUser, setGateUser] = useState<string | null>(null);
  const [gate, setGate] = useState<"checking" | "allow" | "prompt">("checking");

  useEffect(() => {
    if (!userId) return;
    let active = true;
    const supabase = getSupabase();
    void (async () => {
      const next = supabase ? (await getMyTermsAcceptance(supabase)).gate : "allow";
      if (!active) return;
      setGate(next);
      setGateUser(userId);
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  if (!session) return children;
  if (gateUser !== userId || gate === "checking") return <TermsChecking />;
  if (gate === "prompt") {
    return (
      <TermsScreen
        onAccepted={() => {
          setGate("allow");
          setGateUser(userId);
        }}
      />
    );
  }
  return children;
}

function TermsChecking() {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.termsScreen, { backgroundColor: colors.gridSurface }]}>
      <GridBackground color={colors.gridLine} />
      <ActivityIndicator color={colors.ink} />
    </View>
  );
}

export function TermsScreen({ onAccepted }: Readonly<{ onAccepted: () => void }>) {
  const { colors } = useAppTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const radius = colors.appearance === "retro" ? 2 : 10;

  async function open(path: "privacy" | "terms") {
    setLinkError(null);
    const opened = await openExternalUrl(legalUrl(path));
    if (!opened) setLinkError("That page could not be opened.");
  }

  async function agree() {
    if (busy) return;
    const supabase = getSupabase();
    if (!supabase) {
      onAccepted();
      return;
    }
    setBusy(true);
    setError(null);
    const result = await acceptTerms(supabase);
    setBusy(false);
    if (!result.ok) {
      if (result.missing) {
        onAccepted();
        return;
      }
      setError(result.message);
      return;
    }
    onAccepted();
  }

  return (
    <View style={[styles.termsScreen, { backgroundColor: colors.gridSurface }]}>
      <GridBackground color={colors.gridLine} />
      <View
        style={[
          styles.termsCard,
          {
            backgroundColor: colors.cream,
            borderColor: colors.hairline,
            borderRadius: radius,
          },
        ]}
      >
        <View style={styles.wordmark}>
          <Wordmark color={colors.ink} width={168} />
        </View>
        <Text style={[face(colors, 600), styles.title, { color: colors.ink, textAlign: "center" }]}>
          Before you continue
        </Text>
        <Text style={[face(colors, 400), styles.body, { color: colors.ink, textAlign: "center" }]}>
          {zeroToleranceCopy}
        </Text>
        <View style={styles.legalRow}>
          <Pressable accessibilityRole="link" onPress={() => void open("terms")}>
            <Text style={[face(colors, 600), { color: colors.action, fontSize: 15 }]}>Terms of Use</Text>
          </Pressable>
          <Text style={[face(colors, 400), { color: colors.muted }]}>·</Text>
          <Pressable accessibilityRole="link" onPress={() => void open("privacy")}>
            <Text style={[face(colors, 600), { color: colors.action, fontSize: 15 }]}>Privacy Policy</Text>
          </Pressable>
        </View>
        {linkError ? (
          <Text style={[face(colors, 400), styles.error, { color: colors.danger, textAlign: "center" }]}>
            {linkError}
          </Text>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={[face(colors, 500), styles.error, { color: colors.danger, textAlign: "center" }]}>
            {error}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void agree()}
          style={[
            styles.primary,
            styles.agree,
            { backgroundColor: colors.action, borderRadius: radius === 2 ? 2 : 8 },
            busy && styles.disabled,
          ]}
        >
          {busy ? (
            <ActivityIndicator color={colors.actionInk} />
          ) : (
            <Text style={[face(colors, 650), { color: colors.actionInk, fontSize: 15 }]}>I agree</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  scrim: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(8, 10, 14, 0.55)",
  },
  card: {
    maxHeight: "86%",
    borderWidth: 1,
    paddingTop: 22,
    paddingHorizontal: 18,
    paddingBottom: 16,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    marginBottom: 8,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 12,
  },
  reasons: {
    maxHeight: 240,
    marginBottom: 8,
  },
  reason: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
  },
  input: {
    minHeight: 72,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    textAlignVertical: "top",
    marginBottom: 8,
  },
  error: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  secondary: {
    minHeight: 44,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primary: {
    minHeight: 44,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: {
    opacity: 0.5,
  },
  spinner: {
    marginVertical: 24,
  },
  circle: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 4,
  },
  fill: {
    flex: 1,
  },
  back: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  screenTitle: {
    fontSize: 22,
    lineHeight: 28,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  blockedScroll: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 12,
  },
  blockedNote: {
    fontSize: 15,
    lineHeight: 22,
  },
  group: {
    overflow: "hidden",
  },
  personRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingLeft: 16,
    paddingRight: 8,
  },
  unblock: {
    minHeight: 44,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  termsScreen: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  termsCard: {
    borderWidth: 1,
    paddingTop: 28,
    paddingHorizontal: 22,
    paddingBottom: 22,
  },
  wordmark: {
    alignItems: "center",
    marginBottom: 24,
  },
  legalRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
  },
  agree: {
    alignSelf: "stretch",
  },
});
