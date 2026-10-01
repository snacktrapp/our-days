import * as SecureStore from "expo-secure-store";
import { Redirect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
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
import { MentionsBanner } from "../components/journal-banner";
import { FeedMoment } from "../components/moment-card";
import { AddSheet } from "../components/add-sheet";
import { UploadShelf } from "../components/upload-shelf";
import { writePref } from "../lib/appearance";
import { listUploads, subscribeUploads, type Audience, type UploadChip } from "../lib/posts";
import { siteOrigin } from "../lib/config";
import { circleToday } from "../lib/dates";
import { readLastPostedCircle } from "../lib/last-posted-circle";
import {
  loadCircles,
  loadTimelinePage,
  loadViewerProfile,
  saveProfileColor,
  type CircleMembership,
  type TimelineMoment,
  type TimelinePage,
  type ViewerProfile,
} from "../lib/journal";
import { momentListedInFeed } from "../lib/feed-format";
import { formatPlainDate } from "../lib/moment-time";
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
  const homeCircleId = readActiveCircleCookie();
  const [lastPostedCircleId, setLastPostedCircleId] = useState<string | null>(null);
  const [uploads, setUploads] = useState<readonly UploadChip[]>(listUploads());
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profile, setProfile] = useState<ViewerProfile | null>(null);
  const [chromeOffset, setChromeOffset] = useState(0);
  const [pull, setPull] = useState(0);
  const [showMentions, setShowMentions] = useState(false);
  const [unseenActivity, setUnseenActivity] = useState(false);
  const [viewabilityReady, setViewabilityReady] = useState(false);
  const [visibleMomentIds, setVisibleMomentIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const yRef = useRef(0);
  const offsetRef = useRef(0);
  const publishedUploads = useRef(new Set<string>());

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
        const kind = feedKind(nextScope);
        const next = await loadTimelinePage(supabase, {
          circleId: kind === "circle" ? nextScope : null,
          fallbackCircleId: kind === "all" ? memberships[0]?.circleId : undefined,
          viewerMembershipIds: memberships.map((circle) => circle.membershipId),
          personal:
            kind === "personal"
              ? memberships.map((circle) => ({
                  circleId: circle.circleId,
                  personId: circle.personId,
                }))
              : undefined,
        });
        setMoments(next.moments);
        setPage(next);
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

  useEffect(() => {
    if (!session?.user.id || Platform.OS === "web") return;
    void readLastPostedCircle(session.user.id).then(setLastPostedCircleId);
  }, [session?.user.id]);

  useEffect(
    () =>
      subscribeUploads(() => {
        const next = listUploads();
        setUploads(next);
        const fresh = next.some((chip) => chip.done && !publishedUploads.current.has(chip.id));
        for (const chip of next) {
          if (chip.done) publishedUploads.current.add(chip.id);
        }
        if (fresh) void loadFirstPage(scope, circles);
      }),
    [circles, loadFirstPage, scope],
  );

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
    if (!mediaHeaders) return;
    let active = true;
    fetch(`${siteOrigin}/api/activity`, { headers: mediaHeaders, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { items?: { id?: string }[] };
        const ids = (body.items ?? []).flatMap((item) =>
          typeof item.id === "string" ? [item.id] : [],
        );
        const seen = await readSeenNotifications();
        if (active) setUnseenActivity(ids.some((id) => !seen.has(id)));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [mediaHeaders]);

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
      const kind = feedKind(scope);
      const next = await loadTimelinePage(supabase, {
        circleId: kind === "circle" ? scope : null,
        cursor: page.cursor,
        snapshotAt: page.snapshotAt,
        fallbackCircleId: kind === "all" ? circles[0]?.circleId : undefined,
        viewerMembershipIds: membershipIds,
        personal:
          kind === "personal"
            ? circles.map((circle) => ({
                circleId: circle.circleId,
                personId: circle.personId,
              }))
            : undefined,
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

  async function refresh() {
    setRefreshing(true);
    await loadFirstPage(scope, circles);
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

  if (ready && !session) return <Redirect href="/sign-in" />;

  const kind = feedKind(scope);
  const selectedCircle = circles.find((circle) => circle.circleId === scope);
  const title = settingsOpen
    ? "Settings"
    : kind === "personal"
      ? "Just me"
      : kind === "circle"
        ? (selectedCircle?.name ?? "Circle")
        : "All circles";
  // family-title-switcher.tsx only renders kind "you" and "all", in that
  // order, even when the account belongs to more circles. Just me loads the
  // personal journal; All circles loads the combined feed.
  const items: readonly SwitcherItem[] = [
    { id: youScope, label: "Just me", selected: kind === "personal" },
    { id: allScope, label: "All circles", selected: kind === "all" },
  ];
  const listed = moments.filter((moment) =>
    momentListedInFeed({ audience: moment.audience, feed: kind }),
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
            void signOut();
          }}
        />
      ) : (
        <FlatList
          style={styles.list}
          data={rows}
          keyExtractor={(row) => row.id}
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
            !loading && showMentions && !error ? (
              <MentionsBanner
                onDismiss={() => {
                  setShowMentions(false);
                  void writePref(mentionsKey, "dismissed");
                }}
              />
            ) : null
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
                  onScreen={!viewabilityReady || visibleMomentIds.has(item.id)}
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
        }}
        offset={chromeOffset}
        interactive={switcherOpen}
        locked={settingsOpen}
        unseen={unseenActivity}
      />
      <JournalNav
        offset={chromeOffset}
        hidden={chromeHidden}
        journalActive={!settingsOpen}
        onJournalPress={() => setSettingsOpen(false)}
        onAddPress={() => {
          setSettingsOpen(false);
          setSwitcherOpen(false);
          setAddOpen(true);
        }}
      />
      {uploads.length > 0 ? (
        <UploadShelf chips={uploads} top={insets.top + floatGap + chromeHeight + 8} />
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
            void loadFirstPage(next, circles);
          }}
        />
      ) : null}
    </View>
  );
}

const seenNotificationsKey = "our-days:seen-notifications";

async function readSeenNotifications() {
  const raw =
    Platform.OS === "web"
      ? (globalThis.localStorage?.getItem(seenNotificationsKey) ?? null)
      : await SecureStore.getItemAsync(seenNotificationsKey);
  try {
    const parsed = JSON.parse(raw ?? "[]") as unknown;
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === "string")
        : [],
    );
  } catch {
    return new Set<string>();
  }
}

async function mentionDismissed() {
  if (Platform.OS === "web") {
    return globalThis.localStorage?.getItem(mentionsKey) === "dismissed";
  }
  const value = await SecureStore.getItemAsync(mentionsKey);
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
});
