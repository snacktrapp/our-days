import { useEffect, useRef, useState, type RefObject } from "react";
import {
  Animated,
  Easing,
  Keyboard,
  PanResponder,
  type LayoutChangeEvent,
  type PanResponderGestureState,
} from "react-native";

import {
  canStartSheetDismiss,
  isSheetTouchingField,
  releaseVelocity,
  sheetDismissAxisPx,
  sheetDismissShouldCommit,
  sheetFlickMinPx,
} from "../lib/sheet-dismiss";

type SheetDragActions = Readonly<{
  springBack: () => void;
  dismiss: (done: () => void) => void;
}>;

type DragInput = {
  scrollTop: RefObject<number>;
  chromeHeight: RefObject<number>;
  sheetTop: RefObject<number>;
  sheetHeight: RefObject<number>;
  onCommit: RefObject<(actions: SheetDragActions) => void>;
};

function springToRest(translateY: Animated.Value) {
  Animated.spring(translateY, {
    toValue: 0,
    useNativeDriver: true,
    friction: 7,
    tension: 80,
  }).start();
}

function slideAway(translateY: Animated.Value, distance: number, done: () => void) {
  Animated.timing(translateY, {
    toValue: distance,
    duration: 200,
    easing: Easing.in(Easing.ease),
    useNativeDriver: true,
  }).start(({ finished }) => {
    if (finished) done();
  });
}

let latestDrag: DragInput | null = null;
/** The touch that put the keyboard away; it never moves the sheet too. */
let keyboardGesture: number | null = null;

function claimGesture(gesture: PanResponderGestureState, pageY: number) {
  const input = latestDrag;
  if (!input) return false;
  const local = pageY - input.sheetTop.current;
  const fromChrome = local >= 0 && local <= input.chromeHeight.current;
  const downward =
    !isSheetTouchingField() &&
    gesture.dy >= sheetDismissAxisPx &&
    Math.abs(gesture.dx) <= Math.abs(gesture.dy);
  // With the keyboard up, pulling the form down puts the keyboard away first
  // (like Messages); only the grab bar or header moves the sheet.
  if (keyboardGesture === gesture.stateID) return false;
  if (downward && !fromChrome && Keyboard.isVisible()) {
    keyboardGesture = gesture.stateID;
    Keyboard.dismiss();
    return false;
  }
  return downward && canStartSheetDismiss(input.scrollTop.current, fromChrome);
}

function releaseGesture(
  translateY: Animated.Value,
  dy: number,
  vy: number,
  sampled: number,
) {
  const input = latestDrag;
  if (!input) return;
  const downward = Math.max(0, dy);
  // RN's vy reflects only the last move; the sampled speed covers the final
  // 80 ms, so a quick flick with one slow last frame still closes.
  const velocityY = Math.max(Number.isFinite(vy) ? vy * 1000 : 0, sampled);
  const springBack = () => springToRest(translateY);
  if (!sheetDismissShouldCommit({ dy: downward, velocityY })) {
    springBack();
    return;
  }
  input.onCommit.current?.({
    springBack,
    dismiss: (done) => slideAway(translateY, Math.max(240, input.sheetHeight.current + 48), done),
  });
}

/**
 * Drag the grab bar, the header, or the form when it is scrolled to the top.
 * A short drag springs back. A long drag or a downward flick closes the sheet.
 */
