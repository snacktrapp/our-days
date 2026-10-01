import { useEffect, useState, type ReactNode } from "react";
import {
  KeyboardAvoidingView,
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

import {
  addExistingMember,
  addFromCircleLabel,
  type CircleDirectory,
  type DirectoryInvitation,
  type DirectoryMember,
  familyFacingCount,
  hasOrganizerPrivilege,
  listExistingMembers,
  loadCircleDirectory,
  memberShowsMore,
  memberSubtitle,
  peopleCountLabel,
  renameCircle,
  revokeMembership,
  setCircleArchived,
  setMembershipRole,
  setPersonGuardian,
  withdrawInvitation,
} from "../lib/circle-directory";
import { circleNameError, createCircle, createCircleSourceId } from "../lib/circles";
import { type CircleMembership } from "../lib/journal";
import { profileAccent } from "../lib/profile-accent";
import { requestCircleInvitation, validInvitationEmail } from "../lib/invites";
import { getSupabase } from "../lib/supabase";
import { useAppTheme } from "../lib/theme";
import { dotColor, dotInk, face, stageChromeInset, tracking, type ThemeColors } from "../lib/tokens";
import { ChevronRight, NavCircles } from "./icons";
import { KeyboardDoneBar, composerKeyboardDismissMode } from "./keyboard-form";

export function CirclesScreen({
  circles,
  onOpenJournal,
  onOpenPerson,
  onCirclesChanged,
  onScroll,
  accentToken,
  preview,
  initialSheet,
}: Readonly<{
  circles: readonly CircleMembership[];
  onOpenJournal: (circleId: string) => void;
  onOpenPerson: (circleId: string, personId: string, name: string) => void;
  onCirclesChanged: () => Promise<void> | void;
  /** Page accent for the Everyone tile. Web uses the recorder's profile color. */
  accentToken?: string | null;
  onScroll?: (y: number) => void;
  /** Design-preview directory. Skips the network load. */
  preview?: ReadonlyMap<string, CircleDirectory>;
  initialSheet?: "invite" | "create" | "settings" | "member" | null;
}>) {
  const insets = useSafeAreaInsets();
  const active = circles.filter((circle) => !circle.archivedAt);
  const archived = circles.filter((circle) => circle.archivedAt);
  const sourceId = createCircleSourceId(circles);
  const signature = circles
    .map((circle) => `${circle.circleId}:${circle.membershipId}:${circle.role}:${circle.name}:${circle.archivedAt ?? ""}`)
    .join("|");
  const [directory, setDirectory] = useState<ReadonlyMap<string, CircleDirectory>>(
    () => preview ?? new Map(),
  );
  const [loadedKey, setLoadedKey] = useState(preview ? signature : "");
  const [generation, setGeneration] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeError, setNoticeError] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(() =>
    initialSheetFor(initialSheet, active),
  );

  useEffect(() => {
    if (preview) return;
    const supabase = getSupabase();
    if (!supabase || signature.length === 0) return;
    let activeLoad = true;
    void loadCircleDirectory(supabase, circles).then((loaded) => {
      if (!activeLoad) return;
      setDirectory(loaded);
      setLoadedKey(signature);
    });
    return () => {
      activeLoad = false;
    };
  }, [preview, signature, generation, circles]);

  async function refresh(message?: string, failed = false) {
    if (message) {
      setNotice(message);
      setNoticeError(failed);
    }
    setGeneration((current) => current + 1);
    await onCirclesChanged();
  }

  return (
    <>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={styles.fill}
        onScroll={onScroll ? (event) => onScroll(event.nativeEvent.contentOffset.y) : undefined}
        scrollEventThrottle={16}
        contentContainerStyle={{
          paddingTop: insets.top + stageChromeInset,
          paddingBottom: insets.bottom + stageChromeInset + 56 + 10 + 28,
          paddingHorizontal: 16,
          gap: 28,
        }}
      >
        {notice ? <Notice message={notice} error={noticeError} /> : null}
        {active.map((circle) => (
          <CircleSection
            key={circle.circleId}
            circle={circle}
            directory={directory.get(circle.circleId)}
            loading={preview == null && loadedKey !== signature}
            sources={active.filter(
              (other) => other.circleId !== circle.circleId && hasOrganizerPrivilege(other.role),
            )}
            accentToken={accentToken}
            onOpenJournal={() => onOpenJournal(circle.circleId)}
            onOpenPerson={(personId, name) => onOpenPerson(circle.circleId, personId, name)}
            onInvite={() => setSheet({ kind: "invite", circleId: circle.circleId })}
            onSettings={() => setSheet({ kind: "settings", circleId: circle.circleId })}
            onMember={(memberId) => setSheet({ kind: "member", circleId: circle.circleId, memberId })}
            onInvitation={(emailRequestId) =>
              setSheet({ kind: "invitation", circleId: circle.circleId, emailRequestId })
            }
            onAdd={() => setSheet({ kind: "add", circleId: circle.circleId })}
          />
        ))}
        <PageActions
          canCreate={Boolean(sourceId)}
          archived={archived}
          onCreate={() => setSheet({ kind: "create" })}
          onRestore={async (circleId) => {
            const supabase = getSupabase();
            if (!supabase) return;
            const result = await setCircleArchived(supabase, circleId, false);
            await refresh(result.message, !result.ok);
          }}
        />
      </ScrollView>
      {sheet?.kind === "create" && sourceId ? (
        <CreateCircleSheet
          onClose={() => setSheet(null)}
          onCreate={async (name) => {
            const supabase = getSupabase();
            if (!supabase) return "That circle could not be created.";
            const result = await createCircle(supabase, name, sourceId);
            if (!result.ok) return result.message;
            setSheet(null);
            await refresh();
            return null;
          }}
        />
      ) : null}
      {sheet?.kind === "invite" ? (
        <InviteDrawer
          circleName={circles.find((circle) => circle.circleId === sheet.circleId)?.name ?? ""}
          onClose={() => setSheet(null)}
          onSend={async (displayName, email) => {
            const supabase = getSupabase();
            if (!supabase) return "That invitation could not be sent. Try again.";
            const result = await requestCircleInvitation(supabase, {
              circleId: sheet.circleId,
              displayName,
              email,
            });
            if (!result.ok) return result.message;
            setSheet(null);
            await refresh(result.message);
            return null;
          }}
        />
      ) : null}
      {sheet?.kind === "settings" ? (
        <CircleSettingsSheet
          circle={circles.find((circle) => circle.circleId === sheet.circleId) ?? null}
          canRename={directory.get(sheet.circleId)?.canRename === true}
          onClose={() => setSheet(null)}
          onRename={async (name) => {
            const supabase = getSupabase();
            if (!supabase) return "That circle could not be renamed.";
            const result = await renameCircle(supabase, sheet.circleId, name);
            if (result.ok) await refresh(result.message);
            return result.ok ? null : result.message;
          }}
          onArchive={async () => {
            const supabase = getSupabase();
            if (!supabase) return;
            const result = await setCircleArchived(supabase, sheet.circleId, true);
            setSheet(null);
            await refresh(result.message, !result.ok);
          }}
        />
      ) : null}
      {sheet?.kind === "member" ? (
        <MemberSheet
          member={
            directory.get(sheet.circleId)?.members.find((member) => member.id === sheet.memberId) ??
            null
          }
          guardians={directory.get(sheet.circleId)?.guardians ?? []}
          managedMembers={
            directory.get(sheet.circleId)?.members.filter((member) => member.profileKind === "managed") ??
            []
          }
          onClose={() => setSheet(null)}
          onRole={async (role) => {
            const member = directory
              .get(sheet.circleId)
              ?.members.find((item) => item.id === sheet.memberId);
            const supabase = getSupabase();
            if (!supabase || !member?.membershipId) return "That role could not be changed. Try again.";
            const result = await setMembershipRole(supabase, member.membershipId, role);
            if (result.ok) await refresh(result.message);
            return result.ok ? null : result.message;
          }}
          onRemove={async () => {
            const member = directory
              .get(sheet.circleId)
              ?.members.find((item) => item.id === sheet.memberId);
            const supabase = getSupabase();
            if (!supabase || !member?.membershipId) return;
            const result = await revokeMembership(supabase, member.membershipId);
            if (result.ok) setSheet(null);
            await refresh(result.message, !result.ok);
          }}
          onGuardian={async (guardianMembershipId, grantAccess, guardianName, memberName) => {
            const supabase = getSupabase();
            if (!supabase) return "That journal care could not be changed. Try again.";
            const result = await setPersonGuardian(supabase, {
              managedPersonId: sheet.memberId,
              guardianMembershipId,
              grantAccess,
            });
            const message = result.ok
              ? grantAccess
                ? `${guardianName} can now care for ${memberName}’s journal.`
                : `${guardianName} no longer has care access to ${memberName}’s journal.`
              : result.message;
            if (result.ok) await refresh(message);
            return result.ok ? null : message;
          }}
        />
      ) : null}
      {sheet?.kind === "invitation" ? (
        <InvitationSheet
          invitation={
            directory
              .get(sheet.circleId)
              ?.pending.find((item) => item.emailRequestId === sheet.emailRequestId) ?? null
          }
          onClose={() => setSheet(null)}
          onWithdraw={async () => {
            const supabase = getSupabase();
            if (!supabase) return;
            const result = await withdrawInvitation(supabase, sheet.emailRequestId);
            if (result.ok) setSheet(null);
            await refresh(result.message, !result.ok);
          }}
        />
      ) : null}
      {sheet?.kind === "add" ? (
        <AddExistingSheet
          circle={circles.find((circle) => circle.circleId === sheet.circleId) ?? null}
          sources={active.filter(
            (other) => other.circleId !== sheet.circleId && hasOrganizerPrivilege(other.role),
          )}
          onClose={() => setSheet(null)}
          onAdded={async (message, failed) => {
            await refresh(message, failed);
          }}
        />
      ) : null}
    </>
  );
}

