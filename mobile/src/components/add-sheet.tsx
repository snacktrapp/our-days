import { useEffect, useState } from "react";
import {
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
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  bibleBookNames,
  chaptersInBook,
  emptyBibleVerseSelection,
  endingVersesInChapter,
  formatBibleVerseMoment,
  formatBibleVerseReference,
  loadBibleCatalog,
  selectBiblePassage,
  versesInChapter,
  type BibleVerseSelection,
} from "../lib/bible";
import { circleToday } from "../lib/dates";
import type { CircleMembership } from "../lib/journal";
import { emptyPlace, type PlaceSelection } from "../lib/places";
import {
  createFamilyMoment,
  createInsightMoment,
  deleteEntryDraft,
  listEntryDrafts,
  loadEntryDraft,
  saveEntryDraft,
  uploadPhotoMoment,
  type Audience,
  type DraftListItem,
} from "../lib/posts";
import { loadRosters, type CirclePerson } from "../lib/roster";
import { getSupabase } from "../lib/supabase";
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

type Mode = "photo" | "thought" | "bible" | "insight" | "drafts" | null;
type Picker = "book" | "chapter" | "start" | "end" | null;

const choices = [
  { id: "photo" as const, title: "Photo or video", detail: "Media with date and note" },
  { id: "thought" as const, title: "Written entry", detail: "Text, date, and details" },
  { id: "bible" as const, title: "Bible verse", detail: "Choose a passage" },
  { id: "drafts" as const, title: "Drafts", detail: "Unfinished entries" },
  { id: "insight" as const, title: "Insight", detail: "Quote, attribution, and source" },
];

const pickerMissing =
  "Photo library and camera need expo-image-picker, which is not in runtime 0.2.0. That needs a new TestFlight build.";

/**
 * Web New moment order is Photo or video, Written entry, Bible verse, Drafts.
 * Insight is an extra tile: the web creates it with create_insight_moment,
 * which is not one of those four choices.
 */
