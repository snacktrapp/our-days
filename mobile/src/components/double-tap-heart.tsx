import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View, type GestureResponderEvent } from "react-native";

import { isPostDoubleTap, postTapSlopPx, type PostTap } from "../lib/conversation-state";
import { useAppTheme } from "../lib/theme";
import { HeartGlyph } from "./icons";

/**
 * Web `dispatchMomentHeart`: the card's conversation accepts a double-tap
 * heart only when it adds a new love (never removes one). Returns true when
 * it accepted, so the burst only plays then.
 */
export type MomentHeartBus = Readonly<{
  /** True when the conversation added a heart. */
  accept: () => boolean;
  register: (acceptor: (() => boolean) | null) => void;
}>;

export function createMomentHeartBus(): MomentHeartBus {
  let acceptor: (() => boolean) | null = null;
  return {
    accept: () => acceptor?.() ?? false,
    register: (next) => {
      acceptor = next;
    },
  };
}

export const MomentHeartContext = createContext<MomentHeartBus | null>(null);

/** Conversation registers here so a double tap on the card can heart the post. */
export function useMomentHeartAcceptor(accept: () => boolean) {
  const bus = useContext(MomentHeartContext);
  useEffect(() => {
    if (!bus) return;
    bus.register(accept);
    return () => bus.register(null);
  });
}

/**
 * Web DoubleTapPhoto / DoubleTapHeartText: two taps within 300 ms and 32 pt,
 * neither moving more than 10 pt, add a heart to the post. Touch events only
 * observe, so the album pager and the feed scroll keep their gestures; a
 * swipe moves past the slop and never counts as a tap. No single-tap action.
 * `burst`: "tap" draws the heart where the finger was (photos), "center"
 * draws it in the middle (written copy), like the web.
 */
export function DoubleTapHeart({
  children,
  burst,
}: Readonly<{ children: ReactNode; burst: "tap" | "center" }>) {
  const bus = useContext(MomentHeartContext);
  const origin = useRef({ x: 0, y: 0 });
  const box = useRef<View>(null);
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const last = useRef<PostTap | null>(null);
  const [shown, setShown] = useState<{ key: number; x: number; y: number } | null>(null);

  // The touch that changed (iOS also mirrors it on nativeEvent; the browser
  // build only has it in changedTouches).
  const point = (event: GestureResponderEvent) => {
    const touch = event.nativeEvent.changedTouches?.[0] ?? event.nativeEvent;
    return { x: touch.pageX, y: touch.pageY };
  };

  return (
    <View
      ref={box}
      onTouchStart={(event) => {
        if (event.nativeEvent.touches.length > 1) {
          start.current = null;
          last.current = null;
          return;
        }
        start.current = { ...point(event), moved: false };
        box.current?.measureInWindow((x, y) => {
          origin.current = { x, y };
        });
      }}
      onTouchMove={(event) => {
        const current = start.current;
        if (!current) return;
        const p = point(event);
        if (event.nativeEvent.touches.length > 1 || Math.hypot(p.x - current.x, p.y - current.y) > postTapSlopPx) {
          current.moved = true;
        }
      }}
      onTouchCancel={() => {
        start.current = null;
        last.current = null;
      }}
      onTouchEnd={(event) => {
        const current = start.current;
        start.current = null;
        const p = point(event);
        if (!current || current.moved || Math.hypot(p.x - current.x, p.y - current.y) > postTapSlopPx) {
          last.current = null;
          return;
        }
        const tap = { t: Date.now(), x: p.x, y: p.y };
        if (!isPostDoubleTap(last.current, tap)) {
          last.current = tap;
          return;
        }
        last.current = null;
        if (!bus?.accept()) return;
        setShown({ key: tap.t, x: p.x - origin.current.x, y: p.y - origin.current.y });
      }}
    >
      {children}
      {shown ? (
        <LoveBurst
          key={shown.key}
          at={burst === "tap" ? shown : null}
          onDone={() => setShown(null)}
        />
      ) : null}
    </View>
  );
}

const burstSize = 54;

/** Web `.post-love-burst`: 54 px filled heart, 600 ms, hidden with Reduce Motion. */
function LoveBurst({
  at,
  onDone,
}: Readonly<{ at: { x: number; y: number } | null; onDone: () => void }>) {
  const { colors } = useAppTheme();
  const [t] = useState(() => new Animated.Value(0));
  const [visible, setVisible] = useState(false);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled) return;
      if (reduced) {
        done.current();
        return;
      }
      setVisible(true);
      Animated.timing(t, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start(() => {
        if (!cancelled) done.current();
      });
    });
    return () => {
      cancelled = true;
    };
  }, [t]);
  if (!visible) return null;
  const opacity = t.interpolate({ inputRange: [0, 0.2, 0.65, 1], outputRange: [0, 1, 1, 0] });
  const scale = t.interpolate({ inputRange: [0, 0.2, 0.65, 1], outputRange: [0.6, 1, 1, 1.05] });
  const lift = t.interpolate({ inputRange: [0, 0.65, 1], outputRange: [0, 0, -burstSize * 0.15] });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.burst,
        at
          ? { left: at.x - burstSize / 2, top: at.y - burstSize / 2 }
          : { left: "50%", top: "50%", marginLeft: -burstSize / 2, marginTop: -burstSize / 2 },
        { opacity, transform: [{ translateY: lift }, { scale }] },
      ]}
    >
      <HeartGlyph color={colors.clay} filled size={burstSize} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  burst: {
    position: "absolute",
    zIndex: 2,
    width: burstSize,
    height: burstSize,
    shadowColor: "#000",
    shadowOpacity: 0.33,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
});