type Sheet =
  | { kind: "create" }
  | { kind: "invite"; circleId: string }
  | { kind: "settings"; circleId: string }
  | { kind: "member"; circleId: string; memberId: string }
  | { kind: "invitation"; circleId: string; emailRequestId: string }
  | { kind: "add"; circleId: string };

function initialSheetFor(
  initial: "invite" | "create" | "settings" | "member" | null | undefined,
  active: readonly CircleMembership[],
): Sheet | null {
  const circle = active[0];
  if (!initial || !circle) return null;
  if (initial === "create") return { kind: "create" };
  if (initial === "invite") return { kind: "invite", circleId: circle.circleId };
  if (initial === "settings") return { kind: "settings", circleId: circle.circleId };
  return { kind: "member", circleId: circle.circleId, memberId: "molly" };
}

function CircleSection({
  circle,
  directory,
  loading,
  sources,
  accentToken,
  onOpenJournal,
  onOpenPerson,
  onInvite,
  onSettings,
  onMember,
  onInvitation,
  onAdd,
}: Readonly<{
  circle: CircleMembership;
  directory: CircleDirectory | undefined;
  loading: boolean;
  sources: readonly CircleMembership[];
  accentToken?: string | null;
  onOpenJournal: () => void;
  onOpenPerson: (personId: string, name: string) => void;
  onInvite: () => void;
  onSettings: () => void;
  onMember: (memberId: string) => void;
  onInvitation: (emailRequestId: string) => void;
  onAdd: () => void;
}>) {
  const { colors } = useAppTheme();
  const canManage = hasOrganizerPrivilege(circle.role);
  const members = directory?.members ?? [];
  const count = familyFacingCount(members);
  const subtitle = loading && !directory ? "the shared journal" : `${peopleCountLabel(count)} · the shared journal`;
  return (
    <View style={styles.section}>
      <View style={styles.sectionLabelRow}>
        <Text style={sectionLabelStyle(colors)}>{circle.name}</Text>
        {canManage ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Circle settings for ${circle.name}`}
            onPress={onSettings}
            style={styles.moreHit}
          >
            <Text style={[styles.moreGlyph, { color: colors.muted }]}>···</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={groupStyle(colors)}>
        <DirectoryRow
          title="Everyone"
          subtitle={subtitle}
          accessibilityLabel={`Open ${circle.name} circle feed`}
          onPress={onOpenJournal}
          leading={<TileAvatar accentToken={accentToken} />}
          chevron
        />
        {members.map((member) => (
          <MemberRow
            key={member.id}
            member={member}
            you={member.id === circle.personId}
            showMore={memberShowsMore(member, circle.membershipId, canManage)}
            onMore={() => onMember(member.id)}
            onOpen={
              member.role === "operations"
                ? undefined
                : () => onOpenPerson(member.id, member.name)
            }
            separator
          />
        ))}
        {(directory?.pending ?? []).map((item) => (
          <PendingRow
            key={item.emailRequestId}
            item={item}
            separator
            onMore={() => onInvitation(item.emailRequestId)}
          />
        ))}
        {canManage ? (
          <DirectoryRow
            title="Invite someone"
            action
            accessibilityLabel="Invite someone"
            onPress={onInvite}
            leading={<AddAvatar />}
            separator
          />
        ) : null}
        {canManage && sources.length > 0 ? (
          <DirectoryRow
            title={addFromCircleLabel(sources.map((source) => source.name))}
            action
            accessibilityLabel={addFromCircleLabel(sources.map((source) => source.name))}
            onPress={onAdd}
            leading={<AddAvatar />}
            separator
          />
        ) : null}
      </View>
    </View>
  );
}

function MemberRow({
  member,
  you,
  showMore,
  separator,
  onMore,
  onOpen,
}: Readonly<{
  member: DirectoryMember;
  you: boolean;
  showMore: boolean;
  separator?: boolean;
  onMore: () => void;
  onOpen?: () => void;
}>) {
  const subtitle = memberSubtitle(member);
  const title = `${member.name}${you ? " · You" : ""}`;
  return (
    <DirectoryRow
      title={title}
      subtitle={subtitle}
      separator={separator}
      chevron={Boolean(onOpen)}
      accessibilityLabel={onOpen ? `${member.name} — open journal` : undefined}
      onPress={onOpen}
      leading={<PersonAvatar initial={member.initial} accent={member.accent} />}
      more={
        showMore
          ? {
              label:
                member.profileKind === "managed"
                  ? `Manage journal for ${member.name}`
                  : `Manage role and access for ${member.name}`,
              onPress: onMore,
            }
          : undefined
      }
    />
  );
}

function PendingRow({
  item,
  separator,
  onMore,
}: Readonly<{ item: DirectoryInvitation; separator?: boolean; onMore: () => void }>) {
  const initial = Array.from(item.displayName.trim())[0]?.toLocaleUpperCase("en-US") ?? "•";
  return (
    <DirectoryRow
      title={item.displayName}
      subtitle="Invitation sent · waiting to accept"
      separator={separator}
      leading={<PendingAvatar initial={initial} />}
      more={{ label: `Review invitation for ${item.displayName}`, onPress: onMore }}
    />
  );
}

function DirectoryRow({
  title,
  subtitle,
  leading,
  separator = false,
  action,
  chevron,
  more,
  onPress,
  accessibilityLabel,
}: Readonly<{
  title: string;
  subtitle?: string;
  leading: ReactNode;
  separator?: boolean;
  action?: boolean;
  chevron?: boolean;
  more?: { label: string; onPress: () => void };
  onPress?: () => void;
  accessibilityLabel?: string;
}>) {
  const { colors } = useAppTheme();
  const body = (
    <>
      {separator ? <View style={[styles.separator, { backgroundColor: colors.hairline }]} /> : null}
      {leading}
      <View style={styles.copy}>
        <Text
          style={[
            face(colors, 600),
            styles.rowTitle,
            { color: action ? colors.action : colors.ink },
          ]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={[face(colors, 400), styles.rowSubtitle, { color: colors.muted }]}>{subtitle}</Text>
        ) : null}
      </View>
      <View style={styles.trail}>
        {more ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={more.label}
            onPress={(event) => {
              event.stopPropagation();
              more.onPress();
            }}
            style={styles.moreHit}
          >
            <Text style={[styles.moreGlyph, { color: colors.muted }]}>···</Text>
          </Pressable>
        ) : null}
        {chevron ? (
          <View style={styles.chevronSlot}>
            <ChevronRight color={colors.muted} />
          </View>
        ) : null}
      </View>
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      accessibilityRole={more ? undefined : "button"}
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={onPress}
      style={styles.row}
    >
      {body}
    </Pressable>
  );
}

function PageActions({
  canCreate,
  archived,
  onCreate,
  onRestore,
}: Readonly<{
  canCreate: boolean;
  archived: readonly CircleMembership[];
  onCreate: () => void;
  onRestore: (circleId: string) => void;
}>) {
  const { colors } = useAppTheme();
  const [open, setOpen] = useState(false);
  if (!canCreate && archived.length === 0) return null;
  return (
    <View style={groupStyle(colors)}>
      {canCreate ? (
        <DirectoryRow
          title="Create a circle"
          action
          accessibilityLabel="Create a circle"
          onPress={onCreate}
          leading={<AddAvatar />}
        />
      ) : null}
      {archived.length > 0 ? (
        <>
          <DirectoryRow
            title="Archived circles"
            subtitle={`${archived.length} ${archived.length === 1 ? "circle" : "circles"}`}
            accessibilityLabel="Archived circles"
            onPress={() => setOpen((current) => !current)}
            leading={<TileAvatar />}
            chevron
            separator={canCreate}
          />
          {open
            ? archived.map((circle) => (
                <View key={circle.circleId} style={[styles.archivedRow, { borderTopColor: colors.hairline }]}>
                  <Text style={[face(colors, 600), styles.rowTitle, { color: colors.ink, flex: 1 }]}>
                    {circle.name}
                  </Text>
                  {hasOrganizerPrivilege(circle.role) ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Restore ${circle.name}`}
                      onPress={() => onRestore(circle.circleId)}
                    >
                      <Text style={[face(colors, 400), { color: colors.clay, fontSize: 12 }]}>Restore circle</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))
            : null}
        </>
      ) : null}
    </View>
  );
}

