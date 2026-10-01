import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { BlurView } from "expo-blur";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  emptyBibleVerseSelection,
  formatBibleVerseMoment,
  formatBibleVerseReference,
  loadBibleCatalog,
  selectBiblePassage,
  type BibleVerseSelection,
} from "../lib/bible";
import { composerSheetHeight } from "../lib/composer-keyboard";
import { circleToday } from "../lib/dates";
import { initialAudienceCircleId, postableCircles, type CircleMembership } from "../lib/journal";
import { rememberPostedCircle } from "../lib/last-posted-circle";
import {
  maximumMomentPhotos,
  pickJournalMediaList,
  releasePreview,
  type MediaSource,
  type PickedMedia,
} from "../lib/pick-media";
import { emptyPlace, type PlaceSelection } from "../lib/places";
import {
  createFamilyMoment,
  createInsightMoment,
  deleteEntryDraft,
  listEntryDrafts,
  loadEntryDraft,
  saveEntryDraft,
  attachExtraPhotos,
  uploadPhotoMoment,
  uploadVideoMoment,
  type Audience,
  type DraftListItem,
} from "../lib/posts";
import { loadRosters, type CirclePerson } from "../lib/roster";
import { getSupabase } from "../lib/supabase";
import { loneYoutubeClip, youtubeInsightAttribution } from "../lib/youtube-insight";
import { sheetHasUnsavedChanges, type SheetDraft } from "../lib/sheet-dismiss";
import { useAppTheme } from "../lib/theme";
import { face, tracking } from "../lib/tokens";
import {
  AudienceChips,
  currentPickerTimeValue,
  DateTimeFields,
  occurredInstant,
  PeopleFields,
  PlaceFields,
} from "./composer-fields";
import {
  ComposerScroller,
  DismissKeyboardPressable,
  KeyboardForm,
  useComposerInput,
} from "./keyboard-form";
import { PassageSheet } from "./bible-picker-sheet";
import { MediaChooser } from "./media-chooser";
import { MediaStill } from "./media-preview";
import { useSheetDrag } from "./sheet-drag";

type Mode = "photo" | "thought" | "bible" | "insight" | "drafts" | null;

const choices = [
  { id: "photo" as const, title: "Photo or video", icon: "camera" as const },
  { id: "thought" as const, title: "Written entry", icon: "pencil" as const },
  { id: "bible" as const, title: "Bible verse", icon: "book" as const },
  { id: "insight" as const, title: "Insight", icon: "chatbox-ellipses" as const },
];

/**
 * Web New moment order is Photo or video, Written entry, Bible verse, Drafts.
 * Insight is an extra tile: the web creates it with create_insight_moment,
 * which is not one of those four choices.
 */
