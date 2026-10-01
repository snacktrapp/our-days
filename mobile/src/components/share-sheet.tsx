import { useState } from "react";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { circleToday } from "../lib/dates";
import { postableCircles, type CircleMembership } from "../lib/journal";
import {
  createWrittenMoment,
  uploadPhotoMoment,
  uploadVideoMoment,
} from "../lib/posts";
import { shareDraftLabel, shareNeedsJpeg, type ShareDraft } from "../lib/share-entry";
import { getSupabase } from "../lib/supabase";
import { useAppTheme } from "../lib/theme";
import { face } from "../lib/tokens";

export function ShareSheet({
  draft,
  circles,
  onClose,
  onPosted,
}: Readonly<{
  draft: ShareDraft;
  circles: readonly CircleMembership[];
  onClose: () => void;
  onPosted: () => void;
}>) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const choices = postableCircles(circles);
  const [circleId, setCircleId] = useState(choices[0]?.circleId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const circle = choices.find((item) => item.circleId === circleId) ?? null;

  async function post() {
    const supabase = getSupabase();
    if (!supabase || !circle || busy) return;
    setBusy(true);
    setError(null);
    const occurredOn = circleToday(circle.timeZone);
    try {
      if (draft.kind === "link" || draft.kind === "text") {
        const saved = await createWrittenMoment(supabase, {
          journalPersonId: circle.personId,
          circleId: circle.circleId,
          body: draft.kind === "link" ? draft.url : draft.text,
          occurredOn,
          audience: "family",
          circleIds: [circle.circleId],
        });
        if (!saved.ok) {
          setError(saved.message);
          setBusy(false);
          return;
        }
      } else {
        let path = draft.path;
        let mimeType = draft.mimeType;
        if (shareNeedsJpeg(draft)) {
          const rendered = await ImageManipulator.manipulate(draft.path).renderAsync();
          const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
          path = saved.uri;
          mimeType = "image/jpeg";
        }
        const bytes = await new File(path).arrayBuffer();
        const common = {
          bytes,
          mimeType,
          circleId: circle.circleId,
          journalPersonId: circle.personId,
          body: "",
          occurredOn,
          audience: "family" as const,
          circleIds: [circle.circleId],
        };
        if (draft.kind === "video") {
          await uploadVideoMoment(supabase, {
            ...common,
            durationMs: draft.durationMs,
            name: draft.name,
          });
        } else {
          await uploadPhotoMoment(supabase, common);
        }
      }
      onPosted();
    } catch {
      setError("That share could not be added.");
      setBusy(false);
    }
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={busy ? undefined : onClose} />
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.cream,
            paddingBottom: Math.max(16, insets.bottom),
          },
        ]}
      >
        <Text style={[face(colors, 650), styles.title, { color: colors.ink }]}>
          Add to Our Days
        </Text>
        <Text style={[face(colors, 400), styles.preview, { color: colors.muted }]} numberOfLines={3}>
          {shareDraftLabel(draft)}
        </Text>
        <Text style={[face(colors, 600), styles.choose, { color: colors.ink }]}>
          Choose a circle
        </Text>
        {choices.length === 0 ? (
          <Text style={[face(colors, 400), { color: colors.muted }]}>
            Join a circle before sharing into Our Days.
          </Text>
        ) : (
          <View style={styles.chips}>
            {choices.map((item) => {
              const selected = item.circleId === circleId;
              return (
                <Pressable
                  key={item.circleId}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setCircleId(item.circleId)}
                  style={[
                    styles.chip,
                    {
                      borderColor: selected ? colors.action : colors.hairline,
                      backgroundColor: selected ? colors.selectionFill : "transparent",
                    },
                  ]}
                >
                  <Text style={[face(colors, 600), { color: colors.ink, fontSize: 14 }]}>
                    {item.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
        {error ? (
          <Text style={[face(colors, 400), { color: colors.clay }]}>{error}</Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Post shared entry"
          disabled={busy || !circle}
          onPress={() => void post()}
          style={[styles.post, { backgroundColor: colors.action, opacity: circle && !busy ? 1 : 0.5 }]}
        >
          {busy ? (
            <ActivityIndicator color={colors.actionInk} />
          ) : (
            <Text style={[face(colors, 650), { color: colors.actionInk, fontSize: 16 }]}>Post</Text>
          )}
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 10,
  },
  title: {
    fontSize: 18,
  },
  preview: {
    fontSize: 14,
    lineHeight: 20,
  },
  choose: {
    fontSize: 15,
    marginTop: 4,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  post: {
    minHeight: 48,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
});
