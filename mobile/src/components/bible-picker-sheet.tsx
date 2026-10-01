import { useState } from "react";
import {
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

import {
  bibleBookGroups,
  bibleNumberChoices,
} from "../lib/bible-picker";
import type { BibleVerseSelection } from "../lib/bible";
import { useAppTheme } from "../lib/theme";
import { face, tracking } from "../lib/tokens";

export type BiblePicker = "book" | "chapter" | "start" | "end";

const titles: Record<BiblePicker, string> = {
  book: "Book",
  chapter: "Chapter",
  start: "Starting verse",
  end: "Ending verse",
};

export function BiblePickerSheet({
  picker,
  verse,
  onClose,
  onChoose,
}: Readonly<{
  picker: BiblePicker | null;
  verse: BibleVerseSelection;
  onClose: () => void;
  onChoose: (verse: BibleVerseSelection) => void;
}>) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<BiblePicker | null>(picker);
  if (picker && picker !== active) {
    setActive(picker);
    setQuery("");
  }
  const display = picker ?? active;
  if (!display) return null;

  const retro = colors.appearance === "retro";
  const light = colors.scheme === "light" && !retro;
  const scrimColor = retro ? "#100d0c" : light ? "rgba(32,39,33,0.42)" : "rgba(0,5,3,0.72)";
  const radius = retro ? 2 : 14;
  const groups = display === "book" ? bibleBookGroups(query) : [];
  const numbers = display === "book" ? [] : bibleNumberChoices(display, verse);
  const selectedNumber =
    display === "chapter" ? verse.chapter : display === "start" ? verse.startVerse : verse.endVerse;

  function chooseNumber(number: number) {
    if (display === "chapter") {
      onChoose({ ...verse, chapter: number, startVerse: null, endVerse: null });
      return;
    }
    if (display === "start") {
      onChoose({ ...verse, startVerse: number, endVerse: number });
      return;
    }
    if (display === "end") onChoose({ ...verse, endVerse: number });
  }

  return (
    <Modal
      transparent
      visible={picker != null}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={[styles.fill, { backgroundColor: scrimColor }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {Platform.OS === "web" ? null : (
          <BlurView
            intensity={40}
            tint={light ? "light" : "dark"}
            style={styles.blur}
          />
        )}
        <Pressable
          accessibilityLabel="Close"
          onPress={onClose}
          style={styles.scrimTap}
        />
        <View
          style={[
            styles.sheet,
            {
              maxHeight: Math.round(height * 0.72),
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
                  backgroundColor: retro
                    ? "#6f655b"
                    : colors.scheme === "dark"
                      ? "#526158"
                      : colors.line,
                },
              ]}
            />
          </View>
          <Text style={[styles.title, face(colors, 650), { color: colors.ink }]}>
            {titles[display]}
          </Text>
          {display === "book" ? (
            <TextInput
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
            style={{ maxHeight: Math.round(height * (display === "book" ? 0.48 : 0.42)) }}
            contentContainerStyle={styles.scrollContent}
          >
            {display === "book" ? (
              groups.length === 0 ? (
                <Text style={[face(colors, 400), { color: colors.muted, fontSize: 15 }]}>
                  No books match
                </Text>
              ) : (
                groups.map((group) => (
                  <View key={group.testament} style={styles.group}>
                    <Text
                      accessibilityRole="header"
                      style={[
                        face(colors, 600, "record"),
                        styles.legend,
                        {
                          color: colors.muted,
                          letterSpacing: tracking(9, 0.08),
                        },
                      ]}
                    >
                      {group.testament}
                    </Text>
                    {group.books.map((book) => {
                      const selected = book === verse.book;
                      return (
                        <Pressable
                          key={book}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          onPress={() =>
                            onChoose({
                              book,
                              chapter: null,
                              startVerse: null,
                              endVerse: null,
                            })
                          }
                          style={({ pressed }) => [
                            styles.bookRow,
                            {
                              backgroundColor: pressed || selected ? colors.selectionFill : "transparent",
                              borderRadius: retro ? 2 : 8,
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
                  const kind =
                    display === "chapter" ? "Chapter" : display === "start" ? "Starting verse" : "Ending verse";
                  return (
                    <Pressable
                      key={number}
                      accessibilityRole="button"
                      accessibilityLabel={`${kind} ${number}`}
                      accessibilityState={{ selected }}
                      onPress={() => chooseNumber(number)}
                      style={({ pressed }) => [
                        styles.cell,
                        {
                          backgroundColor: selected
                            ? colors.action
                            : pressed
                              ? colors.selectionFill
                              : colors.surface,
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
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    justifyContent: "flex-end",
  },
  scrimTap: {
    flexGrow: 1,
    flexShrink: 1,
  },
  blur: {
    ...StyleSheet.absoluteFill,
    pointerEvents: "none",
  },
  sheet: {
    borderTopWidth: 1,
    paddingTop: 8,
    flexShrink: 1,
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
  title: {
    fontSize: 17,
    lineHeight: 22,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  search: {
    marginHorizontal: 20,
    marginBottom: 8,
    minHeight: 44,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  group: {
    gap: 2,
    marginBottom: 12,
  },
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
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingTop: 4,
  },
  cell: {
    width: 44,
    height: 44,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
