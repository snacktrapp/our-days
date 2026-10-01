import { useEffect, useState, type RefObject } from "react";
import { Animated, Easing, Keyboard, PanResponder, type PanResponderGestureState } from "react-native";

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
  sheetHeight: RefObject<number>;
  onCommit: RefObject<(actions: SheetDragActions) => void>;
};

function finishChromeDrag(
  translateY: Animated.Value,
  input: ChromeDismissInput,
  dy: number,
  vy: number,
) {
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
 * Swipe down on a sheet's grab bar or header to close it, whether or not the
 * keyboard is up. The rest of the sheet does not use this gesture.
 */
export function useChromeDismiss(input: ChromeDismissInput) {
  const [translateY] = useState(() => new Animated.Value(0));
  const [responder] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        gesture.dy >= sheetDismissAxisPx && Math.abs(gesture.dx) <= Math.abs(gesture.dy),
      onMoveShouldSetPanResponderCapture: (_event, gesture) =>
        gesture.dy >= sheetDismissAxisPx && Math.abs(gesture.dx) <= Math.abs(gesture.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_event, gesture) => {
        translateY.setValue(Math.max(0, gesture.dy));
      },
      onPanResponderRelease: (_event, gesture) => {
        finishChromeDrag(translateY, input, gesture.dy, gesture.vy);
      },
      onPanResponderTerminate: (_event, gesture) => {
        finishChromeDrag(translateY, input, gesture.dy, gesture.vy);
      },
    }),
  );
  return { translateY, panHandlers: responder.panHandlers };
}
