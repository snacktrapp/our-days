import { useContext, useEffect, useState } from "react";
import { Animated, Easing, PanResponder, StyleSheet, View } from "react-native";

import {
  albumFrameHeight,
  albumFrameHeightRatio,
  albumSlideMs,
  albumSwipeStep,
  swipeAxis,
  wrapIndex,
} from "../lib/album-frame";
import { FeedScrollLock } from "../lib/feed-scroll-lock";
import { useAppTheme } from "../lib/theme";
import { PrivateImage } from "./private-image";

type AlbumPhoto = Readonly<{ id: string; width?: number; height?: number }>;

/** Gesture state lives in this closure, outside render (see sheet-drag.tsx). */
function createAlbumGesture(onPos: (pos: number) => void) {
  const x = new Animated.Value(0);
  const state = { pos: 0, width: 0, count: 0, busy: false };
  let lockFeed: ((locked: boolean) => void) | null = null;
  let feedLocked = false;
  const setFeedLocked = (locked: boolean) => {
    if (feedLocked === locked) return;
    feedLocked = locked;
    lockFeed?.(locked);
  };
  // PanResponder keeps one stateID for its whole life, so the axis lock is
  // reset at each touch start instead of keyed by stateID.
  const lock = { axis: null as "x" | "y" | null };

  function settle(step: -1 | 0 | 1) {
    const next = state.pos - step;
    state.busy = true;
    Animated.timing(x, {
      toValue: -next * state.width,
      duration: albumSlideMs,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      state.busy = false;
      if (next !== state.pos) {
        state.pos = next;
        onPos(next);
      }
    });
  }

  /** The axis locks once, when the finger first leaves the slop box. */
  function claims(dx: number, dy: number) {
    if (state.busy || state.count < 2) return false;
    if (lock.axis == null) lock.axis = swipeAxis(dx, dy);
    return lock.axis === "x";
  }

  const responder = PanResponder.create({
    onStartShouldSetPanResponderCapture: () => {
      lock.axis = null;
      // Safety net: a gesture that never reported its end must not leave
      // the feed unable to scroll.
      setFeedLocked(false);
      return false;
    },
    onMoveShouldSetPanResponderCapture: (_event, g) => claims(g.dx, g.dy),
    onMoveShouldSetPanResponder: (_event, g) => claims(g.dx, g.dy),
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: () => setFeedLocked(true),
    onPanResponderMove: (_event, g) => {
      const dx = Math.max(-state.width, Math.min(state.width, g.dx));
      x.setValue(-state.pos * state.width + dx);
    },
    onPanResponderRelease: (_event, g) => {
      setFeedLocked(false);
      settle(albumSwipeStep(g.dx, g.vx * 1000));
    },
    onPanResponderTerminate: () => {
      setFeedLocked(false);
      settle(0);
    },
  });

  return {
    x,
    panHandlers: responder.panHandlers,
    resize(width: number, count: number) {
      state.width = width;
      state.count = count;
      x.setValue(-state.pos * width);
    },
    setLock(next: ((locked: boolean) => void) | null) {
      if (feedLocked && lockFeed && lockFeed !== next) lockFeed(false);
      lockFeed = next;
      if (feedLocked) next?.(true);
    },
    release() {
      setFeedLocked(false);
    },
    step(direction: -1 | 1) {
      if (!state.busy && state.count > 1) settle(direction);
    },
  };
}

/**
 * Multi-photo album, matching the web pager (PRs #197 and #199):
 * - one fixed frame sized to the tallest photo, capped at 3:4;
 * - every photo contained inside it, bars in the theme background;
 * - a swipe within 45° of horizontal pages once it leaves the 8 px slop box,
 *   steeper swipes are left to the feed's vertical scroll;
 * - paging wraps from the last photo to the first, like the web.
 *
 * Slots are keyed by an unbounded position, so a finished slide never moves a
 * mounted image (no flash when the index changes).
 */
export function AlbumPager({
  photos,
  pathFor,
  label,
  headers,
  frameWidth,
}: Readonly<{
  photos: readonly AlbumPhoto[];
  pathFor: (photoId: string) => string;
  label: string;
  headers?: Record<string, string> | null;
  frameWidth: number;
}>) {
  const { colors } = useAppTheme();
  const [pos, setPos] = useState(0);
  const [fallbackRatio, setFallbackRatio] = useState<number | null>(null);
  const [gesture] = useState(() => createAlbumGesture(setPos));
  const { x } = gesture;

  const lockFeed = useContext(FeedScrollLock);

  useEffect(() => {
    gesture.resize(frameWidth, photos.length);
  }, [frameWidth, photos.length, gesture]);

  useEffect(() => {
    gesture.setLock(lockFeed);
  }, [gesture, lockFeed]);

  // Never leave the feed locked if the card unmounts mid-swipe.
  useEffect(() => () => gesture.release(), [gesture]);

  const hasStoredRatio = albumFrameHeightRatio(photos) != null;
  const height = albumFrameHeight(frameWidth, photos, fallbackRatio);
  const index = wrapIndex(pos, photos.length);

  const slots = [pos - 1, pos, pos + 1];
  return (
    <View
      style={[styles.frame, { height, backgroundColor: colors.cream }]}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: `Photo ${index + 1} of ${photos.length}` }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "increment") gesture.step(-1);
        if (event.nativeEvent.actionName === "decrement") gesture.step(1);
      }}
      {...gesture.panHandlers}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: x }] }]}>
        {slots.map((slot) => {
          const photo = photos[wrapIndex(slot, photos.length)];
          return (
            <View
              key={slot}
              style={[styles.slot, { left: slot * frameWidth, width: frameWidth, height }]}
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
            >
              <PrivateImage
                path={pathFor(photo.id)}
                width={photo.width}
                height={photo.height}
                label={label}
                headers={headers}
                frameWidth={frameWidth}
                frameHeight={height}
                onSize={
                  !hasStoredRatio && fallbackRatio == null && slot === 0
                    ? (w, h) => setFallbackRatio(h / w)
                    : undefined
                }
              />
            </View>
          );
        })}
      </Animated.View>
      <View style={styles.dots} pointerEvents="none">
        {photos.map((item, dot) => (
          <View
            key={item.id}
            style={[
              styles.dot,
              { backgroundColor: dot === index ? "#fffaf0" : "rgba(255, 250, 240, 0.45)" },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: "100%",
    overflow: "hidden",
  },
  slot: {
    position: "absolute",
    top: 0,
  },
  /** globals.css .photo-card-pager-dots */
  dots: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 10,
    flexDirection: "row",
    justifyContent: "center",
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 999,
  },
});