export function AddSheet({
  circles,
  justMeDefault,
  onClose,
  onPosted,
  initialMode = null,
  previewPeople,
}: Readonly<{
  circles: readonly CircleMembership[];
  justMeDefault: boolean;
  onClose: () => void;
  onPosted: (audience: Audience) => void;
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
  const [occurredOn, setOccurredOn] = useState(
    circleToday(circles[0]?.timeZone ?? "UTC"),
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
  const [circleId, setCircleId] = useState(circles[0]?.circleId ?? "");
  const [verse, setVerse] = useState<BibleVerseSelection>(emptyBibleVerseSelection);
  const [reference, setReference] = useState("");
  const [picker, setPicker] = useState<Picker>(null);
  const [catalogReady, setCatalogReady] = useState(false);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [photoBytes, setPhotoBytes] = useState<ArrayBuffer | null>(null);
  const [photoMime, setPhotoMime] = useState("image/jpeg");
  const [draftId, setDraftId] = useState<string | undefined>(undefined);
  const [draftSession, setDraftSession] = useState(false);
  const [drafts, setDrafts] = useState<readonly DraftListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const radius = colors.appearance === "retro" ? 2 : 14;
  const circle = circles.find((item) => item.circleId === circleId) ?? circles[0];

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
    void loadBibleCatalog().then(() => setCatalogReady(true));
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
    onPosted(audience());
  }

  async function postInsight() {
    const supabase = requireCircle();
    const instant = when();
    if (!supabase || !circle || !instant) return;
    if (!body.trim() || !title.trim()) {
      setError("Check the Insight and try again.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await createInsightMoment(supabase, {
      circleId: circle.circleId,
      quote: body,
      attribution: title,
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
    onPosted(audience());
  }

  async function postPhoto() {
    const supabase = requireCircle();
    const instant = when();
    if (!supabase || !circle || !instant) return;
    if (!photoBytes) {
      setError("Choose a photo first.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await uploadPhotoMoment(supabase, {
      bytes: photoBytes,
      mimeType: photoMime,
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
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (draftId) void deleteEntryDraft(supabase, draftId, draftSession);
    onPosted(audience());
  }

  function pickPhoto(camera: boolean) {
    const doc = globalThis.document;
    if (!doc) {
      setError(pickerMissing);
      return;
    }
    const input = doc.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    if (camera) input.setAttribute("capture", "environment");
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void file.arrayBuffer().then((bytes) => {
        setPhotoBytes(bytes);
        setPhotoMime(file.type || "image/jpeg");
        setPhotoName(file.name);
        setError(null);
      });
    };
    input.click();
  }

  async function choosePassage(next: BibleVerseSelection) {
    setVerse(next);
    setPicker(null);
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

  async function persistDraft() {
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
    setPhotoBytes(null);
    setPhotoName(null);
    setMode(
      draft.kind === "bible-verse"
        ? "bible"
        : draft.kind === "photo"
          ? "photo"
          : draft.kind === "insight"
            ? "insight"
            : "thought",
    );
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
  const sheetHeight =
    mode == null
      ? Math.max(windowHeight * 0.5, 300)
      : Math.min(windowHeight * 0.88, windowHeight - topGap);
  const scrimColor = retro
    ? "#100d0c"
    : colors.scheme === "light"
      ? "rgba(32,39,33,0.42)"
      : "rgba(0,5,3,0.72)";
  const visiblePeople = (roster.get(circle?.circleId ?? "") ?? []).filter(
    (person) => person.id !== circle?.personId,
  );

  return (
    <View style={[styles.scrim, { backgroundColor: scrimColor }]}>
      {Platform.OS === "web" ? null : (
        <BlurView intensity={40} tint={colors.scheme === "light" ? "light" : "dark"} style={styles.blur} />
      )}
      <Pressable accessibilityLabel="Close" style={styles.scrimTap} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          {
            height: sheetHeight,
            backgroundColor: retro ? colors.cream : colors.paper,
            borderColor: colors.hairline,
            borderTopLeftRadius: radius,
            borderTopRightRadius: radius,
          },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: colors.scheme === "dark" ? "#526158" : colors.line }]} />
        <View style={styles.bar}>
          <Text style={[styles.heading, face(colors, 650), { color: colors.ink }]}>{titleText}</Text>
        </View>
        <ScrollView style={styles.scroller} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {mode == null ? (
            <View style={styles.grid}>
              {choices.map((choice) => (
                <Pressable
                  key={choice.id}
                  accessibilityRole="button"
                  onPress={() => setMode(choice.id)}
                  style={[styles.choice, { borderColor: colors.hairline, backgroundColor: "transparent" }]}
                >
                  <View style={styles.choiceTitle}>
                    <Text style={[face(colors, 650), { color: colors.ink, fontSize: 13 }]}>
                      {choice.title}
                    </Text>
                    {choice.id === "drafts" && drafts.length > 0 ? (
                      <Text style={[face(colors, 650), { color: colors.muted, fontSize: 13 }]}>
                        {drafts.length}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[face(colors, 400, "record"), styles.detail, { color: colors.muted }]}>
                    {choice.detail}
                  </Text>
                </Pressable>
              ))}
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
                <View style={styles.split}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => pickPhoto(false)}
                    style={[styles.secondary, { borderColor: colors.hairline, backgroundColor: colors.surface }]}
                  >
                    <Text style={[face(colors, 650), { color: colors.ink }]}>Library</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => pickPhoto(true)}
                    style={[styles.secondary, { borderColor: colors.hairline, backgroundColor: colors.surface }]}
                  >
                    <Text style={[face(colors, 650), { color: colors.ink }]}>Camera</Text>
                  </Pressable>
                </View>
              ) : null}
              {photoName && mode === "photo" ? (
                <Text style={[face(colors, 400), { color: colors.muted, fontSize: 12 }]}>{photoName}</Text>
              ) : null}
              {mode === "bible" ? (
                <BiblePickers
                  verse={verse}
                  catalogReady={catalogReady}
                  picker={picker}
                  labelColor={labelColor}
                  onToggle={setPicker}
                  onChoose={(next) => void choosePassage(next)}
                />
              ) : null}
              {mode === "insight" ? (
                <Field
                  label="Attribution"
                  labelColor={labelColor}
                  value={title}
                  placeholder="Who said it"
                  onChange={setTitle}
                />
              ) : null}
              {mode === "insight" ? (
                <Field
                  label="Source URL"
                  labelColor={labelColor}
                  value={sourceUrl}
                  placeholder="https://"
                  onChange={setSourceUrl}
                />
              ) : null}
              {mode === "bible" && reference ? (
                <Text style={[face(colors, 600), { color: colors.ink }]}>{reference}</Text>
              ) : null}
              <Field
                label={mode === "bible" ? "Verse text" : mode === "insight" ? "Quote" : mode === "photo" ? "Note" : "Entry"}
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
              <DateTimeFields
                date={occurredOn}
                maxDate={circleToday(circle?.timeZone ?? "UTC")}
                time={occurredTime}
                timeOptional={mode === "bible"}
                onDateChange={setOccurredOn}
                onTimeChange={setOccurredTime}
              />
              <AudienceChips
                circles={circles}
                counts={counts}
                justMe={justMe}
                circleId={circle?.circleId ?? ""}
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
              <View style={styles.split}>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => {
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
                  }}
                  style={[
                    styles.post,
                    {
                      backgroundColor: colors.action,
                      borderColor: colors.action,
                      borderRadius: retro ? 2 : 7,
                    },
                  ]}
                >
                  <Text
                    style={[
                      face(colors, retro ? 700 : 650),
                      {
                        color: colors.actionInk,
                        letterSpacing: retro ? tracking(15, 0.08) : 0,
                        textTransform: retro ? "uppercase" : "none",
                      },
                    ]}
                  >
                    {busy ? "Saving…" : "Post"}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => void persistDraft()}
                  style={[
                    styles.draft,
                    retro
                      ? {
                          borderWidth: 1,
                          borderColor: colors.hairline,
                          borderRadius: 2,
                          backgroundColor: colors.surface,
                        }
                      : null,
                  ]}
                >
                  <Text style={[face(colors, retro ? 700 : 650), { color: retro ? colors.ink : colors.muted }]}>
                    {busy ? "Saving draft…" : "Save draft"}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </View>
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
  onChange,
}: Readonly<{
  label: string;
  labelColor: string;
  value: string;
  placeholder: string;
  multiline?: boolean;
  accentBorder?: boolean;
  onChange: (value: string) => void;
}>) {
  const { colors } = useAppTheme();
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
        value={value}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        multiline={multiline}
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

function BiblePickers({
  verse,
  catalogReady,
  picker,
  labelColor,
  onToggle,
  onChoose,
}: Readonly<{
  verse: BibleVerseSelection;
  catalogReady: boolean;
  picker: Picker;
  labelColor: string;
  onToggle: (picker: Picker) => void;
  onChoose: (verse: BibleVerseSelection) => void;
}>) {
  const { colors } = useAppTheme();
  const chapters = verse.book ? chaptersInBook(verse.book) : [];
  const starts = verse.book && verse.chapter ? versesInChapter(verse.book, verse.chapter) : [];
  const ends =
    verse.book && verse.chapter && verse.startVerse
      ? endingVersesInChapter(verse.book, verse.chapter, verse.startVerse)
      : [];
  const options =
    picker === "book"
      ? bibleBookNames().map((name) => ({ id: name, label: name }))
      : picker === "chapter"
        ? chapters.map((chapter) => ({ id: String(chapter), label: String(chapter) }))
        : picker === "start"
          ? starts.map((item) => ({ id: String(item), label: String(item) }))
          : picker === "end"
            ? ends.map((item) => ({ id: String(item), label: String(item) }))
            : [];
  const rows: readonly { id: Picker; label: string; value: string; disabled: boolean }[] = [
    { id: "book", label: "Book", value: verse.book ?? "Choose book", disabled: false },
    { id: "chapter", label: "Chapter", value: verse.chapter ? String(verse.chapter) : "Choose chapter", disabled: !verse.book },
    { id: "start", label: "Starting verse", value: verse.startVerse ? String(verse.startVerse) : "Choose verse", disabled: !verse.chapter },
    { id: "end", label: "Ending verse", value: verse.endVerse ? String(verse.endVerse) : "Choose verse", disabled: !verse.startVerse },
  ];
  return (
    <View style={styles.form}>
      {rows.map((row) => (
        <View key={row.id} style={styles.form}>
          <Text
            style={[
              face(colors, 600, "record"),
              styles.legend,
              { color: labelColor, letterSpacing: tracking(9, 0.08) },
            ]}
          >
            {row.label}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={row.disabled}
            onPress={() => onToggle(picker === row.id ? null : row.id)}
            style={[styles.input, styles.trigger, { borderColor: colors.hairline, backgroundColor: colors.surface }]}
          >
            <Text style={[face(colors, 400), { color: row.value.startsWith("Choose") ? colors.faint : colors.ink }]}>
              {row.value}
            </Text>
          </Pressable>
        </View>
      ))}
      {!catalogReady && verse.book ? (
        <Text style={[face(colors, 400), { color: colors.muted, fontSize: 12 }]}>Loading passage…</Text>
      ) : null}
      {picker ? (
        <ScrollView style={styles.picker} nestedScrollEnabled>
          {options.map((option) => (
            <Pressable
              key={option.id}
              accessibilityRole="button"
              onPress={() => {
                if (picker === "book") {
                  onChoose({ book: option.id, chapter: null, startVerse: null, endVerse: null });
                  return;
                }
                const number = Number(option.id);
                if (picker === "chapter") {
                  onChoose({ ...verse, chapter: number, startVerse: null, endVerse: null });
                  return;
                }
                if (picker === "start") {
                  onChoose({ ...verse, startVerse: number, endVerse: number });
                  return;
                }
                onChoose({ ...verse, endVerse: number });
              }}
              style={styles.pickerRow}
            >
              <Text style={[face(colors, 400), { color: colors.ink }]}>{option.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {verse.startVerse && verse.endVerse && verse.book && verse.chapter ? (
        <Text style={[face(colors, 400), { color: colors.muted, fontSize: 12 }]}>
          {formatBibleVerseReference(verse.book, verse.chapter, verse.startVerse, verse.endVerse)}
        </Text>
      ) : null}
    </View>
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
    flex: 1,
  },
  sheet: {
    borderTopWidth: 1,
    paddingTop: 8,
    paddingHorizontal: 20,
  },
  handle: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 999,
    marginBottom: 8,
  },
  bar: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  back: {
    minHeight: 44,
    justifyContent: "center",
  },
  heading: {
    flex: 1,
    fontSize: 17,
    lineHeight: 22,
  },
  scroller: { flex: 1 },
  body: {
    paddingTop: 8,
    paddingBottom: 24,
    gap: 12,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  choice: {
    width: "47%",
    minHeight: 80,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 8,
    justifyContent: "flex-start",
    gap: 4,
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
  picker: {
    maxHeight: 220,
    borderRadius: 7,
  },
  pickerRow: {
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