function TileAvatar({ accentToken }: Readonly<{ accentToken?: string | null }>) {
  const { colors } = useAppTheme();
  const retro = colors.appearance === "retro";
  const accent = retro ? colors.action : dotColor(profileAccent(accentToken), colors);
  return (
    <View
      style={[
        styles.avatar,
        {
          borderRadius: retro ? 2 : 12,
          backgroundColor: mixHex(colors.cream, accent, 0.16),
        },
      ]}
    >
      <NavCircles color={accent} size={22} />
    </View>
  );
}

function PersonAvatar({ initial, accent }: Readonly<{ initial: string; accent: string }>) {
  const { colors } = useAppTheme();
  const retro = colors.appearance === "retro";
  return (
    <View
      style={[
        styles.avatar,
        {
          borderRadius: retro ? 2 : 20,
          backgroundColor: retro ? colors.action : dotColor(accent, colors),
        },
      ]}
    >
      <Text style={[face(colors, 700), styles.avatarInitial, { color: retro ? colors.paper : dotInk(accent, colors) }]}>
        {initial}
      </Text>
    </View>
  );
}

function AddAvatar() {
  const { colors } = useAppTheme();
  return (
    <View
      style={[
        styles.avatar,
        styles.dashedAvatar,
        {
          borderRadius: colors.appearance === "retro" ? 2 : 20,
          borderColor: withAlpha(colors.action, 0.55),
        },
      ]}
    >
      <Text style={[face(colors, 500), { color: colors.action, fontSize: 22, lineHeight: 24 }]}>+</Text>
    </View>
  );
}