export function AddSheet({
  circles,
  justMeDefault,
  activeCircleId,
  onClose,
  onPosted,
  initialMode = null,
  previewPeople,
}: Readonly<{
  circles: readonly CircleMembership[];
  justMeDefault: boolean;
  /** The circle feed that is open. All circles leaves this empty. */
  activeCircleId?: string | null;
  onClose: () => void;
  onPosted: (audience: Audience, circleId: string) => void;
  initialMode?: Mode;
  previewPeople?: Readonly<Record<string, readonly CirclePerson[]>>;
}>) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { colors } = useAppTheme();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const audienceCircles = useMemo(() => postableCircles(circles), [circles]);
  const [occurredOn, setOccurredOn] = useState(() =>
    circleToday(
      circles.find((item) => item.circleId === initialAudienceCircleId(circles, activeCircleId))
        ?.timeZone ??
        circles[0]?.timeZone ??
        "UTC",
    ),
  );
  const [occurredTime, setOccurredTime] = useState(
    initialMode === "bible" ? "" : currentPickerTimeValue(),
  );
  const [place, setPlace] = useState<PlaceSelection>(emptyPlace);
  const [taggedIds, setTaggedIds] = useState<readonly string[]>([]);
  const [roster, setRoster] = useState<ReadonlyMap<string, readonly CirclePerson[]>>(
    () => new Map(Object.entries(previewPeople ?? {})),
  );
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(
    () =>
      new Map(
        Object.entries(previewPeople ?? {}).map(([id, people]) => [id, people.length]),
      ),
  );
  const [justMe, setJustMe] = useState(justMeDefault);
  const [circleId, setCircleId] = useState(() =>
    initialAudienceCircleId(circles, activeCircleId),
  );
  const [verse, setVerse] = useState<BibleVerseSelection>(emptyBibleVerseSelection);
  const [reference, setReference] = useState("");
  const [passageOpen, setPassageOpen] = useState(false);
  const [mediaItems, setMediaItems] = useState<readonly PickedMedia[]>([]);
  const [draftId, setDraftId] = useState<string | undefined>(undefined);
  const [draftSession, setDraftSession] = useState(false);
  const [drafts, setDrafts] = useState<readonly DraftListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const radius = colors.appearance === "retro" ? 2 : 14;
  const audienceId = audienceCircles.some((item) => item.circleId === circleId)
    ? circleId
    : initialAudienceCircleId(circles, activeCircleId);
  const circle = audienceCircles.find((item) => item.circleId === audienceId);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    void listEntryDrafts(supabase).then(setDrafts);
  }, [mode]);

  useEffect(() => {
    if (previewPeople) return;
    const supabase = getSupabase();
    if (!supabase || circles.length === 0) return;
    void loadRosters(
      supabase,
      circles.map((item) => item.circleId),
    ).then((loaded) => {
      setRoster(new Map([...loaded].map(([id, value]) => [id, value.people])));
      setCounts(new Map([...loaded].map(([id, value]) => [id, value.memberCount])));
    });
  }, [circles, previewPeople]);

  useEffect(() => {
    if (mode !== "bible") return;
    void loadBibleCatalog();
  }, [mode]);

  function audience(): Audience {
    return justMe ? "just_me" : "family";
  }

  function requireCircle() {
    const supabase = getSupabase();
    if (!supabase || !circle) {
      setError("Sign in before saving.");
      return null;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(occurredOn)) {
      setError("Check the date and try again.");
      return null;
    }
    return supabase;
  }

  function when() {
    const instant = occurredInstant(occurredOn, occurredTime);
    if (!instant) {
      setError("Check the time and try again.");
      return null;
    }
    return instant;
  }

  async function postNote(nextBody: string) {
    const supabase = requireCircle();
    const instant = when();
    if (!supabase || !circle || !instant) return;
    if (!nextBody.trim()) {
      setError("Write the entry before posting.");
      return;
    }
    const youtube = loneYoutubeClip(nextBody);
    if (youtube) {
      setBusy(true);
      setError(null);
      const insight = await createInsightMoment(supabase, {
        circleId: circle.circleId,
        quote: "A clip worth keeping.",
        attribution: "YouTube",
        sourceUrl: youtube,
        occurredOn,
        occurredAt: instant.occurredAt,
        occurredTimezone: instant.occurredTimezone ?? circle.timeZone,
        audience: audience(),
        circleIds: justMe ? [] : [circle.circleId],
      });
      setBusy(false);
      if (!insight.ok) {
        setError(insight.message);
        return;
      }
      if (draftId) void deleteEntryDraft(supabase, draftId, draftSession);
      await rememberCircle();
      onPosted(audience(), circle.circleId);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await createFamilyMoment(supabase, {
      journalPersonId: circle.personId,
      circleId: circle.circleId,
      body: nextBody,
      placeName: place.label,
      latitude: place.latitude,
      longitude: place.longitude,
      taggedPersonIds: taggedIds,
      occurredOn,
      occurredAt: instant.occurredAt,
      occurredTimezone: instant.occurredTimezone ?? circle.timeZone,
      audience: audience(),
      circleIds: justMe ? [] : [circle.circleId],
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (draftId) void deleteEntryDraft(supabase, draftId, draftSession);
    await rememberCircle();
    onPosted(audience(), circle.circleId);
  }

  async function postInsight() {
    const supabase = requireCircle();
    const instant = when();
    if (!supabase || !circle || !instant) return;
    const attribution = youtubeInsightAttribution(title, sourceUrl);
    if (!body.trim() || !attribution) {
      setError("Check the Insight and try again.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await createInsightMoment(supabase, {
      circleId: circle.circleId,
      quote: body,
      attribution,
      sourceUrl,
      occurredOn,
      occurredAt: instant.occurredAt,
      occurredTimezone: instant.occurredTimezone ?? circle.timeZone,
      audience: audience(),
      circleIds: justMe ? [] : [circle.circleId],
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (draftId) void deleteEntryDraft(supabase, draftId, draftSession);
    await rememberCircle();
    onPosted(audience(), circle.circleId);
  }

  async function postPhoto() {
    const supabase = requireCircle();
    const instant = when();
    if (!supabase || !circle || !instant) return;
    const first = mediaItems[0];
    if (!first) {
      setError("Choose a photo first.");
      return;
    }
    setBusy(true);
    setError(null);
    const shared = {
      bytes: first.bytes,
      mimeType: first.mimeType,
      circleId: circle.circleId,
      journalPersonId: circle.personId,
      body: body.trim(),
      occurredOn,
      occurredAt: instant.occurredAt,
      occurredTimezone: instant.occurredTimezone ?? circle.timeZone,
      placeName: place.label,
      taggedPersonIds: taggedIds,
      audience: audience(),
      circleIds: justMe ? [] : [circle.circleId],
    };
    const result =
      first.kind === "video"
        ? await uploadVideoMoment(supabase, {
            ...shared,
            name: first.name || "video.mp4",
            durationMs: first.durationMs ?? 0,
            poster: first.poster,
          })
        : await uploadPhotoMoment(supabase, shared);
    if (result.ok && first.kind === "photo" && mediaItems.length > 1) {
      const extra = await attachExtraPhotos(
        supabase,
        result.momentId,
        mediaItems.slice(1).map((item) => ({ bytes: item.bytes, mimeType: item.mimeType })),
      );
      if (!extra.ok) {
        setBusy(false);
        setError(extra.message);
        return;
      }
    }
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (draftId) void deleteEntryDraft(supabase, draftId, draftSession);
    await rememberCircle();
    onPosted(audience(), circle.circleId);
  }

  async function rememberCircle() {
    if (justMe || !circle) return;
    const session = (await getSupabase()?.auth.getSession())?.data.session;
    if (!session?.user.id) return;
    await rememberPostedCircle(session.user.id, circle.circleId);
  }

  function replaceMedia(next: readonly PickedMedia[]) {
    setMediaItems((current) => {
      for (const item of current) releasePreview(item);
      return next;
    });
  }

  function takeMedia(source: MediaSource, intent: "replace" | "add") {
    const adding = intent === "add" && mediaItems.some((item) => item.kind === "photo");
    const limit = adding ? maximumMomentPhotos - mediaItems.length : maximumMomentPhotos;
    void pickJournalMediaList(source, {
      multiple: source !== "camera",
      limit: Math.max(1, limit),
    })
      .then((picked) => {
        if (picked.length === 0) return;
        const video = picked.find((item) => item.kind === "video");
        if (video) {
          if (adding) {
            for (const item of picked) releasePreview(item);
            setError("Choose photos or a video, not both.");
            return;
          }
          replaceMedia([video]);
        } else if (adding) {
          setMediaItems((current) => [...current, ...picked].slice(0, maximumMomentPhotos));
        } else {
          replaceMedia(picked.filter((item) => item.kind === "photo"));
        }
        setError(null);
      })
      .catch((error: unknown) => {
        setError(error instanceof Error ? error.message : "That photo could not be read.");
      });
  }

  function removeMedia(index: number) {
    setMediaItems((current) => {
      const removed = current[index];
      if (removed) releasePreview(removed);
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  }

  async function choosePassage(next: BibleVerseSelection) {
    setVerse(next);
    setPassageOpen(false);
    if (!next.book || !next.chapter || !next.startVerse || !next.endVerse) {
      setReference("");
      return;
    }
    const passage = await selectBiblePassage(
      next.book,
      next.chapter,
      next.startVerse,
      next.endVerse,
    );
    if (!passage) return;
    setReference(passage.reference);
    setBody(passage.text);
  }

  async function persistDraft(closeAfter = false) {
    const supabase = requireCircle();
    if (!supabase || !circle || !mode || mode === "drafts") return;
    setBusy(true);
    setError(null);
    const kind =
      mode === "bible" ? "bible-verse" : mode === "photo" ? "photo" : mode === "insight" ? "insight" : "thought";
    const result = await saveEntryDraft(supabase, {
      id: draftId,
      kind,
      title: mode === "bible" ? reference : title,
      body,
      sourceUrl,
      audience: audience(),
      circleIds: justMe ? [] : circle ? [circle.circleId] : [],
      journalPersonId: circle.personId,
      occurredOn,
      occurredTime,
      occurredTimezone: circle.timeZone,
      placeName: place.label,
      latitude: place.latitude,
      longitude: place.longitude,
      taggedPersonIds: taggedIds,
      verse,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDraftId(result.momentId);
    setDraftSession(kind === "insight");
    if (closeAfter) {
      onClose();
      return;
    }
    setMode("drafts");
  }

  async function openDraft(item: DraftListItem) {
    const supabase = getSupabase();
    if (!supabase) return;
    const draft = await loadEntryDraft(supabase, item.id);
    if (!draft) return;
    setDraftId(draft.id);
    setDraftSession(draft.session);
    setBody(draft.body);
    setTitle(draft.kind === "bible-verse" ? "" : draft.title);
    setReference(draft.kind === "bible-verse" ? draft.title : "");
    setSourceUrl(draft.sourceUrl);
    setJustMe(draft.audience === "just_me");
    if (draft.circleId) setCircleId(draft.circleId);
    if (draft.occurredOn) setOccurredOn(draft.occurredOn);
    setVerse(draft.verse);
    setMediaItems((current) => {
      for (const item of current) releasePreview(item);
      return [];
    });
    setMode(
      draft.kind === "bible-verse"
        ? "bible"
        : draft.kind === "photo"
          ? "photo"
          : draft.kind === "insight"
            ? "insight"
            : "thought",
    );
    baseline.current = {
      body: draft.body,
      title: draft.kind === "bible-verse" ? "" : draft.title,
      sourceUrl: draft.sourceUrl,
      place: "",
      tags: "",
      photo: false,
      verse: draft.verse.book ?? "",
      occurredOn: draft.occurredOn || occurredOn,
      occurredTime,
      justMe: draft.audience === "just_me",
      circleId: draft.circleId || audienceId,
    };
    seeded.current = true;
  }

  const titleText =
    mode === "photo"
      ? "New photo entry"
      : mode === "thought"
        ? "New written entry"
        : mode === "bible"
          ? "Add a Bible verse"
          : mode === "insight"
            ? "New insight"
            : mode === "drafts"
              ? "Drafts"
              : "New moment";
  const retro = colors.appearance === "retro";
  const labelColor = retro ? colors.muted : colors.scheme === "dark" ? "#c4cbc7" : colors.muted;
  const topGap = Math.max(20, insets.top);
  const sheetHeight = composerSheetHeight({
    windowHeight,
    topGap,
    keyboardInset: 0,
    choosing: mode == null,
  });
  const scrimColor = retro
    ? "#100d0c"
    : colors.scheme === "light"
      ? "rgba(32,39,33,0.42)"
      : "rgba(0,5,3,0.72)";
  const visiblePeople = (roster.get(circle?.circleId ?? "") ?? []).filter(
    (person) => person.id !== circle?.personId,
  );
  const scrollTop = useRef(0);
  const chromeHeight = useRef(88);
  const sheetTop = useRef(0);
  const sheetHeightRef = useRef(sheetHeight);
  const baseline = useRef<SheetDraft | null>(null);
  const seeded = useRef(false);
  const sheetNode = useRef<View>(null);
  useEffect(() => {
    sheetHeightRef.current = sheetHeight;
  }, [sheetHeight]);
  useEffect(() => {
    if (seeded.current) return;
    if (circles.length > 0 && !audienceId) return;
    baseline.current = {
      body: "",
      title: "",
      sourceUrl: "",
      place: "",
      tags: "",
      photo: false,
      verse: "",
      occurredOn,
      occurredTime,
      justMe,
      circleId: audienceId,
    };
    seeded.current = true;
  }, [audienceId, circles.length, justMe, occurredOn, occurredTime]);
  const unsaved = () => {
    const initial = baseline.current;
    if (!initial) return false;
    return sheetHasUnsavedChanges(
      {
        body,
        title,
        sourceUrl,
        place: place.label,
        tags: taggedIds.join(","),
        photo: mediaItems.length > 0,
        verse: verse.book ?? "",
        occurredOn,
        occurredTime,
        justMe,
        circleId: audienceId,
      },
      initial,
    );
  };
  const closeSheet = () => {
    Keyboard.dismiss();
    onClose();
  };
  const confirmClose = (then: () => void) => {
    if (!unsaved()) {
      then();
      return;
    }
    Alert.alert("Discard this unfinished moment?", undefined, [
      ...(mode && mode !== "drafts"
        ? [{ text: "Save draft", onPress: () => void persistDraft(true) }]
        : []),
      { text: "Discard", style: "destructive" as const, onPress: then },
      { text: "Keep editing", style: "cancel" as const },
    ]);
  };
  const onCommit = useRef<Parameters<typeof useSheetDrag>[0]["onCommit"]["current"]>(() => undefined);
  useEffect(() => {
    onCommit.current = ({ springBack, dismiss }) => {
      if (unsaved()) {
        springBack();
        confirmClose(closeSheet);
        return;
      }
      dismiss(closeSheet);
    };
  });
  const composing = mode === "thought" || mode === "bible" || mode === "insight" || mode === "photo";
  function submitComposer() {
    if (mode === "bible") {
      if (!reference || !body.trim()) {
        setError("Choose a passage");
        return;
      }
      void postNote(formatBibleVerseMoment(reference, body));
      return;
    }
    if (mode === "insight") {
      void postInsight();
      return;
    }
    if (mode === "photo") {
      void postPhoto();
      return;
    }
    void postNote(body);
  }
  const { translateY, panHandlers } = useSheetDrag({
    scrollTop,
    chromeHeight,
    sheetTop,
    sheetHeight: sheetHeightRef,
    onCommit,
  });

  return (
    <KeyboardForm>
    <KeyboardAvoidingView
      style={[styles.scrim, { backgroundColor: scrimColor }]}
      behavior="padding"
      enabled={mode != null}
    >
      {Platform.OS === "web" ? null : (
        <BlurView intensity={40} tint={colors.scheme === "light" ? "light" : "dark"} style={styles.blur} />
      )}
      <Pressable accessibilityLabel="Close" style={[styles.scrimTap, { minHeight: topGap }]} onPress={() => confirmClose(closeSheet)} />
      <Animated.View
        ref={sheetNode}
        {...panHandlers}
        onLayout={() => {
          sheetNode.current?.measureInWindow((_x, y) => {
            sheetTop.current = y;
          });
        }}
        style={[
          styles.sheet,
          {
            height: sheetHeight,
            backgroundColor: retro ? colors.cream : colors.paper,
            borderColor: colors.hairline,
            borderTopLeftRadius: radius,
            borderTopRightRadius: radius,
            transform: [{ translateY }],
          },
        ]}
      >
        <View
          onLayout={(event) => {
            chromeHeight.current = event.nativeEvent.layout.height;
          }}
        >
        <DismissKeyboardPressable accessible={false} style={styles.handleHit}>
          <View style={[styles.handle, { backgroundColor: colors.scheme === "dark" ? "#526158" : colors.line }]} />
        </DismissKeyboardPressable>
        <View style={styles.bar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            onPress={() => confirmClose(closeSheet)}
            style={styles.barSide}
          >
            <Text style={[face(colors, 400), { color: colors.ink, fontSize: 17 }]}>Cancel</Text>
          </Pressable>
          <Text style={[styles.heading, face(colors, 650), { color: colors.ink }]} numberOfLines={1}>
            {titleText}
          </Text>
          {composing ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Post"
              disabled={busy}
              onPress={submitComposer}
              style={[styles.barSide, styles.barEnd]}
            >
              <Text style={[face(colors, 700), { color: colors.action, fontSize: 17 }]}>
                {busy ? "Saving…" : "Post"}
              </Text>
            </Pressable>
          ) : (
            <View style={styles.barSide} />
          )}
        </View>
        </View>
        <ComposerScroller
          contentStyle={styles.body}
          onOffset={(y) => {
            scrollTop.current = y;
          }}
        >
          {mode == null ? (
            <View style={styles.chooser}>
              <View style={styles.grid}>
                {choices.map((choice) => (
                  <Pressable
                    key={choice.id}
                    accessibilityRole="button"
                    accessibilityLabel={choice.title}
                    onPress={() => setMode(choice.id)}
                    style={({ pressed }) => [
                      styles.choice,
                      {
                        borderColor: colors.hairline,
                        backgroundColor: pressed ? colors.selectionFill : "transparent",
                      },
                    ]}
                  >
                    <Ionicons name={choice.icon} size={28} color={colors.action} />
                    <Text style={[face(colors, 650), { color: colors.ink, fontSize: 13 }]}>
                      {choice.title}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Drafts, ${drafts.length}`}
                onPress={() => setMode("drafts")}
                style={styles.draftsFooter}
              >
                <Text style={[face(colors, 600), { color: colors.ink, fontSize: 15 }]}>
                  {`Drafts · ${drafts.length}`}
                </Text>
              </Pressable>
            </View>
          ) : null}
          {mode === "drafts" ? (
            drafts.length === 0 ? (
              <Text style={[face(colors, 400), { color: colors.muted }]}>No drafts</Text>
            ) : (
              <View style={styles.form}>
                {drafts.map((draft) => (
                  <View key={draft.id} style={styles.draftRow}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void openDraft(draft)}
                      style={styles.draftOpen}
                    >
                      <Text style={[face(colors, 500), { color: colors.ink }]}>{draftLabel(draft)}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Remove draft"
                      onPress={() => {
                        const supabase = getSupabase();
                        if (!supabase) return;
                        void deleteEntryDraft(supabase, draft.id, draft.session).then(() =>
                          listEntryDrafts(supabase).then(setDrafts),
                        );
                      }}
                    >
                      <Text style={[face(colors, 600), { color: colors.muted }]}>Remove</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )
          ) : null}
          {mode === "thought" || mode === "bible" || mode === "insight" || mode === "photo" ? (
            <View style={styles.form}>
              {mode === "photo" ? (
                <PhotoPicker
                  items={mediaItems}
                  retro={retro}
                  onPick={takeMedia}
                  onRemove={removeMedia}
                />
              ) : null}
              {mode === "bible" ? (
                <PassageRow
                  verse={verse}
                  labelColor={labelColor}
                  open={passageOpen}
                  onOpen={() => setPassageOpen(true)}
                  onClose={() => setPassageOpen(false)}
                  onChoose={(next) => void choosePassage(next)}
                />
              ) : null}
              {mode === "insight" ? (
                <Field
                  fieldId="body"
                  label="Quote"
                  labelColor={labelColor}
                  value={body}
                  placeholder="What did they say?"
                  multiline
                  onChange={setBody}
                />
              ) : null}
              {mode === "insight" ? (
                <Field
                  fieldId="attribution"
                  label="Who said it"
                  labelColor={labelColor}
                  value={title}
                  placeholder="Who said it"
                  onChange={setTitle}
                />
              ) : null}
              {mode === "insight" ? (
                <Field
                  fieldId="source"
                  label="Source"
                  labelColor={labelColor}
                  value={sourceUrl}
                  placeholder="https://www.youtube.com/…"
                  keyboardType="url"
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="URL"
                  onChange={setSourceUrl}
                />
              ) : null}
              {mode === "insight" ? null : (
              <Field
                fieldId="body"
                label={mode === "bible" ? "Verse text" : mode === "photo" ? "Note" : "Entry"}
                labelColor={labelColor}
                value={body}
                placeholder={
                  mode === "thought"
                    ? "Record what happened…"
                    : mode === "bible"
                      ? "Choose a passage to fill this entry…"
                      : "Add context…"
                }
                multiline
                accentBorder={retro}
                onChange={setBody}
              />
              )}
              <DateTimeFields
                date={occurredOn}
                maxDate={circleToday(circle?.timeZone ?? "UTC")}
                time={occurredTime}
                timeOptional={mode === "bible"}
                onDateChange={setOccurredOn}
                onTimeChange={setOccurredTime}
              />
              <AudienceChips
                circles={audienceCircles}
                counts={counts}
                justMe={justMe}
                circleId={audienceId}
                onJustMe={setJustMe}
                onCircle={(id) => {
                  setJustMe(false);
                  setCircleId(id);
                  setTaggedIds([]);
                }}
              />
              {mode === "insight" ? null : (
                <PlaceFields value={place} onChange={setPlace} />
              )}
              {mode === "insight" ? null : (
                <PeopleFields
                  people={visiblePeople}
                  selectedIds={taggedIds}
                  onToggle={(id) =>
                    setTaggedIds((current) =>
                      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
                    )
                  }
                />
              )}
              {error ? <Text style={[face(colors, 400), { color: colors.clay }]}>{error}</Text> : null}
            </View>
          ) : null}
        </ComposerScroller>
      </Animated.View>
    </KeyboardAvoidingView>
    </KeyboardForm>
  );
}

function draftLabel(draft: DraftListItem) {
  const kind =
    draft.kind === "bible-verse"
      ? "Bible verse"
      : draft.kind === "photo"
        ? "Photo"
        : draft.kind === "insight"
          ? "Insight"
          : "Note";
  return draft.previewText ? `${kind} · ${draft.previewText}` : kind;
}


function Field({
  label,
  labelColor,
  value,
  placeholder,
  multiline = false,
  accentBorder = false,
  fieldId,
  keyboardType,
  autoCapitalize,
  autoCorrect,
  textContentType,
  onChange,
}: Readonly<{
  label: string;
  labelColor: string;
  value: string;
  placeholder: string;
  multiline?: boolean;
  accentBorder?: boolean;
  fieldId: string;
  keyboardType?: "url";
  autoCapitalize?: "none";
  autoCorrect?: boolean;
  textContentType?: "URL";
  onChange: (value: string) => void;
}>) {
  const { colors } = useAppTheme();
  const input = useComposerInput(fieldId, multiline);
  return (
    <View style={styles.form}>
      <Text
        style={[
          face(colors, 600, "record"),
          styles.legend,
          { color: labelColor, letterSpacing: tracking(colors.appearance === "retro" ? 11 : 9, 0.08) },
        ]}
      >
        {label}
      </Text>
      <TextInput
        {...input}
        value={value}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        textContentType={textContentType}
        onChangeText={onChange}
        style={[
          styles.input,
          face(colors, 400, multiline ? "serif" : "interface"),
          {
            color: colors.ink,
            borderColor: accentBorder ? colors.action : colors.hairline,
            backgroundColor: colors.surface,
            minHeight: multiline ? 120 : 44,
            borderRadius: colors.appearance === "retro" ? 2 : multiline ? 8 : 7,
            fontSize: multiline ? 17 : 15,
            lineHeight: multiline ? 25 : undefined,
          },
        ]}
      />
    </View>
  );
}

function PassageRow({
  verse,
  labelColor,
  open,
  onOpen,
  onClose,
  onChoose,
}: Readonly<{
  verse: BibleVerseSelection;
  labelColor: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChoose: (verse: BibleVerseSelection) => void;
}>) {
  const { colors } = useAppTheme();
  const retro = colors.appearance === "retro";
  const value =
    verse.book && verse.chapter && verse.startVerse && verse.endVerse
      ? formatBibleVerseReference(verse.book, verse.chapter, verse.startVerse, verse.endVerse)
      : "Choose a passage";
  return (
    <View style={styles.form}>
      <Text
        style={[
          face(colors, 600, "record"),
          styles.legend,
          { color: labelColor, letterSpacing: tracking(9, 0.08) },
        ]}
      >
        Passage
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Passage, ${value}`}
        onPress={onOpen}
        style={({ pressed }) => [
          styles.input,
          styles.trigger,
          {
            borderColor: colors.hairline,
            backgroundColor: pressed ? colors.selectionFill : colors.surface,
            borderRadius: retro ? 2 : 7,
          },
        ]}
      >
        <Text style={[face(colors, 400), { color: value.startsWith("Choose") ? colors.faint : colors.ink }]}>
          {value}
        </Text>
      </Pressable>
      <PassageSheet open={open} verse={verse} onClose={onClose} onChoose={onChoose} />
    </View>
  );
}

function PhotoPicker({
  items,
  retro,
  onPick,
  onRemove,
}: Readonly<{
  items: readonly PickedMedia[];
  retro: boolean;
  onPick: (source: MediaSource, intent: "replace" | "add") => void;
  onRemove: (index: number) => void;
}>) {
  const { colors } = useAppTheme();
  const radius = retro ? 2 : 16;
  const tileColor = retro || colors.scheme === "light" ? colors.surface : colors.surface;
  if (items.length === 0) {
    return (
      <MediaChooser
        accessibilityLabel="Add photo or video"
        onPick={(source) => onPick(source, "replace")}
        style={({ pressed }) => [
          styles.photoDrop,
          {
            borderColor: "transparent",
            backgroundColor: pressed ? colors.selectionFill : tileColor,
            borderRadius: radius,
            transform: [{ scale: pressed ? 0.985 : 1 }],
          },
        ]}
      >
        <Ionicons name="camera" size={42} color={colors.action} />
        <Text style={[face(colors, 700), styles.photoLabel, { color: colors.ink }]}>Add photo or video</Text>
        <Text style={[face(colors, 400), styles.photoCaption, { color: colors.muted }]}>
          Private to this family
        </Text>
      </MediaChooser>
    );
  }
  if (items.length === 1) {
    const item = items[0];
    if (!item) return null;
    return (
      <View style={[styles.previewFrame, { borderRadius: radius }]}>
        <MediaChooser
          accessibilityLabel={item.kind === "video" ? "Replace video" : "Replace photo"}
          onPick={(source) => onPick(source, "replace")}
          style={styles.previewFill}
        >
          <MediaStill item={item} />
        </MediaChooser>
        <RemoveMark
          label={item.kind === "video" ? "Remove video" : "Remove photo"}
          onPress={() => onRemove(0)}
        />
      </View>
    );
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
    >
      {items.map((item, index) => (
        <View key={`${item.previewUri}-${index}`} style={[styles.thumb, { borderRadius: radius }]}>
          <MediaStill item={item} />
          <RemoveMark label={`Remove photo ${index + 1}`} onPress={() => onRemove(index)} />
        </View>
      ))}
      {items.length < maximumMomentPhotos ? (
        <MediaChooser
          accessibilityLabel="Add photo"
          onPick={(source) => onPick(source, "add")}
          style={({ pressed }) => [
            styles.addTile,
            {
              borderRadius: radius,
              borderColor: colors.action,
              backgroundColor: pressed ? colors.selectionFill : tileColor,
            },
          ]}
        >
          <Ionicons name="add" size={28} color={colors.action} />
        </MediaChooser>
      ) : null}
    </ScrollView>
  );
}

function RemoveMark({ label, onPress }: Readonly<{ label: string; onPress: () => void }>) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.remove}>
      <Text style={styles.removeGlyph}>×</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 40,
    justifyContent: "flex-end",
    ...(Platform.OS === "web" ? { backdropFilter: "blur(8px)" } : null),
  },
  blur: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  scrimTap: {
    flexGrow: 1,
    flexShrink: 0,
  },
  sheet: {
    borderTopWidth: 1,
    paddingTop: 8,
    flexGrow: 0,
    flexShrink: 1,
    minHeight: 0,
  },
  handleHit: {
    alignItems: "center",
    paddingTop: 6,
    paddingBottom: 8,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 999,
  },
  bar: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
  },
  barSide: {
    minWidth: 72,
    minHeight: 44,
    justifyContent: "center",
  },
  barEnd: {
    alignItems: "flex-end",
  },
  back: {
    minHeight: 44,
    justifyContent: "center",
  },
  heading: {
    flex: 1,
    fontSize: 17,
    lineHeight: 22,
    textAlign: "center",
  },
  footer: {
    borderTopWidth: 1,
    paddingTop: 10,
    paddingHorizontal: 16,
    boxShadow: "0 -10px 24px rgba(0,0,0,0.18)",
  },
  body: {
    paddingTop: 8,
    paddingBottom: 24,
    paddingHorizontal: 20,
    gap: 12,
  },
  chooser: { gap: 16 },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  draftsFooter: {
    minHeight: 44,
    justifyContent: "center",
  },
  choice: {
    width: "47%",
    minHeight: 80,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: "flex-start",
    justifyContent: "center",
    gap: 8,
  },
  choiceTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  form: { gap: 8 },
  detail: { fontSize: 9, lineHeight: 12 },
  legend: {
    fontSize: 9,
    textTransform: "uppercase",
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: 9,
    borderWidth: 1,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    borderWidth: 1,
    borderRadius: 7,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  trigger: {
    minHeight: 44,
    justifyContent: "center",
  },
  split: {
    flexDirection: "row",
    gap: 8,
  },
  post: {
    flex: 1.45,
    minHeight: 48,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  draft: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  photoDrop: {
    minHeight: 120,
    paddingHorizontal: 16,
    paddingVertical: 18,
    borderWidth: 0,
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  photoLabel: {
    fontSize: 17,
    lineHeight: 22,
  },
  photoCaption: {
    fontSize: 11,
    lineHeight: 14,
    textAlign: "center",
  },
  previewFrame: {
    height: 168,
    overflow: "hidden",
  },
  previewFill: {
    flex: 1,
  },
  strip: {
    gap: 8,
    paddingVertical: 2,
  },
  thumb: {
    width: 88,
    height: 88,
    overflow: "hidden",
  },
  addTile: {
    width: 88,
    height: 88,
    borderWidth: 1.5,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  remove: {
    position: "absolute",
    top: 8,
    right: 8,
    zIndex: 2,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  removeGlyph: {
    color: "#fff",
    fontSize: 18,
    lineHeight: 20,
  },
  secondary: {
    flex: 1,
    minHeight: 48,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  draftRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  draftOpen: {
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
  },
});
