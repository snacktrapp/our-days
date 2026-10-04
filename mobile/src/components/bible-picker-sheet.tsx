import { useEffect, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
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

import { bibleBookGroups, bibleNumberChoices, passageSheetMaxHeight } from "../lib/bible-picker";
import type { BibleVerseSelection } from "../lib/bible";
import { useAppTheme } from "../lib/theme";
import { face, tracking } from "../lib/tokens";
import { KeyboardDoneBar, composerKeyboardDismissMode } from "./keyboard-form";

type Step = "book" | "chapter" | "start" | "end";

const titles: Record<Step, string> = {
  book: "Book",
  chapter: "Chapter",
  start: "Verse",
  end: "Ending verse",
};

/**
 * One passage sheet: book, then chapter, then verse. Back steps backward.
 * Add range continues to an optional ending verse instead of closing.
 */
export function PassageSheet({
  open,
  verse,
  onClose,
  onChoose,
}: Readonly<{
  open: boolean;
  verse: BibleVerseSelection;
  onClose: () => void;
  onChoose: (verse: BibleVerseSelection) => void;
}>) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [query, setQuery] = useState("");
  const [step, setStep] = useState<Step>("book");
  const [draft, setDraft] = useState<BibleVerseSelection>(verse);
  const [ranging, setRanging] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [shown, setShown] = useState(open);
  if (open !== shown) {
    setShown(open);
    if (open) {
      setQuery("");
      setStep("book");
      setDraft(verse);
      setRanging(false);
    }
  }

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  if (!open && !shown) return null;

  const retro = colors.appearance === "retro";
  const light = colors.scheme === "light" && !retro;
  const scrimColor = retro ? "#100d0c" : light ? "rgba(32,39,33,0.42)" : "rgba(0,5,3,0.72)";
  const radius = retro ? 2 : 14;
  const groups = step === "book" ? bibleBookGroups(query) : [];
  const numbers =
    step === "chapter"
      ? bibleNumberChoices("chapter", draft)
      : step === "start"
        ? bibleNumberChoices("start", draft)
        : step === "end"
          ? bibleNumberChoices("end", draft)
          : [];
  const selectedNumber =
    step === "chapter" ? draft.chapter : step === "start" ? draft.startVerse : draft.endVerse;
  const maxHeight = passageSheetMaxHeight({
    windowHeight: height,
    topInset: insets.top,
    keyboardHeight,
  });

  function finish(next: BibleVerseSelection) {
    onChoose(next);
  }

  function goBack() {
    if (step === "end") {
      setStep("start");
      return;
    }
    if (step === "start") {
      setStep("chapter");
      return;
    }
    if (step === "chapter") {
      setStep("book");
      return;
    }
    onClose();
  }

  return (
    <Modal transparent visible={open} animationType="slide" onRequestClose={goBack} statusBarTranslucent>
      <KeyboardAvoidingView
        style={[styles.fill, { backgroundColor: scrimColor }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {Platform.OS === "web" ? null : (
          <BlurView intensity={40} tint={light ? "light" : "dark"} style={styles.blur} />
        )}
        <Pressable accessibilityLabel="Close" onPress={onClose} style={styles.scrimTap} />
        <View
          style={[
            styles.sheet,
            {
              maxHeight,
              backgroundColor: retro ? colors.cream : colors.paper,
              borderColor: colors.hairline,
              borderTopLeftRadius: radius,
              borderTopRightRadius: radius,
              paddingBottom: Math.max(16, insets.bottom),
            },
          ]}
        >
          <View style={styles.handleHit}>
            <View
              style={[
                styles.handle,
                {
                  backgroundColor: retro ? "#6f655b" : colors.scheme === "dark" ? "#526158" : colors.line,
                },
              ]}
            />
          </View>
          <View style={styles.titleRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={goBack} style={styles.back}>
              <Text style={[face(colors, 400), { color: colors.action, fontSize: 17 }]}>Back</Text>
            </Pressable>
            <Text style={[styles.title, face(colors, 650), { color: colors.ink }]}>{step === "start" && ranging ? "Starting verse" : titles[step]}</Text>
            <View style={styles.back} />
          </View>
          {step === "book" ? (
            <TextInput
              keyboardAppearance={colors.scheme}
              value={query}
              onChangeText={setQuery}
              autoFocus
              autoCorrect={false}
              accessibilityLabel="Search books"
              placeholder="Search books"
              placeholderTextColor={colors.faint}
              style={[
                styles.search,
                face(colors, 400),
                {
                  color: colors.ink,
                  borderColor: colors.hairline,
                  backgroundColor: colors.surface,
                  borderRadius: retro ? 2 : 7,
                },
              ]}
            />
          ) : null}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={composerKeyboardDismissMode}
            style={{ maxHeight: maxHeight - 120 }}
            contentContainerStyle={styles.scrollContent}
          >
            {step === "book" ? (
              groups.length === 0 ? (
                <Text style={[face(colors, 400), { color: colors.muted, fontSize: 15 }]}>No books match</Text>
              ) : (
                groups.map((group) => (
                  <View key={group.testament} style={styles.group}>
                    <Text
                      accessibilityRole="header"
                      style={[
                        face(colors, 600, "record"),
                        styles.legend,
                        { color: colors.muted, letterSpacing: tracking(9, 0.08) },
                      ]}
                    >
                      {group.testament}
                    </Text>
                    {group.books.map((book, index) => {
                      const selected = book === draft.book;
                      return (
                        <Pressable
                          key={book}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          onPress={() => {
                            setDraft({ book, chapter: null, startVerse: null, endVerse: null });
                            setRanging(false);
                            setStep("chapter");
                          }}
                          style={({ pressed }) => [
                            styles.bookRow,
                            {
                              backgroundColor: pressed ? colors.selectionFill : "transparent",
                              borderBottomColor: colors.hairline,
                              borderBottomWidth: index === group.books.length - 1 ? 0 : StyleSheet.hairlineWidth,
                            },
                          ]}
                        >
                          <Text style={[face(colors, selected ? 650 : 400), { color: colors.ink, fontSize: 16 }]}>
                            {book}
                          </Text>
                          {selected ? (
                            <Text style={[face(colors, 650), { color: colors.action, fontSize: 16 }]}>✓</Text>
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </View>
                ))
              )
            ) : (
              <View style={styles.grid}>
                {numbers.map((number) => {
                  const selected = number === selectedNumber;
                  const kind = step === "chapter" ? "Chapter" : step === "end" ? "Ending verse" : "Verse";
                  return (
                    <Pressable
                      key={number}
                      accessibilityRole="button"
                      accessibilityLabel={`${kind} ${number}`}
                      accessibilityState={{ selected }}
                      onPress={() => {
                        if (step === "chapter") {
                          setDraft((current) => ({
                            ...current,
                            chapter: number,
                            startVerse: null,
                            endVerse: null,
                          }));
                          setStep("start");
                          return;
                        }
                        if (step === "start") {
                          const next = { ...draft, startVerse: number, endVerse: number };
                          setDraft(next);
                          if (ranging) {
                            setStep("end");
                            return;
                          }
                          finish(next);
                          return;
                        }
                        finish({ ...draft, endVerse: number });
                      }}
                      style={({ pressed }) => [
                        styles.cell,
                        {
                          backgroundColor: selected ? colors.action : pressed ? colors.selectionFill : colors.surface,
                          borderColor: selected ? colors.action : colors.hairline,
                          borderRadius: retro ? 2 : 8,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          face(colors, selected ? 650 : 400),
                          { color: selected ? colors.actionInk : colors.ink, fontSize: 15 },
                        ]}
                      >
                        {number}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
            {step === "start" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add range"
                onPress={() => {
                  setRanging(true);
                  if (draft.startVerse) setStep("end");
                }}
                style={styles.range}
              >
                <Text style={[face(colors, 600), { color: colors.action, fontSize: 16 }]}>Add range</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
      <KeyboardDoneBar />
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: "flex-end" },
  scrimTap: { flexGrow: 1, flexShrink: 1 },
  blur: { ...StyleSheet.absoluteFill, pointerEvents: "none" },
  sheet: { borderTopWidth: 1, paddingTop: 8, flexShrink: 1 },
  handleHit: { alignItems: "center", paddingTop: 6, paddingBottom: 8 },
  handle: { width: 38, height: 4, borderRadius: 999 },
  titleRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
  },
  back: { width: 72, minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  title: { flex: 1, textAlign: "center", fontSize: 17, lineHeight: 22 },
  search: {
    marginHorizontal: 20,
    marginBottom: 8,
    minHeight: 44,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 12 },
  group: { marginBottom: 12 },
  legend: {
    fontSize: 9,
    textTransform: "uppercase",
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 4,
  },
  bookRow: {
    minHeight: 44,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 4 },
  cell: {
    width: 44,
    height: 44,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  range: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8, marginTop: 8 },
});