function PendingAvatar({ initial }: Readonly<{ initial: string }>) {
  const { colors } = useAppTheme();
  return (
    <View
      style={[
        styles.avatar,
        styles.dashedAvatar,
        {
          borderRadius: colors.appearance === "retro" ? 2 : 20,
          borderColor: colors.muted,
        },
      ]}
    >
      <Text style={[face(colors, 700), styles.avatarInitial, { color: colors.muted }]}>{initial}</Text>
    </View>
  );
}

function Notice({ message, error }: Readonly<{ message: string; error: boolean }>) {
  const { colors } = useAppTheme();
  return (
    <Text
      accessibilityRole="text"
      style={[
        face(colors, 400),
        styles.notice,
        {
          color: error ? colors.clay : colors.ink,
          backgroundColor: mixHex(colors.cream, error ? colors.clay : colors.action, 0.12),
        },
      ]}
    >
      {message}
    </Text>
  );
}

function ManagementSheet({
  title,
  onClose,
  children,
}: Readonly<{ title?: string; onClose: () => void; children: React.ReactNode }>) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const retro = colors.appearance === "retro";
  const light = colors.scheme === "light" && !retro;
  const scrim = retro ? "#100d0c" : light ? "rgba(32,39,33,0.42)" : "rgba(0,5,3,0.72)";
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView
        style={[styles.scrim, { backgroundColor: scrim }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable accessibilityLabel="Close management" style={styles.scrimTap} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.paper,
              borderColor: colors.hairline,
              borderTopLeftRadius: retro ? 2 : 24,
              borderTopRightRadius: retro ? 2 : 24,
              paddingBottom: Math.max(24, insets.bottom),
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: retro ? "#6f655b" : "#526158" }]} />
          {title ? (
            <Text style={[face(colors, 650), styles.sheetTitle, { color: colors.ink }]}>{title}</Text>
          ) : (
            <View style={{ height: 28 }} />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close management"
            onPress={onClose}
            style={styles.closeHit}
          >
            <Text style={{ color: colors.muted, fontSize: 28, lineHeight: 32 }}>×</Text>
          </Pressable>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={composerKeyboardDismissMode}
            contentContainerStyle={styles.sheetBody}
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
      <KeyboardDoneBar />
    </Modal>
  );
}

