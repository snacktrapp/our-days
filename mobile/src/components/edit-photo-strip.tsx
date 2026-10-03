import { Image, type ImageStyle } from "expo-image";
import { useEffect, useState } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { photoDeliveryPath } from "../lib/journal";
import type { EditPhoto } from "../lib/moment-edit";
import { maximumMomentPhotos, type MediaSource } from "../lib/pick-media";
import { mediaUrl } from "../lib/supabase";
import { useAppTheme } from "../lib/theme";
import { face } from "../lib/tokens";
import { MediaChooser } from "./media-chooser";

const thumb = 72;
const gap = 8;

/**
 * Touch-and-hold a thumbnail, then drag it sideways (web drag-and-drop on
 * `.composer-photo-thumb`). Raw touch events, not PanResponder: responder
 * moves do not reach views inside the sheet's Modal on iOS (see sheet-drag).
 * Gesture state lives in this closure, outside render, like album-pager.
 */
function createThumbDrag(onDragging: (index: number | null) => void) {
  const x = new Animated.Value(0);
  const state = {
    index: null as number | null,
    startX: 0,
    dx: 0,
    count: 0,
    move: (_from: number, _to: number) => undefined as void,
  };
  function finish() {
    const from = state.index;
    const dx = state.dx;
    state.index = null;
    state.dx = 0;
    onDragging(null);
    x.setValue(0);
    if (from == null) return;
    const to = Math.max(0, Math.min(state.count - 1, from + Math.round(dx / (thumb + gap))));
    if (to !== from) state.move(from, to);
  }
  return {
    x,
    update(count: number, move: (from: number, to: number) => void) {
      state.count = count;
      state.move = move;
    },
    touchStart(pageX: number) {
      if (state.index == null) state.startX = pageX;
    },
    /** Long press picked this thumb up; moves from here drag it. */
    lift(index: number) {
      state.index = index;
      state.dx = 0;
      x.setValue(0);
      onDragging(index);
    },
    touchMove(index: number, pageX: number) {
      if (state.index !== index) return;
      state.dx = pageX - state.startX;
      x.setValue(state.dx);
    },
    touchEnd(index: number) {
      if (state.index === index) finish();
    },
  };
}

/** Web `.composer-photo-preview` / `.composer-photo-strip` in Edit. */
export function EditPhotoStrip({
  momentId,
  headers,
  photos,
  onRemove,
  onMove,
  onAdd,
}: Readonly<{
  momentId: string;
  headers?: Record<string, string> | null;
  photos: readonly EditPhoto[];
  onRemove: (key: string) => void;
  onMove: (from: number, to: number) => void;
  onAdd: (source: MediaSource) => void;
}>) {
  const { colors } = useAppTheme();
  const [dragging, setDragging] = useState<number | null>(null);
  const [gesture] = useState(() => createThumbDrag(setDragging));
  useEffect(() => {
    gesture.update(photos.length, onMove);
  });
  const dragX = gesture.x;
  const first = photos[0];
  const removable = photos.length > 1;

  if (!first) return null;
  return (
    <View style={styles.stack}>
      <View style={[styles.preview, { backgroundColor: "#e9e2d7" }]}>
        <PhotoFill momentId={momentId} headers={headers} photo={first} label="Selected photo preview" />
        {removable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Remove photo"
            onPress={() => onRemove(first.key)}
            style={styles.removePill}
          >
            <Text style={[face(colors, 400), styles.removePillText]}>Remove photo</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        horizontal
        scrollEnabled={dragging == null}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
        accessibilityRole="list"
      >
        {photos.map((photo, index) => (
          <Animated.View
            key={photo.key}
            onTouchStart={(event) => gesture.touchStart(event.nativeEvent.pageX)}
            onTouchMove={(event) => gesture.touchMove(index, event.nativeEvent.pageX)}
            onTouchEnd={() => gesture.touchEnd(index)}
            onTouchCancel={() => gesture.touchEnd(index)}
            style={[
              styles.thumb,
              dragging === index
                ? { zIndex: 3, opacity: 0.9, transform: [{ translateX: dragX }, { scale: 1.06 }] }
                : null,
            ]}
          >
            <Pressable
              accessibilityRole="image"
              accessibilityLabel={`Photo ${index + 1} of ${photos.length}`}
              accessibilityHint={photos.length > 1 ? "Touch and hold, then drag to reorder" : undefined}
              accessibilityActions={[
                ...(index > 0 ? [{ name: "moveLeft", label: "Move left" }] : []),
                ...(index < photos.length - 1 ? [{ name: "moveRight", label: "Move right" }] : []),
              ]}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === "moveLeft") onMove(index, index - 1);
                if (event.nativeEvent.actionName === "moveRight") onMove(index, index + 1);
              }}
              delayLongPress={250}
              onLongPress={() => {
                if (photos.length > 1) gesture.lift(index);
              }}
              style={styles.fill}
            >
              <PhotoFill
                momentId={momentId}
                headers={headers}
                photo={photo}
                label={`Photo ${index + 1} of ${photos.length}`}
              />
            </Pressable>
            {removable ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove photo ${index + 1}`}
                hitSlop={6}
                onPress={() => onRemove(photo.key)}
                style={styles.remove}
              >
                <Text style={styles.removeGlyph}>×</Text>
              </Pressable>
            ) : null}
          </Animated.View>
        ))}
        {photos.length < maximumMomentPhotos ? (
          <MediaChooser
            accessibilityLabel="Add photo"
            onPick={onAdd}
            style={({ pressed }) => [
              styles.thumb,
              styles.add,
              {
                borderColor: colors.action,
                backgroundColor: pressed ? colors.selectionFill : colors.cream,
              },
            ]}
          >
            <Text style={[face(colors, 700), styles.addText, { color: colors.muted }]}>Add photo</Text>
          </MediaChooser>
        ) : null}
      </ScrollView>
    </View>
  );
}

function PhotoFill({
  momentId,
  headers,
  photo,
  label,
}: Readonly<{
  momentId: string;
  headers?: Record<string, string> | null;
  photo: EditPhoto;
  label: string;
}>) {
  if (photo.picked) {
    return (
      <Image
        source={{ uri: photo.picked.previewUri }}
        style={StyleSheet.absoluteFill as ImageStyle}
        contentFit="cover"
        accessibilityLabel={label}
      />
    );
  }
  const path = photoDeliveryPath(momentId, photo.existingPhotoId);
  if (!headers) return null;
  return (
    <Image
      source={{ uri: mediaUrl(path), headers, cacheKey: path }}
      style={StyleSheet.absoluteFill as ImageStyle}
      contentFit="cover"
      cachePolicy="memory-disk"
      accessibilityLabel={label}
    />
  );
}

const styles = StyleSheet.create({
  stack: { gap: 10 },
  preview: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: 16,
    overflow: "hidden",
  },
  removePill: {
    position: "absolute",
    right: 8,
    bottom: 8,
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(36,31,27,0.88)",
  },
  removePillText: { color: "#fffaf0", fontSize: 11 },
  strip: { gap, paddingBottom: 4 },
  thumb: {
    width: thumb,
    height: thumb,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#e9e2d7",
  },
  fill: { flex: 1 },
  remove: {
    position: "absolute",
    top: 2,
    right: 2,
    zIndex: 2,
    minWidth: 28,
    minHeight: 28,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(36,31,27,0.82)",
  },
  removeGlyph: { color: "#fffaf0", fontSize: 16, lineHeight: 18 },
  add: {
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  addText: { fontSize: 11, textAlign: "center" },
});