export function useSheetDrag(input: DragInput) {
  const [translateY] = useState(() => new Animated.Value(0));
  useEffect(() => {
    latestDrag = input;
    return () => {
      if (latestDrag === input) latestDrag = null;
    };
  });
  const [responder] = useState(() => {
    let samples: { y: number; t: number }[] = [];
    const record = (pageY: number, t: number) => {
      if (!Number.isFinite(pageY) || !Number.isFinite(t)) return;
      samples.push({ y: pageY, t });
      if (samples.length > 12) samples.shift();
    };
    const sampled = (t: number) => (Number.isFinite(t) ? releaseVelocity(samples, t) : 0);
    return PanResponder.create({
      // stateID never changes for a PanResponder, so forget the gesture that
      // lowered the keyboard when the next touch starts. Otherwise one
      // keyboard pull blocked every later drag on this sheet.
      onStartShouldSetPanResponderCapture: (event) => {
        keyboardGesture = null;
        samples = [];
        record(event.nativeEvent.pageY, event.nativeEvent.timestamp);
        return false;
      },
      onMoveShouldSetPanResponder: (event, gesture) =>
        claimGesture(gesture, event.nativeEvent.pageY),
      onMoveShouldSetPanResponderCapture: (event, gesture) => {
        record(event.nativeEvent.pageY, event.nativeEvent.timestamp);
        return claimGesture(gesture, event.nativeEvent.pageY);
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (event, gesture) => {
        record(event.nativeEvent.pageY, event.nativeEvent.timestamp);
        translateY.setValue(Math.max(0, gesture.dy));
      },
      onPanResponderRelease: (event, gesture) => {
        releaseGesture(translateY, gesture.dy, gesture.vy, sampled(event.nativeEvent.timestamp));
      },
      onPanResponderTerminate: (event, gesture) => {
        releaseGesture(translateY, gesture.dy, gesture.vy, sampled(event.nativeEvent.timestamp));
      },
    });
  });

  return { translateY, panHandlers: responder.panHandlers };
}

type ChromeDismissInput = {
  onCommit: RefObject<(actions: SheetDragActions) => void>;
};

type ChromeTouch = { nativeEvent: { pageX: number; pageY: number; timestamp: number } };

type DomTouchLike = {
  pageX?: number;
  pageY?: number;
  timestamp?: number;
  timeStamp?: number;
  changedTouches?: ArrayLike<{ pageX: number; pageY: number }>;
};

/**
 * iOS touch events carry pageX/pageY/timestamp directly. react-native-web
 * passes the DOM TouchEvent through, so read its changed touch instead; that
 * keeps the web proxy test of this gesture honest.
 */
function touchPoint(event: ChromeTouch) {
  const raw = event.nativeEvent as unknown as DomTouchLike;
  const touch = raw.changedTouches?.[0];
  return {
    pageX: raw.pageX ?? touch?.pageX ?? Number.NaN,
    pageY: raw.pageY ?? touch?.pageY ?? Number.NaN,
    timestamp: raw.timestamp ?? raw.timeStamp ?? Number.NaN,
  };
}

/** Gesture state and geometry live in this closure, outside render. */
function createChromeDismiss(input: ChromeDismissInput) {
  const translateY = new Animated.Value(0);
  const geometry = { height: 320 };
  const drag = {
    tracking: false,
    active: false,
    x0: 0,
    y0: 0,
    dy: 0,
    samples: [] as { y: number; t: number }[],
  };
  const record = (pageY: number, timestamp: number) => {
    drag.samples.push({ y: pageY, t: timestamp });
    if (drag.samples.length > 12) drag.samples.shift();
  };
  const finish = (event?: ChromeTouch) => {
    let active = drag.active;
    const tracking = drag.tracking;
    drag.tracking = false;
    drag.active = false;
    if (event && tracking) {
      // A fast flick can lift a few points past its last move, sometimes
      // before any move cleared the 8 pt slop. Count the lift point too.
      const { pageX, pageY, timestamp } = touchPoint(event);
      if (Number.isFinite(pageY) && Number.isFinite(pageX)) {
        const dy = pageY - drag.y0;
        const dx = pageX - drag.x0;
        if (!active && dy >= sheetFlickMinPx && Math.abs(dx) <= dy) active = true;
        if (active) drag.dy = Math.max(drag.dy, dy);
        if (timestamp > (drag.samples.at(-1)?.t ?? 0)) record(pageY, timestamp);
      }
    }
    if (!active) return;
    const releaseT = event?.nativeEvent.timestamp ?? drag.samples.at(-1)?.t ?? 0;
    const velocityY = releaseVelocity(drag.samples, releaseT);
    const downward = Math.max(0, drag.dy);
    const springBack = () => springToRest(translateY);
    if (!sheetDismissShouldCommit({ dy: downward, velocityY })) {
      springBack();
      return;
    }
    input.onCommit.current?.({
      springBack,
      dismiss: (done) => slideAway(translateY, Math.max(240, geometry.height + 48), done),
    });
  };
  // Raw touch events on the header, not PanResponder: inside a React Native
  // Modal on iOS the responder system never offered the move to the sheet.
  // A touch keeps reporting to the view it started in, so a drag that starts
  // on the header is followed all the way down.
  const touchHandlers = {
    onTouchStart: (event: ChromeTouch) => {
      const { pageX, pageY, timestamp } = touchPoint(event);
      drag.tracking = true;
      drag.active = false;
      drag.x0 = pageX;
      drag.y0 = pageY;
      drag.dy = 0;
      drag.samples = [];
      record(pageY, timestamp);
    },
    onTouchMove: (event: ChromeTouch) => {
      if (!drag.tracking) return;
      const { pageX, pageY, timestamp } = touchPoint(event);
      const dy = pageY - drag.y0;
      const dx = pageX - drag.x0;
      record(pageY, timestamp);
      if (!drag.active) {
        if (dy < sheetDismissAxisPx || Math.abs(dx) > Math.abs(dy)) {
          if (dy < -sheetDismissAxisPx || Math.abs(dx) > sheetDismissAxisPx * 2) drag.tracking = false;
          return;
        }
        drag.active = true;
      }
      drag.dy = dy;
      translateY.setValue(Math.max(0, dy));
    },
    onTouchEnd: (event: ChromeTouch) => finish(event),
    onTouchCancel: () => finish(),
  };
  return {
    translateY,
    sheetProps: {
      onLayout: (event: LayoutChangeEvent) => {
        geometry.height = event.nativeEvent.layout.height;
      },
    },
    chromeProps: {
      collapsable: false,
      ...touchHandlers,
    },
  };
}

/**
 * Swipe down on a sheet's grab bar or header to close it, whether or not the
 * keyboard is up. The rest of the sheet does not use this gesture.
 *
 * Spread `sheetProps` on the sheet's Animated.View and `chromeProps` on the
 * header View. Only drags that start inside the header move the sheet.
 */
export function useChromeDismiss(input: ChromeDismissInput) {
  const [chrome] = useState(() => createChromeDismiss(input));
  return { translateY: chrome.translateY, sheetProps: chrome.sheetProps, chromeProps: chrome.chromeProps };
}

/**
 * `useChromeDismiss` for sheets with nothing to confirm: a drag past the
 * threshold or a quick flick on the grab bar slides the sheet away, then
 * calls `onClose`.
 */
export function useGrabDismiss(onClose: () => void) {
  const onCommit = useRef<(actions: SheetDragActions) => void>(() => undefined);
  useEffect(() => {
    onCommit.current = ({ dismiss }) => dismiss(onClose);
  }, [onClose]);
  return useChromeDismiss({ onCommit });
}
