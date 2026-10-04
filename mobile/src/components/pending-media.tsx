import { Image, type ImageStyle } from "expo-image";
import { useState, useSyncExternalStore } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { mediaMaxHeight } from "../lib/media-frame";
import {
  listPending,
  removePending,
  retryPending,
  subscribePending,
  type PendingMedia,
  type PendingUpload,
} from "../lib/pending-uploads";
import { useAppTheme } from "../lib/theme";
import { face } from "../lib/tokens";

/** The local photo stays dimmed until the upload is done. */
const dimmed = 0.55;

export function usePendingUploads() {
  return useSyncExternalStore(subscribePending, listPending, listPending);
}

function still(item: PendingMedia) {
  return item.kind === "photo" ? item.uri : item.posterUri;
}

/** Thin bar along the bottom edge of the photo. */
function ProgressBar({ progress }: Readonly<{ progress: number }>) {
  const { colors } = useAppTheme();
  return (
    <View
      style={[styles.track, { backgroundColor: "rgba(0,0,0,0.18)" }]}
      accessibilityRole="progressbar"
      accessibilityLabel="Uploading"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
    >
      <View
        style={[
          styles.bar,
          { width: `${Math.max(4, Math.round(progress * 100))}%`, backgroundColor: colors.action },
        ]}
      />
    </View>
  );
}

function FailedActions({ job, compact }: Readonly<{ job: PendingUpload; compact?: boolean }>) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.failed, compact ? styles.failedCompact : null]}>
      <Text
        style={[styles.failedTitle, face(colors, 650), { color: "#fff" }]}
        accessibilityRole="alert"
      >
        Upload failed
      </Text>
      {job.error && !compact ? (
        <Text style={[styles.failedDetail, face(colors, 400), { color: "rgba(255,255,255,0.86)" }]} numberOfLines={3}>
          {job.error}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry upload"
          onPress={() => void retryPending(job.id)}
          style={({ pressed }) => [styles.action, { backgroundColor: "#fff", opacity: pressed ? 0.7 : 1 }]}
          hitSlop={6}
        >
          <Text style={[styles.actionText, face(colors, 650), { color: "#111" }]}>Retry</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remove upload"
          onPress={() => removePending(job.id)}
          style={({ pressed }) => [
            styles.action,
            { borderWidth: 1, borderColor: "rgba(255,255,255,0.8)", opacity: pressed ? 0.7 : 1 },
          ]}
          hitSlop={6}
        >
          <Text style={[styles.actionText, face(colors, 650), { color: "#fff" }]}>Remove</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * The new post's own photos (or video still) while they upload: the feed card
 * shows them at once, dimmed, with a thin progress bar along the bottom.
 */
export function PendingPostMedia({ job }: Readonly<{ job: PendingUpload }>) {
  const { colors } = useAppTheme();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const [frameWidth, setFrameWidth] = useState(0);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [page, setPage] = useState(0);
  const first = job.media[0];
  const width = size?.width ?? first?.width ?? 4;
  const height = size?.height ?? first?.height ?? 3;
  const frame = {
    aspectRatio: width / height,
    maxHeight: mediaMaxHeight(viewportWidth, viewportHeight),
    backgroundColor: first?.kind === "video" ? "#050b08" : colors.cream,
  };
  const failed = job.state === "failed";
  const done = job.state === "done";
  return (
    <View
      style={[styles.frame, frame]}
      onLayout={(event) => setFrameWidth(event.nativeEvent.layout.width)}
      accessibilityLabel={failed ? "Upload failed" : done ? "Uploaded" : "Uploading post"}
    >
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEnabled={job.media.length > 1}
        onMomentumScrollEnd={(event) =>
          frameWidth > 0 && setPage(Math.round(event.nativeEvent.contentOffset.x / frameWidth))
        }
        style={StyleSheet.absoluteFill}
      >
        {job.media.map((item, index) => {
          const uri = still(item);
          return (
            <View key={`${item.uri}-${index}`} style={{ width: frameWidth || viewportWidth, height: "100%" }}>
              {uri ? (
                <View style={[styles.image, { opacity: done ? 1 : dimmed }]}>
                <Image
                  source={{ uri }}
                  style={styles.image as ImageStyle}
                  contentFit="contain"
                  onLoad={
                    index === 0
                      ? (event) => {
                          const { width: w, height: h } = event.source;
                          if (w > 0 && h > 0 && !first?.width) setSize({ width: w, height: h });
                        }
                      : undefined
                  }
                />
                </View>
              ) : (
                <Text style={[styles.placeholder, face(colors, 400, "record"), { color: colors.muted }]}>
                  {item.kind === "video" ? "Video" : "Photo"}
                </Text>
              )}
            </View>
          );
        })}
      </ScrollView>
      {job.media.length > 1 ? (
        <View style={styles.counter} pointerEvents="none">
          <Text style={[styles.counterText, face(colors, 600, "record")]}>
            {page + 1}/{job.media.length}
          </Text>
        </View>
      ) : null}
      {failed ? <FailedActions job={job} /> : done ? null : <ProgressBar progress={job.progress} />}
    </View>
  );
}

/** Photos added in Edit, on their post while they upload (or with Retry if they failed). */
export function PendingAddStrip({ momentId }: Readonly<{ momentId: string }>) {
  const { colors } = useAppTheme();
  const jobs = usePendingUploads().filter(
    (job) => job.mode === "add" && job.momentId === momentId && job.state !== "done",
  );
  if (jobs.length === 0) return null;
  return (
    <View style={styles.strip}>
      {jobs.map((job) => (
        <View key={job.id} style={styles.stripJob}>
          <View style={styles.thumbs}>
            {job.media.map((item, index) => {
              const uri = still(item);
              return (
                <View key={`${item.uri}-${index}`} style={[styles.thumb, { backgroundColor: colors.paper }]}>
                  {uri ? (
                    <View style={[styles.image, { opacity: dimmed }]}>
                      <Image source={{ uri }} style={styles.image as ImageStyle} contentFit="cover" />
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
          {job.state === "failed" ? (
            <View style={[styles.stripFailed, { backgroundColor: "rgba(17,17,17,0.82)" }]}>
              <FailedActions job={job} compact />
            </View>
          ) : (
            <ProgressBar progress={job.progress} />
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: "100%",
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  placeholder: {
    alignSelf: "center",
    marginTop: "30%",
    fontSize: 11,
  },
  track: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
  },
  bar: {
    height: 3,
  },
  counter: {
    position: "absolute",
    top: 10,
    right: 10,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  counterText: {
    color: "#fff",
    fontSize: 11,
  },
  failed: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 24,
    backgroundColor: "rgba(17,17,17,0.55)",
  },
  failedCompact: {
    position: "relative",
    backgroundColor: "transparent",
    paddingVertical: 10,
  },
  failedTitle: {
    fontSize: 15,
  },
  failedDetail: {
    fontSize: 13,
    textAlign: "center",
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 4,
  },
  action: {
    minHeight: 44,
    minWidth: 96,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  actionText: {
    fontSize: 15,
  },
  strip: {
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
  },
  stripJob: {
    borderRadius: 10,
    overflow: "hidden",
  },
  thumbs: {
    flexDirection: "row",
    gap: 4,
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 8,
    overflow: "hidden",
  },
  stripFailed: {
    marginTop: 6,
    borderRadius: 10,
  },
});
