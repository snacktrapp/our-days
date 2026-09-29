import { Redirect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MomentCard } from "../components/moment-card";
import { useAuth } from "../components/auth-provider";
import {
  loadCircles,
  loadTimelinePage,
  postThought,
  validThought,
  type CircleMembership,
  type TimelineMoment,
  type TimelinePage,
} from "../lib/journal";
import { getSupabase, mediaRequestHeaders } from "../lib/supabase";
import { colors, record } from "../lib/theme";

const allCircles = "all";

export default function JournalScreen() {
  const { ready, session, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const supabase = useMemo(() => getSupabase(), []);
  const [circles, setCircles] = useState<readonly CircleMembership[]>([]);
  const [selected, setSelected] = useState<string>(allCircles);
  const [moments, setMoments] = useState<readonly TimelineMoment[]>([]);
  const [page, setPage] = useState<TimelinePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [postCircleId, setPostCircleId] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [postMessage, setPostMessage] = useState<string | null>(null);
  const [mediaHeaders, setMediaHeaders] = useState<
    Record<string, string> | null | undefined
  >(undefined);

  const circleById = useMemo(
    () => new Map(circles.map((circle) => [circle.circleId, circle])),
    [circles],
  );
  const activeCircle =
    selected === allCircles ? null : circleById.get(selected);
  const destination =
    circleById.get(
      selected === allCircles ? (postCircleId ?? circles[0]?.circleId ?? "") : selected,
    ) ?? null;

  const loadFirstPage = useCallback(
    async (circleId: string, memberships: readonly CircleMembership[]) => {
      if (!supabase) return;
      setLoading(true);
      setError(null);
      try {
        const next = await loadTimelinePage(supabase, {
          circleId: circleId === allCircles ? null : circleId,
          fallbackCircleId: memberships[0]?.circleId,
        });
        if (next.fellBackToCircleId) setSelected(next.fellBackToCircleId);
        setMoments(next.moments);
        setPage(next);
      } catch {
        setMoments([]);
        setPage(null);
        setError("The timeline could not be loaded.");
      } finally {
        setLoading(false);
      }
    },
    [supabase],
  );

  useEffect(() => {
    if (!session) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on session change
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
    if (!supabase || !session?.user.id) return;
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on session change
    setLoading(true);
    loadCircles(supabase, session.user.id)
      .then((memberships) => {
        if (!active) return;
        setCircles(memberships);
        setPostCircleId(memberships[0]?.circleId ?? null);
        return loadFirstPage(allCircles, memberships);
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
      const next = await loadTimelinePage(supabase, {
        circleId: selected === allCircles ? null : selected,
        cursor: page.cursor,
        snapshotAt: page.snapshotAt,
        fallbackCircleId: circles[0]?.circleId,
      });
      setMoments((current) => [...current, ...next.moments]);
      setPage(next);
    } catch {
      setError("Earlier moments could not be loaded.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function onPost() {
    if (!supabase || !destination || !validThought(draft)) {
      setPostMessage("Check the moment and try again.");
      return;
    }
    setPosting(true);
    setPostMessage(null);
    try {
      await postThought(supabase, {
        circleId: destination.circleId,
        journalPersonId: destination.personId,
        body: draft,
        timeZone: destination.timeZone,
      });
      setDraft("");
      setPostMessage("Moment saved.");
      await loadFirstPage(
        selected === allCircles ? allCircles : destination.circleId,
        circles,
      );
    } catch {
      setPostMessage(
        "That moment could not be saved. Your draft is still here.",
      );
    } finally {
      setPosting(false);
    }
  }

  if (ready && !session) return <Redirect href="/sign-in" />;

  const title = activeCircle?.name ?? "All circles";

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { paddingTop: insets.top }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>Circles</Text>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          <Text style={styles.count}>
            {moments.length} {moments.length === 1 ? "moment" : "moments"}
          </Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => void signOut()}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>
      <View style={styles.switcher}>
        <Chip
          label="All circles"
          selected={selected === allCircles}
          disabled={loading}
          onPress={() => {
            setSelected(allCircles);
            void loadFirstPage(allCircles, circles);
          }}
        />
        {circles.map((circle) => (
          <Chip
            key={circle.circleId}
            label={circle.name}
            selected={selected === circle.circleId}
            disabled={loading}
            onPress={() => {
              setSelected(circle.circleId);
              void loadFirstPage(circle.circleId, circles);
            }}
          />
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading ? (
        <View style={styles.waiting}>
          <ActivityIndicator color={colors.action} />
        </View>
      ) : (
        <FlatList
          data={moments}
          keyExtractor={(moment) => moment.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            error ? null : (
              <Text style={styles.empty}>
                Your circle’s story starts here. Write a small moment and it
                will find its place on this line.
              </Text>
            )
          }
          renderItem={({ item }) => (
            <MomentCard
              moment={item}
              showCircle={selected === allCircles}
              circleName={
                circleById.get(item.circleId)?.name ??
                circleById.get(item.linkedCircleIds[0] ?? "")?.name
              }
              headers={mediaHeaders}
            />
          )}
          ListFooterComponent={
            page?.hasMore ? (
              <Pressable
                accessibilityRole="button"
                disabled={loadingMore}
                onPress={() => void loadEarlier()}
                style={styles.earlier}
              >
                <Text style={styles.earlierLabel}>
                  {loadingMore ? "Loading" : "Earlier moments"}
                </Text>
              </Pressable>
            ) : moments.length > 0 ? (
              <Text style={styles.end}>The beginning</Text>
            ) : null
          }
        />
      )}
      <View style={[styles.composer, { paddingBottom: insets.bottom + 12 }]}>
        {selected === allCircles && circles.length > 1 ? (
          <View style={styles.postTo}>
            <Text style={styles.postToLabel}>Post to</Text>
            {circles.map((circle) => (
              <Chip
                key={`post-${circle.circleId}`}
                label={circle.name}
                selected={destination?.circleId === circle.circleId}
                onPress={() => setPostCircleId(circle.circleId)}
              />
            ))}
          </View>
        ) : null}
        <TextInput
          value={draft}
          onChangeText={setDraft}
          multiline
          placeholder="A thought"
          placeholderTextColor={colors.muted}
          accessibilityLabel="Thought"
          style={styles.draft}
          editable={!posting}
        />
        {postMessage ? <Text style={styles.postMessage}>{postMessage}</Text> : null}
        <Pressable
          accessibilityRole="button"
          disabled={posting || !validThought(draft)}
          onPress={() => void onPost()}
          style={[
            styles.post,
            (posting || !validThought(draft)) && styles.postDisabled,
          ]}
        >
          <Text style={styles.postLabel}>{posting ? "Saving" : "Post"}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Chip({
  label,
  selected,
  disabled,
  onPress,
}: Readonly<{
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  eyebrow: {
    ...record,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  title: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: "600",
  },
  count: {
    ...record,
    fontSize: 12,
  },
  signOut: {
    color: colors.action,
    fontSize: 14,
    paddingTop: 4,
  },
  switcher: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipSelected: {
    borderColor: colors.action,
    backgroundColor: colors.surface,
  },
  chipLabel: {
    ...record,
    fontSize: 12,
    color: colors.muted,
  },
  chipLabelSelected: {
    color: colors.ink,
  },
  error: {
    ...record,
    paddingHorizontal: 20,
    paddingBottom: 8,
    color: colors.muted,
    fontSize: 13,
  },
  waiting: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  empty: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 23,
    paddingVertical: 24,
  },
  earlier: {
    alignItems: "center",
    paddingVertical: 16,
  },
  earlierLabel: {
    ...record,
    fontSize: 12,
  },
  end: {
    ...record,
    paddingVertical: 18,
    fontSize: 12,
    textAlign: "center",
  },
  composer: {
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    backgroundColor: colors.cream,
  },
  postTo: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  postToLabel: {
    ...record,
    fontSize: 11,
  },
  draft: {
    minHeight: 44,
    maxHeight: 120,
    color: colors.ink,
    fontSize: 16,
    lineHeight: 22,
  },
  postMessage: {
    ...record,
    fontSize: 12,
  },
  post: {
    alignSelf: "flex-end",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.action,
  },
  postDisabled: {
    opacity: 0.45,
  },
  postLabel: {
    color: colors.actionInk,
    fontSize: 14,
    fontWeight: "600",
  },
});
