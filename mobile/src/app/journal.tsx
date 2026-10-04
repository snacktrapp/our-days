import * as SecureStore from "expo-secure-store";
import { Redirect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../components/auth-provider";
import { GridBackground } from "../components/grid-background";
import {
  JournalHeader,
  JournalNav,
  type SwitcherItem,
} from "../components/journal-chrome";
import { SettingsScreen } from "../components/settings-screen";
import { authorHidden, withoutBlockedAuthor } from "../lib/safety";
import { MentionsBanner } from "../components/journal-banner";
import { FeedMoment } from "../components/moment-card";
import { ShareSheet } from "../components/share-sheet";
import { dismissShareDraft, subscribeShareDraft } from "../components/share-bridge";
import type { ShareDraft } from "../lib/share-entry";
import { AddSheet } from "../components/add-sheet";
import { ActivitySheet } from "../components/activity-sheet";
import { FeedScrollLock } from "../lib/feed-scroll-lock";
import { CirclesScreen } from "../components/circles-screen";
import { usePendingUploads } from "../components/pending-media";
import { writePref } from "../lib/appearance";
import { type Audience } from "../lib/posts";
import {
  listPending,
  mergePending,
  restorePending,
  settlePending,
  subscribePending,
} from "../lib/pending-uploads";
import { profileAccent } from "../lib/profile-accent";
import { loadActivity, readSeenActivityIds, type ActivityItem } from "../lib/activity";
import { readNotificationTarget } from "../../../src/lib/activity-notifications";
import { circleToday } from "../lib/dates";
import { readLastPostedCircle } from "../lib/last-posted-circle";
import {
  loadCircles,
  loadMomentPhotos,
  loadTimelinePage,
  loadViewerProfile,
  saveProfileColor,
  type CircleMembership,
  type TimelineMoment,
  type TimelinePage,
  type ViewerProfile,
} from "../lib/journal";
import { momentListedInFeed } from "../lib/feed-format";
import { runMomentEdit, type EditReopen } from "../lib/moment-edit-save";
import { formatPlainDate } from "../lib/moment-time";
import { disablePushNotifications, subscribeNotificationOpens } from "../lib/push";
import type { PushLanding } from "../lib/push-landing";
import { getSupabase, mediaRequestHeaders } from "../lib/supabase";
import { useAppTheme } from "../lib/theme";
import {
  chromeHeight,
  face,
  floatGap,
  stageChromeInset,
  timelineBottomPad,
  timelineInset,
  tracking,
} from "../lib/tokens";

const mentionsKey = "our-days:mentions-announcement";
/**
 * SecureStore only accepts letters, digits, ".", "-" and "_" in keys, so the
 * web key (with ":") threw on iOS and the dismissal never stuck.
 */
const mentionsStoreKey = Platform.OS === "web" ? mentionsKey : "our-days.mentions-announcement";
/** Pause a clip once the row is almost entirely off the screen. */
const momentViewability = { itemVisiblePercentThreshold: 10 };
const allScope = "all";
const youScope = "you";
const activeCircleCookie = "our-days-active-circle";

/** Same cookie the web uses for the journal's current circle. */
function readActiveCircleCookie() {
  if (Platform.OS !== "web" || typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${activeCircleCookie}=([^;]+)`),
  );
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function feedKind(scope: string) {
  if (scope === allScope) return "all" as const;
  if (scope === youScope) return "personal" as const;
  return "circle" as const;
}

type FeedRow =
  | Readonly<{ kind: "date"; id: string; label: string; divider: boolean }>
  | Readonly<{ kind: "moment"; id: string; moment: TimelineMoment }>
  | Readonly<{ kind: "end"; id: string }>;

function buildRows(
  moments: readonly TimelineMoment[],
  today: string,
  hasMore: boolean,
): readonly FeedRow[] {
  if (moments.length === 0) return [];
  const rows: FeedRow[] = [];
  let previous: string | undefined;
  for (const moment of moments) {
    if (moment.occurredOn !== previous) {
      rows.push({
        kind: "date",
        id: `date-${moment.occurredOn}`,
        label: formatPlainDate(moment.occurredOn, today),
        divider: Boolean(previous) && previous?.slice(0, 4) !== moment.occurredOn.slice(0, 4),
      });
      previous = moment.occurredOn;
    }
    rows.push({ kind: "moment", id: moment.id, moment });
  }
  if (!hasMore) rows.push({ kind: "end", id: "end" });
  return rows;
}

export default function JournalScreen() {
  const { ready, session, signOut } = useAuth();
  const theme = useAppTheme();
  const { colors } = theme;
  const insets = useSafeAreaInsets();
  const supabase = useMemo(() => getSupabase(), []);
  const [circles, setCircles] = useState<readonly CircleMembership[]>([]);
  const [scope, setScope] = useState(allScope);
  const [moments, setMoments] = useState<readonly TimelineMoment[]>([]);
  const [page, setPage] = useState<TimelinePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mediaHeaders, setMediaHeaders] = useState<
    Record<string, string> | null | undefined
  >(undefined);
  const [addOpen, setAddOpen] = useState(false);
  /** The post being edited; a failed save reopens it with the draft and error. */
  const [editing, setEditing] = useState<(Partial<EditReopen> & { moment: TimelineMoment; key: number }) | null>(
    null,
  );
  const editKey = useRef(0);
  const [circlesOpen, setCirclesOpen] = useState(false);
  const [personJournal, setPersonJournal] = useState<{
    circleId: string;
    personId: string;
    name: string;
  } | null>(null);
  const personRef = useRef(personJournal);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityItems, setActivityItems] = useState<readonly ActivityItem[]>([]);
  const [seenActivity, setSeenActivity] = useState<readonly string[]>(() => readSeenActivityIds());
  const homeCircleId = readActiveCircleCookie();
  const [lastPostedCircleId, setLastPostedCircleId] = useState<string | null>(null);
  const pendingJobs = usePendingUploads();
  const settledJobs = useRef(new Set<string>());
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hiddenAuthors, setHiddenAuthors] = useState<readonly string[]>([]);
  const [shareDraft, setShareDraft] = useState<ShareDraft | null>(null);
  const [profile, setProfile] = useState<ViewerProfile | null>(null);
  const [chromeOffset, setChromeOffset] = useState(0);
  // Circles: the header scrolls away with the directory like the web page;
  // the bottom nav stays pinned.
  const [circlesHeaderOffset, setCirclesHeaderOffset] = useState(0);
  const [pull, setPull] = useState(0);
  const [showMentions, setShowMentions] = useState(false);
  const [viewabilityReady, setViewabilityReady] = useState(false);
  const [visibleMomentIds, setVisibleMomentIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const yRef = useRef(0);
  const offsetRef = useRef(0);
  const momentsRef = useRef(moments);
  const postedMomentIds = useRef<ReadonlySet<string> | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    momentsRef.current = moments;
  }, [moments]);
  const [landing, setLanding] = useState<PushLanding | null>(null);
  const listRef = useRef<FlatList<FeedRow>>(null);
  const lockFeedScroll = useCallback((locked: boolean) => {
    // iOS only: a native UIScrollView keeps scrolling under a PanResponder.
    if (Platform.OS !== "ios") return;
    listRef.current?.setNativeProps({ scrollEnabled: !locked });
  }, []);
  const landingPages = useRef(0);
  const circlesRef = useRef(circles);
  const loadFirstPageRef = useRef<
    (nextScope: string, memberships: readonly CircleMembership[]) => Promise<void>
  >(async () => undefined);
  const loadEarlierRef = useRef<() => Promise<void>>(async () => undefined);

  const viewerYear = new Date().getFullYear();
  const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = circleToday(viewerZone);
  const distance = insets.top + floatGap + chromeHeight + 24;
  const circleNames = useMemo(
    () => new Map(circles.map((circle) => [circle.circleId, circle.name])),
    [circles],
  );
  const membershipIds = useMemo(
    () => circles.map((circle) => circle.membershipId),
    [circles],
  );

  const loadFirstPage = useCallback(
    async (nextScope: string, memberships: readonly CircleMembership[]) => {
      if (!supabase) return;
      setError(null);
      try {
        const person = personRef.current;
        const kind = feedKind(nextScope);
        const next = await loadTimelinePage(supabase, {
          circleId: person ? person.circleId : kind === "circle" ? nextScope : null,
          journalPersonId: person?.personId,
          fallbackCircleId: person || kind !== "all" ? undefined : memberships[0]?.circleId,
          viewerMembershipIds: memberships.map((circle) => circle.membershipId),
          personal:
            person || kind !== "personal"
              ? undefined
              : memberships.map((circle) => ({
                  circleId: circle.circleId,
                  personId: circle.personId,
                })),
        });
        setMoments(next.moments);
        setPage(next);
        const before = postedMomentIds.current;
        if (before) {
          postedMomentIds.current = null;
          const newest = next.moments.find((moment) => !before.has(moment.id));
          requestAnimationFrame(() => {
            listRef.current?.scrollToOffset({ offset: 0, animated: true });
          });
          if (newest) {
            setHighlightId(newest.id);
            setTimeout(() => {
              setHighlightId((current) => (current === newest.id ? null : current));
            }, 1600);
          }
        }
      } catch {
        setMoments([]);
        setPage(null);
        setError("The timeline could not be loaded.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [supabase],
  );

  useEffect(() => subscribeShareDraft(setShareDraft), []);

  useEffect(() => {
    if (!session?.user.id || Platform.OS === "web") return;
    void readLastPostedCircle(session.user.id).then(setLastPostedCircleId);
  }, [session?.user.id]);

  // Failed uploads from an earlier launch come back on their cards (web #148).
  useEffect(() => {
    if (!supabase || !session?.user.id || Platform.OS === "web") return;
    void import("../lib/pending-upload-files").then(({ pendingFileStorage }) =>
      restorePending(pendingFileStorage(session.user.id), supabase),
    );
  }, [session?.user.id, supabase]);

  // A finished upload: reload so the real post (or its new photos) replaces
  // the pending card, then drop the local copy.
  useEffect(() => {
    if (!supabase) return;
    return subscribePending(() => {
      for (const job of listPending()) {
        if (job.state !== "done" || settledJobs.current.has(job.id)) continue;
        settledJobs.current.add(job.id);
        const momentId = job.momentId;
        if (job.mode === "post") {
          void (async () => {
            // Publishing can trail the upload by a few seconds.
            for (let attempt = 0; attempt < 4; attempt += 1) {
              await loadFirstPage(scope, circles);
              await new Promise((resolve) => setTimeout(resolve, 300));
              if (momentsRef.current.some((item) => item.id === momentId)) break;
              await new Promise((resolve) => setTimeout(resolve, 3000));
            }
            settlePending([job.id]);
          })();
        } else if (momentId) {
          void (async () => {
            const expected = job.media.length;
            const before = momentsRef.current.find((item) => item.id === momentId)?.photos.length ?? 0;
            for (let attempt = 0; attempt < 8; attempt += 1) {
              const photos = await loadMomentPhotos(supabase, momentId);
              if (photos) {
                setMoments((current) =>
                  current.map((item) => (item.id === momentId ? { ...item, photos } : item)),
                );
              }
              if (photos && photos.length >= before + expected) break;
              await new Promise((resolve) => setTimeout(resolve, 1500));
            }
            settlePending([job.id]);
          })();
        }
      }
    });
  }, [supabase, loadFirstPage, scope, circles]);

  useEffect(() => {
    if (!session) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when the session drops
      setMediaHeaders(null);
      return;
    }
    let active = true;
    mediaRequestHeaders()
      .then((headers) => {
        if (active) setMediaHeaders(headers);
      })
      .catch(() => {
        if (active) setMediaHeaders(null);
      });
    return () => {
      active = false;
    };
  }, [session]);

  useEffect(() => {
    let active = true;
    mentionDismissed()
      .then((dismissed) => {
        if (active) setShowMentions(!dismissed);
      })
      .catch(() => {
        if (active) setShowMentions(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!supabase || !session?.user.id) return;
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when the session changes
    setLoading(true);
    loadCircles(supabase, session.user.id)
      .then((memberships) => {
        if (!active) return;
        setCircles(memberships);
        return loadFirstPage(allScope, memberships);
      })
      .catch(() => {
        if (!active) return;
        setError("Circles could not be loaded.");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadFirstPage, session?.user.id, supabase]);

  async function loadEarlier() {
    if (!supabase || !page?.hasMore || !page.cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const person = personRef.current;
      const kind = feedKind(scope);
      const next = await loadTimelinePage(supabase, {
        circleId: person ? person.circleId : kind === "circle" ? scope : null,
        journalPersonId: person?.personId,
        cursor: page.cursor,
        snapshotAt: page.snapshotAt,
        fallbackCircleId: person || kind !== "all" ? undefined : circles[0]?.circleId,
        viewerMembershipIds: membershipIds,
        personal:
          person || kind !== "personal"
            ? undefined
            : circles.map((circle) => ({
                circleId: circle.circleId,
                personId: circle.personId,
              })),
      });
      setMoments((current) => [...current, ...next.moments]);
      setPage(next);
    } catch {
      setError("Earlier moments could not be loaded.");
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    if (!supabase) return;
    const personId =
      circles.find((circle) => circle.circleId === scope)?.personId ??
      circles[0]?.personId;
    if (!personId) return;
    let active = true;
    loadViewerProfile(supabase, personId)
      .then((next) => {
        if (active) setProfile(next);
      })
      .catch(() => {
        if (active) setProfile(null);
      });
    return () => {
      active = false;
    };
  }, [supabase, circles, scope]);

  useEffect(() => {
    // Web parity: the header heart is on every journal screen, so its list
    // and unread dot load everywhere and refresh on navigation and on open.
    if (!supabase) return;
    let active = true;
    void loadActivity(supabase, circles)
      .then((items) => {
        if (active) setActivityItems(items);
      })
      .catch(() => {
        if (active) setActivityItems([]);
      });
    return () => {
      active = false;
    };
  }, [activityOpen, circles, circlesOpen, personJournal, scope, supabase]);

  async function refresh() {
    setRefreshing(true);
    await loadFirstPage(scope, circles);
  }

  function openEdit(state: Partial<EditReopen> & { moment: TimelineMoment }) {
    editKey.current += 1;
    setEditing({ ...state, key: editKey.current });
  }

  function patchMoment(id: string, update: (current: TimelineMoment) => TimelineMoment) {
    setMoments((current) => current.map((item) => (item.id === id ? update(item) : item)));
  }

  function applyScroll(y: number) {
    setPull(y < 0 ? Math.min(80, -y) : 0);
    if (y <= 0 || switcherOpen) {
      if (offsetRef.current !== 0) {
        offsetRef.current = 0;
        setChromeOffset(0);
      }
      yRef.current = Math.max(0, y);
      return;
    }
    const delta = y - yRef.current;
    yRef.current = y;
    const next = Math.max(0, Math.min(distance, y, offsetRef.current + delta));
    if (Math.abs(next - offsetRef.current) >= 1) {
      offsetRef.current = next;
      setChromeOffset(next);
    }
  }

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    applyScroll(event.nativeEvent.contentOffset.y);
  }

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: readonly { item: FeedRow }[] }) => {
      const ids = new Set<string>();
      for (const token of viewableItems) {
        if (token.item.kind === "moment") ids.add(token.item.id);
      }
      setVisibleMomentIds((current) => {
        if (current.size === ids.size && [...ids].every((id) => current.has(id))) {
          return current;
        }
        return ids;
      });
      setViewabilityReady(true);
    },
    [],
  );

  useEffect(() => {
    circlesRef.current = circles;
    loadFirstPageRef.current = loadFirstPage;
    loadEarlierRef.current = loadEarlier;
  });

  useEffect(() => subscribeNotificationOpens((target) => {
    landingPages.current = 0;
    setSettingsOpen(false);
    setSwitcherOpen(false);
    setLanding(target);
    setScope(allScope);
    setLoading(true);
    void loadFirstPageRef.current?.(allScope, circlesRef.current);
  }), []);

  useEffect(() => {
    if (!landing || loading || scope !== allScope || loadingMore) return;
    const listedNow = moments.filter((moment) =>
      momentListedInFeed({ audience: moment.audience, feed: "all" }),
    );
    const built = buildRows(listedNow, today, Boolean(page?.hasMore));
    const index = built.findIndex(
      (row) => row.kind === "moment" && row.moment.id === landing.momentId,
    );
    if (index >= 0) {
      listRef.current?.scrollToIndex({ index, viewPosition: 0 });
      return;
    }
    if (!page?.hasMore || landingPages.current >= 4) return;
    landingPages.current += 1;
    void loadEarlierRef.current();
  }, [landing, loading, loadingMore, moments, page?.hasMore, scope, today]);

  if (ready && !session) return <Redirect href="/sign-in" />;

  const kind = feedKind(scope);
  const selectedCircle = circles.find((circle) => circle.circleId === scope);
  const viewingOwnJournal = Boolean(
    personJournal &&
      circles.some(
        (circle) =>
          circle.circleId === personJournal.circleId && circle.personId === personJournal.personId,
      ),
  );
  const title = settingsOpen
    ? "Settings"
    : circlesOpen
      ? "Circles"
      : personJournal
        ? personJournal.name
        : kind === "personal"
          ? "Just me"
          : kind === "circle"
            ? (selectedCircle?.name ?? "Circle")
            : "All circles";
  // family-title-switcher.tsx only renders kind "you" and "all", in that
  // order, even when the account belongs to more circles. Just me loads the
  // personal journal; All circles loads the combined feed.
  const items: readonly SwitcherItem[] = [
    { id: allScope, label: "All circles", selected: kind === "all" },
    ...circles
      .filter((circle) => !circle.archivedAt)
      .map((circle) => ({
        id: circle.circleId,
        label: circle.name,
        selected: kind === "circle" && scope === circle.circleId,
      })),
    { id: youScope, label: "Just me", selected: kind === "personal" },
  ];
  const feedMoments = mergePending(moments, pendingJobs, {
    listed: (post) =>
      personJournal
        ? post.journalPersonId === personJournal.personId
        : kind !== "circle" || post.circleId === scope || post.circleIds.includes(scope),
    author: {
      name: profile?.name ?? "You",
      initial: profile?.initial ?? "Y",
      accent: profileAccent(profile?.accentToken),
    },
  });
  const listed = feedMoments.filter(
    (moment) =>
      !authorHidden(moment.authorMembershipId, hiddenAuthors) &&
      momentListedInFeed({
        audience: moment.audience,
        feed: personJournal ? (viewingOwnJournal ? "personal" : "circle") : kind,
      }),
  );
  const rows = buildRows(listed, today, Boolean(page?.hasMore));
  const chromeHidden = chromeOffset >= distance && !switcherOpen;

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.gridSurface },
        Platform.OS === "web" ? styles.screenWeb : null,
      ]}
    >
      <GridBackground color={colors.gridLine} />
      {pull > 8 || refreshing ? (
        <View
          pointerEvents="none"
          style={[
            styles.pull,
            {
              top: insets.top + stageChromeInset,
              opacity: pull > 64 ? 0.8 : 0.45,
              transform: [{ scale: pull > 64 ? 1 : 0.72 }],
            },
          ]}
        >
          <View style={[styles.pullMark, { backgroundColor: colors.action }]} />
        </View>
      ) : null}
      {settingsOpen ? (
        <SettingsScreen
          profile={profile}
          circles={circles}
          viewedCircleId={kind === "circle" ? scope : null}
          onUnblocked={(membershipId) => {
            setHiddenAuthors((current) => current.filter((id) => id !== membershipId));
            void loadFirstPage(scope, circles);
          }}
          onScroll={applyScroll}
          onSaveColor={async (color) => {
            if (!supabase) return { ok: false, message: "Your color couldn’t be saved. Try again." };
            const result = await saveProfileColor(supabase, color);
            if (result.ok) {
              setProfile((current) => (current ? { ...current, accentToken: color } : current));
            }
            return result;
          }}
          onSignOut={() => {
            setSettingsOpen(false);
            // Remove this iPhone's token while the session can still do it, but never hold up sign-out.
            void Promise.race([
              disablePushNotifications(false),
              new Promise((resolve) => setTimeout(resolve, 3000)),
            ]).finally(() => signOut());
          }}
        />
      ) : circlesOpen ? (
        <CirclesScreen
          circles={circles}
          accentToken={profile?.accentToken}
          // The web keeps the Circles nav pinned and lets the header scroll
          // away with the page. The header moves 1:1 with the directory, so a
          // short directory never leaves it stuck half off screen.
          onScroll={(y) => {
            const next = Math.round(Math.max(0, Math.min(distance, y)));
            setCirclesHeaderOffset((current) => (current === next ? current : next));
          }}
          onOpenPerson={(circleId, personId, name) => {
            const next = { circleId, personId, name };
            personRef.current = next;
            setPersonJournal(next);
            setCirclesOpen(false);
            setSettingsOpen(false);
            offsetRef.current = 0;
            setChromeOffset(0);
            setLoading(true);
            void loadFirstPage(circleId, circles);
          }}
          onOpenJournal={(circleId) => {
            personRef.current = null;
            setPersonJournal(null);
            setCirclesOpen(false);
            setScope(circleId);
            offsetRef.current = 0;
            setChromeOffset(0);
            setLoading(true);
            void loadFirstPage(circleId, circles);
          }}
          onCirclesChanged={async () => {
            if (!supabase || !session?.user.id) return;
            const memberships = await loadCircles(supabase, session.user.id);
            setCircles(memberships);
          }}
        />
      ) : (
        <FeedScrollLock.Provider value={lockFeedScroll}>
        <FlatList
          // Sheets opened from a card (comments, edit) render inside this list,
          // so a tap there must not just dismiss the keyboard.
          keyboardShouldPersistTaps="handled"
          ref={listRef}
          style={styles.list}
          data={rows}
          keyExtractor={(row) => row.id}
          onScrollToIndexFailed={(info) => {
            listRef.current?.scrollToOffset({
              offset: info.averageItemLength * info.index,
              animated: false,
            });
          }}
          accessibilityState={{ busy: loading }}
          onScroll={onScroll}
          scrollEventThrottle={16}
          viewabilityConfig={momentViewability}
          onViewableItemsChanged={onViewableItemsChanged}
          onScrollEndDrag={() => {
            if (pull >= 64) void refresh();
          }}
          contentContainerStyle={{
            paddingTop: insets.top + stageChromeInset,
            paddingBottom: insets.bottom + stageChromeInset + timelineBottomPad,
            paddingHorizontal: timelineInset,
            flexGrow: rows.length === 0 ? 1 : undefined,
          }}
          ListHeaderComponent={
            <>
            {personJournal && !circlesOpen && !settingsOpen ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Circles"
                onPress={() => {
                  setSettingsOpen(false);
                  setSwitcherOpen(false);
                  setAddOpen(false);
                  setCirclesOpen(true);
                  offsetRef.current = 0;
                  setChromeOffset(0);
                  setCirclesHeaderOffset(0);
                }}
                style={styles.backToCircles}
              >
                <Text style={[face(colors, 400, "record"), { color: colors.muted, fontSize: 12 }]}>
                  ‹ Circles
                </Text>
              </Pressable>
            ) : null}
            {!loading && showMentions && !error ? (
              <MentionsBanner
                onDismiss={() => {
                  setShowMentions(false);
                  void writePref(mentionsStoreKey, "dismissed");
                }}
              />
            ) : null}
            </>
          }
          ListEmptyComponent={
            loading ? null : error ? (
              <View
                style={[
                  styles.empty,
                  { borderColor: colors.hairline, backgroundColor: colors.paper },
                ]}
              >
                <Text style={[styles.emptyTitle, face(colors, 600, "serif"), { color: colors.ink }]}>
                  This journal couldn’t open.
                </Text>
                <Text style={[styles.emptyBody, face(colors, 400), { color: colors.muted }]}>
                  Try again, or choose another page.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setLoading(true);
                    void loadFirstPage(scope, circles);
                  }}
                  style={[styles.retry, { backgroundColor: colors.ink }]}
                >
                  <Text style={[face(colors, 600), { color: colors.cream, fontSize: 14 }]}>
                    Try again
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View
                style={[
                  styles.empty,
                  { borderColor: colors.hairline, backgroundColor: colors.paper },
                ]}
              >
                <Text style={[styles.emptyTitle, face(colors, 500, "serif"), { color: colors.ink }]}>
                  Your circle’s story starts here
                </Text>
                <Text style={[styles.emptyBody, face(colors, 400), { color: colors.muted }]}>
                  Write a small moment and it will find its place on this line.
                </Text>
              </View>
            )
          }
          renderItem={({ item }) => (
            <Rail>
              {item.kind === "date" ? (
                <View style={[styles.date, item.divider && styles.dateDivider]}>
                  <Text
                    style={[
                      styles.dateLabel,
                      face(colors, 600, "record"),
                      {
                        color: colors.dateInk,
                        backgroundColor: colors.paper,
                        borderColor: colors.line,
                        letterSpacing: tracking(8, 0.15),
                      },
                    ]}
                  >
                    {item.label}
                  </Text>
                </View>
              ) : item.kind === "end" ? (
                <View style={styles.date}>
                  <Text
                    style={[
                      styles.dateLabel,
                      face(colors, 600, "record"),
                      {
                        color: colors.dateInk,
                        backgroundColor: colors.paper,
                        borderColor: colors.line,
                        letterSpacing: tracking(8, 0.15),
                      },
                    ]}
                  >
                    Earliest entry
                  </Text>
                </View>
              ) : (
                <FeedMoment
                  moment={item.moment}
                  circleNames={circleNames}
                  feedCircleId={kind === "circle" ? scope : null}
                  headers={mediaHeaders}
                  viewerYear={viewerYear}
                  viewerZone={viewerZone}
                  viewer={{
                    name: profile?.name ?? "You",
                    accent: profile?.accentToken ?? "slate",
                    membershipIds: circles.map((circle) => circle.membershipId),
                  }}
                  onMomentChange={(next) =>
                    setMoments((current) => current.map((item) => (item.id === next.id ? next : item)))
                  }
                  onMomentRemove={(id) => setMoments((current) => current.filter((item) => item.id !== id))}
                  onMomentEdit={(moment) => openEdit({ moment })}
                  hiddenAuthorIds={hiddenAuthors}
                  onHideAuthor={(membershipId) => {
                    if (!membershipId) return;
                    setHiddenAuthors((current) =>
                      current.includes(membershipId) ? current : [...current, membershipId],
                    );
                    setMoments((current) => withoutBlockedAuthor(current, membershipId));
                    void loadFirstPage(scope, circles);
                  }}
                  onScreen={!viewabilityReady || visibleMomentIds.has(item.id)}
                  highlighted={highlightId === item.moment.id}
                  openThread={
                    landing?.openThread === true && landing.momentId === item.moment.id
                  }
                />
              )}
            </Rail>
          )}
          ListFooterComponent={
            page?.hasMore ? (
              <Pressable
                accessibilityRole="button"
                disabled={loadingMore}
                onPress={() => void loadEarlier()}
                style={[
                  styles.earlier,
                  { borderColor: colors.hairline, backgroundColor: colors.paper },
                ]}
              >
                <Text style={[face(colors, 600), { color: colors.ink, fontSize: 14 }]}>
                  {loadingMore ? "Loading" : "Show earlier days"}
                </Text>
              </Pressable>
            ) : null
          }
        />
        </FeedScrollLock.Provider>
      )}
      {switcherOpen ? (
        <Pressable style={styles.scrim} onPress={() => setSwitcherOpen(false)} />
      ) : null}
      <JournalHeader
        title={title}
        items={items}
        open={switcherOpen}
        onToggle={() => setSwitcherOpen((current) => !current)}
        onSelect={(id) => {
          setSwitcherOpen(false);
          if (id === scope) return;
          setScope(id);
          setLoading(true);
          void loadFirstPage(id, circles);
        }}
        onOpenAppearance={() => {
          setSwitcherOpen(false);
          offsetRef.current = 0;
          setChromeOffset(0);
          setSettingsOpen(true);
          setCirclesOpen(false);
        }}
        offset={circlesOpen && !settingsOpen ? circlesHeaderOffset : chromeOffset}
        interactive={switcherOpen}
        locked={settingsOpen || circlesOpen || Boolean(personJournal)}
        onOpenActivity={() => setActivityOpen(true)}
        activityUnread={activityItems.some((item) => !seenActivity.includes(item.id))}
      />
      {activityOpen ? (
        <ActivitySheet
          circles={circles}
          onClose={() => {
            setSeenActivity(readSeenActivityIds());
            setActivityOpen(false);
          }}
          onOpen={(href) => {
            const target = readNotificationTarget(href);
            setSeenActivity(readSeenActivityIds());
            setActivityOpen(false);
            personRef.current = null;
            setPersonJournal(null);
            setCirclesOpen(false);
            setSettingsOpen(false);
            if (!target) return;
            landingPages.current = 0;
            setLanding(target);
            setScope(allScope);
            setLoading(true);
            void loadFirstPage(allScope, circles);
          }}
        />
      ) : null}
      <JournalNav
        offset={chromeOffset}
        hidden={chromeHidden}
        journalActive={!settingsOpen && !circlesOpen && !personJournal}
        circlesActive={!settingsOpen && (circlesOpen || Boolean(personJournal))}
        onJournalPress={() => {
          const wasPerson = personRef.current;
          personRef.current = null;
          setPersonJournal(null);
          setSettingsOpen(false);
          setCirclesOpen(false);
          if (wasPerson) {
            setScope(allScope);
            setLoading(true);
            void loadFirstPage(allScope, circles);
          }
        }}
        onAddPress={() => {
          setSettingsOpen(false);
          setSwitcherOpen(false);
          setCirclesOpen(false);
          setAddOpen(true);
        }}
        onCirclesPress={() => {
          setSettingsOpen(false);
          setSwitcherOpen(false);
          setAddOpen(false);
          setCirclesOpen(true);
          offsetRef.current = 0;
          setChromeOffset(0);
          setCirclesHeaderOffset(0);
          setPull(0);
        }}
      />
      {shareDraft && session ? (
        <ShareSheet
          draft={shareDraft}
          circles={circles}
          onClose={() => dismissShareDraft()}
          onPosted={() => {
            dismissShareDraft();
            setScope(allScope);
            setLoading(true);
            void loadFirstPage(allScope, circles);
          }}
        />
      ) : null}
      {editing ? (
        <AddSheet
          key={editing.key}
          circles={circles}
          justMeDefault={false}
          edit={{
            moment: editing.moment,
            headers: mediaHeaders,
            draft: editing.draft,
            error: editing.error,
            onSave: (initial, draft, taggedLabel) => {
              const moment = editing.moment;
              if (!supabase) return;
              const client = supabase;
              setEditing(null);
              void runMomentEdit(client, {
                moment,
                initial,
                draft,
                taggedLabel,
                deviceTimeZone: viewerZone,
                patch: patchMoment,
                reopen: openEdit,
                refresh: () => void loadFirstPage(scope, circles),
                announce: (message) => AccessibilityInfo.announceForAccessibility(message),
                loadPhotos: (id) => loadMomentPhotos(client, id),
              });
            },
          }}
          onClose={() => setEditing(null)}
          onPosted={() => setEditing(null)}
        />
      ) : null}
      {addOpen ? (
        <AddSheet
          circles={circles}
          justMeDefault={kind === "personal"}
          activeCircleId={
            kind === "circle"
              ? scope
              : kind === "personal"
                ? homeCircleId
                : Platform.OS === "web"
                  ? homeCircleId
                  : (lastPostedCircleId ?? circles[0]?.circleId ?? null)
          }
          onClose={() => setAddOpen(false)}
          onPosted={(audience: Audience, postedCircleId: string) => {
            if (Platform.OS !== "web" && audience === "family") {
              setLastPostedCircleId(postedCircleId);
            }
            const next = audience === "just_me" ? youScope : allScope;
            setAddOpen(false);
            setScope(next);
            setLoading(true);
            // A photo post is already on the feed as a pending card; show it.
            void loadFirstPage(next, circles).then(() =>
              requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: true })),
            );
          }}
        />
      ) : null}
    </View>
  );
}

async function mentionDismissed() {
  if (Platform.OS === "web") {
    return globalThis.localStorage?.getItem(mentionsKey) === "dismissed";
  }
  const value = await SecureStore.getItemAsync(mentionsStoreKey);
  return value === "dismissed";
}

function Rail({ children }: Readonly<{ children: ReactNode }>) {
  const { colors } = useAppTheme();
  return (
    <View>
      <View
        pointerEvents="none"
        style={[styles.rail, { backgroundColor: colors.line }]}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  screenWeb: {
    height: "100%",
    maxHeight: "100%",
    overflow: "hidden",
  },
  list: {
    flex: 1,
  },
  pull: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 22,
    alignItems: "center",
    zIndex: 5,
  },
  pullMark: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },
  rail: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: "50%",
    width: 1,
  },
  date: {
    height: 42,
    alignItems: "center",
    justifyContent: "flex-start",
    zIndex: 2,
  },
  dateDivider: {
    height: 58,
    justifyContent: "center",
  },
  dateLabel: {
    overflow: "hidden",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderWidth: 1,
    borderRadius: 5,
    fontSize: 8,
    textTransform: "uppercase",
  },
  empty: {
    width: "88%",
    alignSelf: "center",
    marginTop: 22,
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderWidth: 1,
    borderRadius: 18,
    alignItems: "center",
    gap: 6,
  },
  emptyTitle: {
    fontSize: 19,
    textAlign: "center",
  },
  emptyBody: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  retry: {
    minWidth: 110,
    minHeight: 44,
    marginTop: 12,
    paddingHorizontal: 18,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  earlier: {
    alignSelf: "center",
    minHeight: 44,
    marginTop: 8,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    zIndex: 15,
  },
  backToCircles: {
    alignSelf: "flex-start",
    minHeight: 32,
    marginBottom: 8,
    justifyContent: "center",
  },
});
