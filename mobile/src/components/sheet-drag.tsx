import { useEffect, useState, type RefObject } from "react";
import {
  Animated,
  Easing,
  Keyboard,
  PanResponder,
  View,
  type LayoutChangeEvent,
  type PanResponderGestureState,
} from "react-native";

import {
  canStartSheetDismiss,
  isSheetTouchingField,
  sheetDismissAxisPx,
  sheetDismissShouldCommit,
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
/** The gesture that put the keyboard away; it never moves the sheet too. */
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

function releaseGesture(translateY: Animated.Value, dy: number, vy: number) {
  const input = latestDrag;
  if (!input) return;
  const downward = Math.max(0, dy);
  const velocityY = Number.isFinite(vy) ? vy * 1000 : 0;
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
  const [responder] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (event, gesture) =>
        claimGesture(gesture, event.nativeEvent.pageY),
      onMoveShouldSetPanResponderCapture: (event, gesture) =>
        claimGesture(gesture, event.nativeEvent.pageY),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_event, gesture) => {
        translateY.setValue(Math.max(0, gesture.dy));
      },
      onPanResponderRelease: (_event, gesture) => {
        releaseGesture(translateY, gesture.dy, gesture.vy);
      },
      onPanResponderTerminate: (_event, gesture) => {
        releaseGesture(translateY, gesture.dy, gesture.vy);
      },
    }),
  );

  return { translateY, panHandlers: responder.panHandlers };
}

type ChromeDismissInput = {
  onCommit: RefObject<(actions: SheetDragActions) => void>;
};

type ChromeTouch = { nativeEvent: { pageX: number; pageY: number; timestamp: number } };

/** Gesture state and geometry live in this closure, outside render. */
function createChromeDismiss(input: ChromeDismissInput) {
  const translateY = new Animated.Value(0);
  const geometry = { node: null as View | null, top: 0, height: 320, chromeBottom: 64 };
  const drag = { tracking: false, active: false, x0: 0, y0: 0, dy: 0, lastY: 0, lastT: 0, vy: 0 };
  const measure = () => {
    geometry.node?.measureInWindow((_x, y) => {
      geometry.top = y;
    });
  };
  const finish = () => {
    const active = drag.active;
    drag.tracking = false;
    drag.active = false;
    if (!active) return;
    const downward = Math.max(0, drag.dy);
    const springBack = () => springToRest(translateY);
    if (!sheetDismissShouldCommit({ dy: downward, velocityY: drag.vy })) {
      springBack();
      return;
    }
    input.onCommit.current?.({
      springBack,
      dismiss: (done) => slideAway(translateY, Math.max(240, geometry.height + 48), done),
    });
  };
  // Raw touch events, not PanResponder: inside a React Native Modal on iOS the
  // responder system never offered the move to the sheet, so it did not move.
  const touchHandlers = {
    onTouchStart: (event: ChromeTouch) => {
      const { pageX, pageY, timestamp } = event.nativeEvent;
      const local = pageY - geometry.top;
      drag.tracking = local >= -12 && local <= geometry.chromeBottom;
      drag.active = false;
      drag.x0 = pageX;
      drag.y0 = pageY;
      drag.dy = 0;
      drag.lastY = pageY;
      drag.lastT = timestamp;
      drag.vy = 0;
    },
    onTouchMove: (event: ChromeTouch) => {
      if (!drag.tracking) return;
      const { pageX, pageY, timestamp } = event.nativeEvent;
      const dy = pageY - drag.y0;
      const dx = pageX - drag.x0;
      if (!drag.active) {
        if (dy < sheetDismissAxisPx || Math.abs(dx) > Math.abs(dy)) {
          if (dy < -sheetDismissAxisPx || Math.abs(dx) > sheetDismissAxisPx * 2) drag.tracking = false;
          return;
        }
        drag.active = true;
      }
      const elapsed = timestamp - drag.lastT;
      if (elapsed > 0) drag.vy = ((pageY - drag.lastY) / elapsed) * 1000;
      drag.lastY = pageY;
      drag.lastT = timestamp;
      drag.dy = dy;
      translateY.setValue(Math.max(0, dy));
    },
    onTouchEnd: finish,
    onTouchCancel: finish,
  };
  return {
    translateY,
    measure,
    sheetProps: {
      ref: (node: View | null) => {
        geometry.node = node;
      },
      collapsable: false,
      onLayout: (event: LayoutChangeEvent) => {
        geometry.height = event.nativeEvent.layout.height;
        measure();
      },
      ...touchHandlers,
    },
    chromeProps: {
      collapsable: false,
      onLayout: (event: LayoutChangeEvent) => {
        geometry.chromeBottom = event.nativeEvent.layout.y + event.nativeEvent.layout.height;
      },
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
  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", chrome.measure);
    const hidden = Keyboard.addListener("keyboardDidHide", chrome.measure);
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, [chrome]);
  return { translateY: chrome.translateY, sheetProps: chrome.sheetProps, chromeProps: chrome.chromeProps };
}