function CreateCircleSheet({
  onClose,
  onCreate,
}: Readonly<{
  onClose: () => void;
  onCreate: (name: string) => Promise<string | null>;
}>) {
  const { colors } = useAppTheme();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const invalid = circleNameError(name);
  return (
    <ManagementSheet title="Create a circle" onClose={onClose}>
      <Text style={[face(colors, 400), styles.helper, { color: colors.muted }]}>
        A circle is a group of people who share one journal. You can invite people after it’s created.
      </Text>
      <Text style={fieldLabelStyle(colors)}>Name</Text>
      <TextInput
        value={name}
        onChangeText={(value) => {
          setName(value);
          setError(null);
        }}
        maxLength={80}
        autoFocus
        editable={!busy}
        style={fieldStyle(colors)}
        accessibilityLabel="Name"
      />
      {error ? <Text style={[face(colors, 400), { color: colors.clay, fontSize: 13 }]}>{error}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Create circle"
        disabled={busy || Boolean(invalid)}
        onPress={() => {
          setBusy(true);
          void onCreate(name).then((message) => {
            setBusy(false);
            setError(message);
          });
        }}
        style={[
          styles.primary,
          { backgroundColor: colors.action, opacity: busy || invalid ? 0.45 : 1 },
        ]}
      >
        <Text style={[face(colors, 650), { color: colors.actionInk, fontSize: 16 }]}>
          {busy ? "Creating…" : "Create circle"}
        </Text>
      </Pressable>
    </ManagementSheet>
  );
}

function CircleSettingsSheet({
  circle,
  canRename,
  onClose,
  onRename,
  onArchive,
}: Readonly<{
  circle: CircleMembership | null;
  canRename: boolean;
  onClose: () => void;
  onRename: (name: string) => Promise<string | null>;
  onArchive: () => Promise<void>;
}>) {
  const { colors } = useAppTheme();
  const [name, setName] = useState(circle?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  if (!circle) return null;
  return (
    <ManagementSheet onClose={onClose}>
      <Text style={eyebrowStyle(colors)}>Circle settings</Text>
      <Text style={[face(colors, 650), styles.sheetHeading, { color: colors.ink }]}>{circle.name}</Text>
      {canRename ? (
        <>
          <Text style={fieldLabelStyle(colors)}>Circle name</Text>
          <TextInput
            value={name}
            onChangeText={(value) => {
              setName(value);
              setError(null);
            }}
            maxLength={80}
            editable={!busy}
            style={fieldStyle(colors)}
            accessibilityLabel="Circle name"
          />
          {error ? <Text style={[face(colors, 400), { color: colors.clay, fontSize: 13 }]}>{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy || !name.trim()}
            onPress={() => {
              setBusy(true);
              void onRename(name).then((message) => {
                setBusy(false);
                if (message) setError(message);
                else onClose();
              });
            }}
            style={[styles.primary, { backgroundColor: colors.action, opacity: busy || !name.trim() ? 0.45 : 1 }]}
          >
            <Text style={[face(colors, 650), { color: colors.actionInk, fontSize: 16 }]}>
              {busy ? "Saving…" : "Save name"}
            </Text>
          </Pressable>
        </>
      ) : null}
      {confirming ? (
        <View style={{ marginTop: 16, gap: 12 }}>
          <Text style={[face(colors, 400), { color: colors.ink, fontSize: 15, lineHeight: 22 }]}>
            Archive “{circle.name}”? It will be hidden from circle lists and posting choices for everyone. Posts and
            people are kept. You can restore it anytime.
          </Text>
          <View style={styles.reviewActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setConfirming(false)}
              style={[styles.secondary, { borderColor: colors.hairline, backgroundColor: colors.surface }]}
            >
              <Text style={[face(colors, 650), { color: colors.ink, fontSize: 15 }]}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => {
                setBusy(true);
                void onArchive();
              }}
              style={[styles.secondary, { borderColor: colors.hairline, backgroundColor: colors.surface }]}
            >
              <Text style={[face(colors, 650), { color: colors.ink, fontSize: 15 }]}>
                {busy ? "Archiving…" : "Archive circle"}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable accessibilityRole="button" onPress={() => setConfirming(true)} style={styles.archiveHit}>
          <Text style={[face(colors, 400), { color: colors.clay, fontSize: 12 }]}>Archive circle</Text>
        </Pressable>
      )}
    </ManagementSheet>
  );
}

function MemberSheet({
  member,
  guardians,
  managedMembers,
  onClose,
  onRole,
  onRemove,
  onGuardian,
}: Readonly<{
  member: DirectoryMember | null;
  guardians: CircleDirectory["guardians"];
  managedMembers: readonly DirectoryMember[];
  onClose: () => void;
  onRole: (role: "member" | "organizer") => Promise<string | null>;
  onRemove: () => Promise<void>;
  onGuardian: (
    guardianMembershipId: string,
    grantAccess: boolean,
    guardianName: string,
    memberName: string,
  ) => Promise<string | null>;
}>) {
  const { colors } = useAppTheme();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!member) return null;
  const isManaged = member.profileKind === "managed";
  const nextRole = member.role === "organizer" ? "member" : "organizer";
  const assigned = member.membershipId
    ? managedMembers
        .filter((profile) => profile.guardianMembershipIds.includes(member.membershipId ?? ""))
        .map((profile) => profile.name)
    : [];
  return (
    <ManagementSheet onClose={onClose}>
      <Text style={eyebrowStyle(colors)}>{isManaged ? "Journal care" : "Role and access"}</Text>
      <Text style={[face(colors, 650), styles.sheetHeading, { color: colors.ink }]}>
        {isManaged ? `Care for ${member.name}’s journal` : `Manage ${member.name}`}
      </Text>
      {isManaged ? (
        <>
          <Text style={[face(colors, 400), styles.helper, { color: colors.muted }]}>
            Organizers have access to all managed journals. Assigned caregivers retain access even without organizer
            controls.
          </Text>
          <Text style={eyebrowStyle(colors)}>Assigned caregivers</Text>
          {guardians.map((guardian) => {
            const isAssigned = member.guardianMembershipIds.includes(guardian.membershipId);
            const detail =
              guardian.role === "organizer"
                ? isAssigned
                  ? "Organizer · assignment stays if their role changes"
                  : "Organizer · already has care access"
                : isAssigned
                  ? "Member · assigned caregiver"
                  : "Member · no care access";
            return (
              <View key={guardian.membershipId} style={[styles.guardianRow, { borderColor: colors.hairline }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[face(colors, 600), { color: colors.ink, fontSize: 15 }]}>{guardian.name}</Text>
                  <Text style={[face(colors, 400), { color: colors.muted, fontSize: 12 }]}>{detail}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${isAssigned ? "Remove" : "Assign"} ${guardian.name} as caregiver for ${member.name}`}
                  disabled={busy}
                  onPress={() => {
                    setBusy(true);
                    void onGuardian(guardian.membershipId, !isAssigned, guardian.name, member.name).then(
                      (message) => {
                        setBusy(false);
                        setError(message);
                      },
                    );
                  }}
                >
                  <Text style={[face(colors, 650), { color: colors.action, fontSize: 14 }]}>
                    {isAssigned ? "Remove" : "Assign"}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </>
      ) : member.role === "operations" ? (
        <View style={[styles.roleCard, { borderColor: colors.hairline, backgroundColor: colors.cream }]}>
          <Text style={[face(colors, 600), { color: colors.ink, fontSize: 16 }]}>Current role: Operations</Text>
          <Text style={[face(colors, 400), { color: colors.muted, fontSize: 15, lineHeight: 22 }]}>
            Operations has organizer access and does not appear in the journal.
          </Text>
        </View>
      ) : (
        <View style={[styles.roleCard, { borderColor: colors.hairline, backgroundColor: colors.cream }]}>
          <Text style={[face(colors, 600), { color: colors.ink, fontSize: 16 }]}>
            Current role: {member.role === "organizer" ? "Organizer" : "Member"}
          </Text>
          <Text style={[face(colors, 400), { color: colors.muted, fontSize: 15, lineHeight: 22 }]}>
            {nextRole === "organizer"
              ? "Organizers manage members and access to managed journals. They cannot edit another account’s posts."
              : `${member.name} will keep circle access but lose organizer controls and automatic access to managed journals.${
                  assigned.length ? ` Assigned access to ${assigned.join(", ")} will remain.` : ""
                }`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              nextRole === "organizer" ? `Make organizer: ${member.name}` : `Change to member: ${member.name}`
            }
            disabled={busy || !member.membershipId}
            onPress={() => {
              setBusy(true);
              void onRole(nextRole).then((message) => {
                setBusy(false);
                setError(message);
              });
            }}
            style={[styles.secondary, { borderColor: colors.hairline, backgroundColor: colors.surface }]}
          >
            <Text style={[face(colors, 650), { color: colors.action, fontSize: 15 }]}>
              {nextRole === "organizer" ? "Make organizer" : "Change to member"}
            </Text>
          </Pressable>
        </View>
      )}
      {error ? <Text style={[face(colors, 400), { color: colors.clay, fontSize: 13 }]}>{error}</Text> : null}
      {member.profileKind === "account" ? (
        <View style={{ marginTop: 20, gap: 10 }}>
          <Text style={[face(colors, 400), { color: colors.muted, fontSize: 15, lineHeight: 22 }]}>
            This person will lose access to this circle. Their account and existing posts will remain.
          </Text>
          <Text style={[face(colors, 600), { color: colors.ink, fontSize: 13, lineHeight: 18 }]}>
            This takes effect immediately, including access to managed journals in this circle.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove access for ${member.name}`}
            disabled={busy}
            onPress={() => {
              setBusy(true);
              void onRemove();
            }}
            style={[styles.danger, { backgroundColor: colors.danger }]}
          >
            <Text style={[face(colors, 650), { color: "#fffaf0", fontSize: 16 }]}>Remove access</Text>
          </Pressable>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={onClose}
        style={[styles.primary, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline }]}
      >
        <Text style={[face(colors, 650), { color: colors.ink, fontSize: 16 }]}>Done</Text>
      </Pressable>
    </ManagementSheet>
  );
}

function InvitationSheet({
  invitation,
  onClose,
  onWithdraw,
}: Readonly<{
  invitation: DirectoryInvitation | null;
  onClose: () => void;
  onWithdraw: () => Promise<void>;
}>) {
  const { colors } = useAppTheme();
  const [busy, setBusy] = useState(false);
  if (!invitation) return null;
  return (
    <ManagementSheet onClose={onClose}>
      <Text style={eyebrowStyle(colors)}>Withdraw invitation</Text>
      <Text style={[face(colors, 650), styles.sheetHeading, { color: colors.ink }]}>
        Review {invitation.displayName}’s invitation
      </Text>
      <Text style={[face(colors, 400), styles.helper, { color: colors.muted }]}>
        Withdrawing it prevents this invitation from being accepted. It does not change access for anyone already in
        the circle.
      </Text>
      <View style={styles.reviewActions}>
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={[styles.secondary, { borderColor: colors.hairline, backgroundColor: colors.surface }]}
        >
          <Text style={[face(colors, 650), { color: colors.ink, fontSize: 15 }]}>Keep invitation</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Withdraw invitation for ${invitation.displayName}`}
          disabled={busy}
          onPress={() => {
            setBusy(true);
            void onWithdraw();
          }}
          style={[styles.danger, { backgroundColor: colors.danger, flex: 1 }]}
        >
          <Text style={[face(colors, 650), { color: "#fffaf0", fontSize: 15 }]}>
            {busy ? "Withdrawing…" : "Withdraw invitation"}
          </Text>
        </Pressable>
      </View>
    </ManagementSheet>
  );
}

function InviteDrawer({
  circleName,
  onClose,
  onSend,
}: Readonly<{
  circleName: string;
  onClose: () => void;
  onSend: (displayName: string, email: string) => Promise<string | null>;
}>) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const retro = colors.appearance === "retro";
  const light = colors.scheme === "light" && !retro;
  const scrim = retro ? "#100d0c" : light ? "rgba(32,39,33,0.42)" : "rgba(0,5,3,0.72)";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ displayName: string; email: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function review() {
    const displayName = name.trim();
    const nextEmail = email.trim().toLowerCase();
    if (displayName.length < 1 || Array.from(displayName).length > 80) {
      setError("Enter the member’s name.");
      return;
    }
    if (!validInvitationEmail(nextEmail)) {
      setError("Enter a complete email address.");
      return;
    }
    setError(null);
    setDraft({ displayName, email: nextEmail });
  }

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView
        style={[styles.scrim, { backgroundColor: scrim }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable accessibilityLabel="Close" style={styles.scrimTap} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: retro ? colors.cream : colors.paper,
              borderColor: colors.hairline,
              borderTopLeftRadius: retro ? 2 : 14,
              borderTopRightRadius: retro ? 2 : 14,
              paddingBottom: Math.max(16, insets.bottom),
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: retro ? "#6f655b" : "#526158" }]} />
          <Text style={[face(colors, 650), styles.inviteTitle, { color: colors.ink }]}>Invite someone</Text>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={composerKeyboardDismissMode}
            contentContainerStyle={styles.inviteBody}
          >
            <Text style={[face(colors, 400, "record"), { color: colors.muted, fontSize: 11 }]}>{circleName}</Text>
            {draft ? (
              <>
                <Text style={eyebrowStyle(colors)}>Review invitation</Text>
                <Text style={[face(colors, 650), styles.sheetHeading, { color: colors.ink }]}>
                  Invite {draft.displayName}
                </Text>
                <Text style={[face(colors, 400), { color: colors.ink, fontSize: 15 }]}>{draft.email}</Text>
                <Text style={[face(colors, 400), styles.helper, { color: colors.muted }]}>
                  They’ll be able to see and contribute to this circle. They won’t have organizer controls.
                </Text>
                {error ? <Text style={[face(colors, 400), { color: colors.clay, fontSize: 13 }]}>{error}</Text> : null}
                <View style={styles.reviewActions}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => {
                      setDraft(null);
                      setError(null);
                    }}
                    style={[styles.secondary, { borderColor: colors.hairline, backgroundColor: colors.surface }]}
                  >
                    <Text style={[face(colors, 650), { color: colors.ink, fontSize: 15 }]}>Back to edit</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => {
                      setBusy(true);
                      void onSend(draft.displayName, draft.email).then((message) => {
                        setBusy(false);
                        setError(message);
                      });
                    }}
                    style={[styles.primary, { backgroundColor: colors.action, flex: 1, marginTop: 0 }]}
                  >
                    <Text style={[face(colors, 650), { color: colors.actionInk, fontSize: 15 }]}>
                      {busy ? "Sending…" : "Send private invitation"}
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={fieldLabelStyle(colors)}>Member’s name</Text>
                <TextInput
                  value={name}
                  onChangeText={(value) => {
                    setName(value);
                    setError(null);
                  }}
                  maxLength={80}
                  autoFocus
                  style={fieldStyle(colors)}
                  accessibilityLabel="Their name"
                />
                <Text style={fieldLabelStyle(colors)}>Email address</Text>
                <TextInput
                  value={email}
                  onChangeText={(value) => {
                    setEmail(value);
                    setError(null);
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  maxLength={254}
                  style={fieldStyle(colors)}
                  accessibilityLabel="Email address"
                />
                <Text style={[face(colors, 400), styles.helper, { color: colors.muted }]}>
                  {error ?? "You can review both details before anything is sent."}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={review}
                  style={[styles.primary, { backgroundColor: colors.action }]}
                >
                  <Text style={[face(colors, 650), { color: colors.actionInk, fontSize: 16 }]}>Review invitation</Text>
                </Pressable>
              </>
            )}
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.closeText}>
              <Text style={[face(colors, 400), { color: colors.muted, fontSize: 16 }]}>Close</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
      <KeyboardDoneBar />
    </Modal>
  );
}

function AddExistingSheet({
  circle,
  sources,
  onClose,
  onAdded,
}: Readonly<{
  circle: CircleMembership | null;
  sources: readonly CircleMembership[];
  onClose: () => void;
  onAdded: (message: string, failed: boolean) => Promise<void>;
}>) {
  const { colors } = useAppTheme();
  const [sourceId, setSourceId] = useState("");
  const [people, setPeople] = useState<readonly { membershipId: string; name: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const targetId = circle?.circleId ?? "";
  if (!circle) return null;

  async function load(nextSource: string) {
    setSourceId(nextSource);
    setSelected("");
    setPeople([]);
    setLoaded(false);
    setMessage("");
    const supabase = getSupabase();
    if (!supabase || !nextSource) return;
    setBusy(true);
    const result = await listExistingMembers(supabase, nextSource, targetId);
    setBusy(false);
    setPeople(result.members);
    setLoaded(result.ok);
    setFailed(!result.ok);
    setMessage(result.message);
  }

  return (
    <ManagementSheet onClose={onClose}>
      <Text style={eyebrowStyle(colors)}>Add from a circle</Text>
      <Text style={[face(colors, 650), styles.sheetHeading, { color: colors.ink }]}>{circle.name}</Text>
      <Text style={[face(colors, 400), styles.helper, { color: colors.muted }]}>
        Add a member from another circle you manage.
      </Text>
      <Text style={fieldLabelStyle(colors)}>From circle</Text>
      {sources.map((source) => (
        <Pressable
          key={source.circleId}
          accessibilityRole="button"
          onPress={() => void load(source.circleId)}
          style={[
            styles.choice,
            {
              borderColor: source.circleId === sourceId ? colors.action : colors.hairline,
              backgroundColor: colors.surface,
            },
          ]}
        >
          <Text style={[face(colors, 600), { color: colors.ink, fontSize: 16 }]}>{source.name}</Text>
        </Pressable>
      ))}
      {busy ? <Text style={[face(colors, 400), { color: colors.muted }]}>Loading members…</Text> : null}
      {loaded && people.length > 0 ? (
        <>
          <Text style={fieldLabelStyle(colors)}>Person</Text>
          {people.map((person) => (
            <Pressable
              key={person.membershipId}
              accessibilityRole="button"
              onPress={() => setSelected(person.membershipId)}
              style={[
                styles.choice,
                {
                  borderColor: person.membershipId === selected ? colors.action : colors.hairline,
                  backgroundColor: colors.surface,
                },
              ]}
            >
              <Text style={[face(colors, 600), { color: colors.ink, fontSize: 16 }]}>{person.name}</Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            disabled={busy || !selected}
            onPress={() => {
              const supabase = getSupabase();
              if (!supabase || !selected) return;
              setBusy(true);
              void addExistingMember(supabase, selected, circle.circleId).then(async (result) => {
                setBusy(false);
                if (result.ok) {
                  onClose();
                  await onAdded(result.message, false);
                  return;
                }
                setFailed(true);
                setMessage(result.message);
              });
            }}
            style={[styles.primary, { backgroundColor: colors.action, opacity: busy || !selected ? 0.45 : 1 }]}
          >
            <Text style={[face(colors, 650), { color: colors.actionInk, fontSize: 16 }]}>
              {busy ? "Adding…" : `Add to ${circle.name}`}
            </Text>
          </Pressable>
        </>
      ) : null}
      {loaded && people.length === 0 ? (
        <Text style={[face(colors, 400), { color: colors.muted, fontSize: 15, lineHeight: 22 }]}>
          No members available to add. To invite someone else, use their email below.
        </Text>
      ) : null}
      {message ? (
        <Text style={[face(colors, 400), { color: failed ? colors.clay : colors.ink, fontSize: 13 }]}>{message}</Text>
      ) : null}
    </ManagementSheet>
  );
}

function groupStyle(colors: ThemeColors) {
  return [
    styles.group,
    {
      backgroundColor: colors.cream,
      borderRadius: colors.appearance === "retro" ? 2 : 18,
    },
  ];
}

function sectionLabelStyle(colors: ThemeColors) {
  return [
    face(colors, 600),
    styles.sectionLabel,
    {
      color: colors.appearance === "retro" ? colors.muted : colors.ink,
      textTransform: colors.appearance === "retro" ? ("uppercase" as const) : ("none" as const),
      letterSpacing: colors.appearance === "retro" ? tracking(13, 0.08) : 0,
    },
  ];
}

function eyebrowStyle(colors: ThemeColors) {
  return [
    face(colors, 650, "record"),
    styles.eyebrow,
    { color: colors.action, letterSpacing: tracking(9, 0.13) },
  ];
}

function fieldLabelStyle(colors: ThemeColors) {
  return [
    face(colors, 400, "record"),
    styles.fieldLabel,
    { color: colors.muted, letterSpacing: tracking(10, 0.04) },
  ];
}

function fieldStyle(colors: ThemeColors) {
  return [
    face(colors, 400),
    styles.field,
    {
      color: colors.ink,
      backgroundColor: colors.surface,
      borderColor: colors.hairline,
      borderRadius: colors.appearance === "retro" ? 2 : 12,
    },
  ];
}

function mixHex(base: string, tint: string, share: number) {
  if (!/^#[0-9a-fA-F]{6}$/.test(base) || !/^#[0-9a-fA-F]{6}$/.test(tint)) return base;
  const parse = (hex: string) =>
    [0, 2, 4].map((start) => Number.parseInt(hex.slice(start + 1, start + 3), 16));
  const [br, bg, bb] = parse(base);
  const [tr, tg, tb] = parse(tint);
  const channel = (from: number, to: number) =>
    Math.round(from + (to - from) * share)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(br, tr)}${channel(bg, tg)}${channel(bb, tb)}`;
}

function withAlpha(hex: string, alpha: number) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  section: { gap: 8 },
  sectionLabelRow: {
    minHeight: 28,
    paddingHorizontal: 4,
    flexDirection: "row",
    alignItems: "center",
  },
  sectionLabel: { flex: 1, fontSize: 13, lineHeight: 17 },
  group: { overflow: "hidden" },
  row: {
    position: "relative",
    minHeight: 56,
    paddingTop: 8,
    paddingBottom: 8,
    paddingLeft: 16,
    paddingRight: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  separator: {
    position: "absolute",
    top: 0,
    left: 70,
    right: 0,
    height: 1,
  },
  copy: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, lineHeight: 20 },
  rowSubtitle: { fontSize: 12, lineHeight: 17 },
  trail: { flexDirection: "row", alignItems: "center" },
  moreHit: {
    width: 44,
    height: 44,
    marginRight: -6,
    alignItems: "center",
    justifyContent: "center",
  },
  moreGlyph: { fontSize: 22, letterSpacing: 1, lineHeight: 24 },
  chevronSlot: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  avatar: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  avatarInitial: { fontSize: 16, lineHeight: 18 },
  dashedAvatar: { borderWidth: 1.5, borderStyle: "dashed", backgroundColor: "transparent" },
  archivedRow: {
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  notice: {
    alignSelf: "center",
    overflow: "hidden",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
  },
  scrim: { flex: 1, justifyContent: "flex-end" },
  scrimTap: { flex: 1 },
  sheet: {
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    maxHeight: "88%",
  },
  handle: {
    position: "absolute",
    top: 10,
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 999,
  },
  sheetTitle: {
    marginTop: 28,
    paddingHorizontal: 20,
    paddingRight: 56,
    fontSize: 17,
    lineHeight: 22,
  },
  closeHit: {
    position: "absolute",
    top: 4,
    right: 12,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetBody: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8, gap: 8 },
  sheetHeading: { fontSize: 20, lineHeight: 24, marginBottom: 4 },
  eyebrow: { fontSize: 9, lineHeight: 12, textTransform: "uppercase" },
  helper: { fontSize: 15, lineHeight: 22, marginBottom: 8 },
  fieldLabel: { fontSize: 10, lineHeight: 14, textTransform: "uppercase", marginTop: 4 },
  field: {
    minHeight: 48,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 16,
    ...(Platform.OS === "web" ? { outlineWidth: 0 } : null),
  },
  primary: {
    minHeight: 48,
    marginTop: 8,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  secondary: {
    flex: 1,
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  danger: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  reviewActions: { flexDirection: "row", gap: 8, marginTop: 8 },
  roleCard: { marginTop: 8, padding: 13, gap: 9, borderWidth: 1, borderRadius: 15 },
  guardianRow: {
    minHeight: 56,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  choice: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    justifyContent: "center",
  },
  archiveHit: { minHeight: 44, justifyContent: "center", marginTop: 8 },
  inviteTitle: {
    marginTop: 28,
    textAlign: "center",
    fontSize: 17,
    lineHeight: 22,
  },
  inviteBody: { paddingHorizontal: 20, paddingBottom: 8, gap: 8 },
  closeText: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: 4 },
});
