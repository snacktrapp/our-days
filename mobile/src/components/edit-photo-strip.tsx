import { Image, type ImageStyle } from "expo-image";
import { useEffect, useLayoutEffect, useState } from "react";
import { AccessibilityInfo, Animated, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { liftHaptic, slotHaptic } from "../lib/haptics";
import { photoDeliveryPath } from "../lib/journal";
import type { EditPhoto } from "../lib/moment-edit";
import { maximumMomentPhotos, type MediaSource } from "../lib/pick-media";
import { mediaUrl } from "../lib/supabase";
import { dragSlot, makeRoomOffset } from "../lib/thumb-reorder";
import { useAppTheme } from "../lib/theme";
import { face } from "../lib/tokens";
import { MediaChooser } from "./media-chooser";

const thumb = 72;
const gap = 8;

const step = thumb + gap;

type TouchLike = Readonly<{ pageX?: number; touches?: readonly { pageX: number }[] }>;

/** iOS puts pageX on the event; react-native-web only on its touches. */
function touchX(event: TouchLike) {
  return event.pageX ?? event.touches?.[0]?.pageX ?? 0;
}
const lifted = 1.08;

/**
 * Touch-and-hold a thumbnail, then drag it sideways (web drag-and-drop on
 * `.composer-photo-thumb`). The other thumbs spring aside live to open a gap,
 * like rearranging the iOS Home Screen, and the drop settles into that gap.
 * Raw touch events, not PanResponder (see sheet-drag). Gesture state lives in
 * this closure, outside render, like album-pager.
 */
function createThumbDrag(onDragging: (index: number | null) => void) {
  const x = new Animated.Value(0);
  const scale = new Animated.Value(1);
  const offsets = new Map<string, Animated.Value>();
  const state = {
    index: null as number | null,
    slot: 0,
    startX: 0,
    dx: 0,
    keys: [] as readonly string[],
    reduced: false,
    move: (_from: number, _to: number) => undefined as void,
  };
  function offset(key: string) {
    let value = offsets.get(key);
    if (!value) {
      value = new Animated.Value(0);
      offsets.set(key, value);
    }
    return value;
  }
  function glide(value: Animated.Value, toValue: number, done?: () => void) {
    if (state.reduced) {
      value.setValue(toValue);
      done?.();
      return;
    }
    Animated.spring(value, {
      toValue,
      useNativeDriver: true,
      stiffness: 380,
      damping: 30,
      mass: 1,
      restDisplacementThreshold: 0.5,
      restSpeedThreshold: 4,
    }).start(({ finished }) => {
      if (finished) done?.();
    });
  }
  function makeRoom(from: number, to: number) {
    state.keys.forEach((key, index) => glide(offset(key), makeRoomOffset(index, from, to, step)));
  }
  function reset() {
    x.setValue(0);
    scale.setValue(1);
    offsets.forEach((value) => value.setValue(0));
  }
  return {
    x,
    scale,
    offset,
    reset,
    update(keys: readonly string[], move: (from: number, to: number) => void) {
      state.keys = keys;
      state.move = move;
    },
    setReduced(reduced: boolean) {
      state.reduced = reduced;
    },
    touchStart(pageX: number) {
      if (state.index == null) state.startX = pageX;
    },
    /** Long press picked this thumb up; moves from here drag it. */
    lift(index: number) {
      state.index = index;
      state.slot = index;
      state.dx = 0;
      x.setValue(0);
      liftHaptic();
      if (!state.reduced) glide(scale, lifted);
      onDragging(index);
    },
    touchMove(index: number, pageX: number) {
      if (state.index !== index) return;
      state.dx = pageX - state.startX;
      x.setValue(state.dx);
      const slot = dragSlot(index, state.dx, state.keys.length, step);
      if (slot !== state.slot) {
        state.slot = slot;
        slotHaptic();
        makeRoom(index, slot);
      }
    },
    touchEnd(index: number) {
      if (state.index !== index) return;
      const from = index;
      const to = state.slot;
      state.index = null;
      glide(scale, 1);
      // Settle into the gap, then commit the order. The layout effect zeroes
      // every offset in the same commit, so nothing jumps.
      glide(x, (to - from) * step, () => {
        if (to !== from) state.move(from, to);
        else reset();
        onDragging(null);
      });
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
  const order = photos.map((photo) => photo.key).join(",");
  useEffect(() => {
    gesture.update(
      photos.map((photo) => photo.key),
      onMove,
    );
  });
  useLayoutEffect(() => {
    gesture.reset();
  }, [gesture, order]);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => gesture.setReduced(reduced));
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (reduced) =>
      gesture.setReduced(reduced),
    );
    return () => subscription.remove();
  }, [gesture]);
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
            onTouchStart={(event) => gesture.touchStart(touchX(event.nativeEvent))}
            onTouchMove={(event) => gesture.touchMove(index, touchX(event.nativeEvent))}
            onTouchEnd={() => gesture.touchEnd(index)}
            onTouchCancel={() => gesture.touchEnd(index)}
            style={[
              styles.slot,
              dragging === index
                ? [styles.lifted, { transform: [{ translateX: gesture.x }, { scale: gesture.scale }] }]
                : { transform: [{ translateX: gesture.offset(photo.key) }] },
            ]}
          >
            <View style={styles.thumb}>
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
            </View>
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
  strip: { gap, paddingVertical: 6 },
  slot: { width: thumb, height: thumb },
  lifted: {
    zIndex: 3,
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
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
