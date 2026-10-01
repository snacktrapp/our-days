import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { BlurView } from "expo-blur";
import {
  Dimensions,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { adjacentComposerField } from "../lib/composer-keyboard";
import { setSheetTouchingField } from "../lib/sheet-dismiss";
import { useAppTheme } from "../lib/theme";
import { fontInterface, fontWeight } from "../lib/tokens";

export const composerAccessoryId = "our-days-composer-accessory";
const keyboardBarHeight = 44;

/** Drag the composer to dismiss the keyboard. iOS tracks the finger; other platforms dismiss on drag. */
export const composerKeyboardDismissMode = Platform.OS === "ios" ? "interactive" : "on-drag";

type FocusFn = () => void;

type KeyboardFormValue = Readonly<{
  register: (id: string, focus: FocusFn) => () => void;
  onFieldFocus: (id: string, node: TextInput | null) => void;
  submit: (id: string) => void;
  dismiss: () => void;
  scrollRef: RefObject<ScrollView | null>;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}>;

const KeyboardFormContext = createContext<KeyboardFormValue | null>(null);
const FieldOrderContext = createContext<readonly string[]>([]);

function useKeyboardForm() {
  return useContext(KeyboardFormContext);
}

export function useDismissKeyboard() {
  const form = useKeyboardForm();
  return form?.dismiss ?? Keyboard.dismiss;
}

export function DismissKeyboardPressable({
  children,
  style,
  accessible = true,
}: Readonly<{ children: ReactNode; style?: StyleProp<ViewStyle>; accessible?: boolean }>) {
  const dismiss = useDismissKeyboard();
  return (
    <Pressable accessible={accessible} style={style} onPress={dismiss}>
      {children}
    </Pressable>
  );
}

export function useComposerInput(id: string, multiline = false) {
  const form = useKeyboardForm();
  const ids = useContext(FieldOrderContext);
  const ref = useRef<TextInput>(null);
  useEffect(() => {
    if (!form) return;
    return form.register(id, () => ref.current?.focus());
  }, [form, id]);
  const last = adjacentComposerField(ids, id, 1) == null;
  return {
    ref,
    onFocus: () => form?.onFieldFocus(id, ref.current),
    onTouchStart: () => setSheetTouchingField(true),
    onTouchEnd: () => setSheetTouchingField(false),
    onTouchCancel: () => setSheetTouchingField(false),
    ...(multiline
      ? { scrollEnabled: false as const }
      : {
          returnKeyType: last ? ("done" as const) : ("next" as const),
          submitBehavior: "submit" as const,
          onSubmitEditing: () => form?.submit(id),
        }),
  };
}

export function KeyboardForm({ children }: Readonly<{ children: ReactNode }>) {
  const order = useRef<{ id: string; focus: FocusFn }[]>([]);
  const [ids, setIds] = useState<readonly string[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focusedNode = useRef<TextInput | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const keyboardTop = useRef(Dimensions.get("window").height);
  // InputAccessoryView never appears on iOS 27 with the new architecture, so
  // the ✓ bar is drawn here, pinned to the top of the keyboard.
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const publish = useCallback(() => {
    const next = order.current.map((entry) => entry.id);
    setIds((current) =>
      current.length === next.length && current.every((id, index) => id === next[index])
        ? current
        : next,
    );
  }, []);

  const reveal = useCallback((node: TextInput | null) => {
    if (!node) return;
    node.measureInWindow((_x, y, _width, height) => {
      const covered = y + height + 12 - keyboardTop.current;
      if (covered <= 0) return;
      scrollRef.current?.scrollTo({
        y: scrollY.current + covered,
        animated: true,
      });
    });
  }, []);

  const dismiss = useCallback(() => {
    focusedNode.current?.blur();
    Keyboard.dismiss();
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (event) => {
      keyboardTop.current =
        event.endCoordinates.screenY - (Platform.OS === "ios" ? keyboardBarHeight : 0);
      setKeyboardHeight(event.endCoordinates.height);
      reveal(focusedNode.current);
    });
    const hide = Keyboard.addListener(hideEvent, () => {
      keyboardTop.current = Dimensions.get("window").height;
      setKeyboardHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [reveal]);

  const onFieldFocus = useCallback(
    (id: string, node: TextInput | null) => {
      setFocusedId(id);
      focusedNode.current = node;
      requestAnimationFrame(() => reveal(node));
      setTimeout(() => reveal(focusedNode.current), 280);
    },
    [reveal],
  );

  const register = useCallback(
    (id: string, focus: FocusFn) => {
      const existing = order.current.find((entry) => entry.id === id);
      if (existing) existing.focus = focus;
      else order.current = [...order.current, { id, focus }];
      publish();
      return () => {
        order.current = order.current.filter((entry) => entry.id !== id);
        publish();
      };
    },
    [publish],
  );

  const focusId = useCallback((id: string | null) => {
    if (!id) return;
    order.current.find((entry) => entry.id === id)?.focus();
  }, []);

  const submit = useCallback(
    (id: string) => {
      const next = adjacentComposerField(
        order.current.map((entry) => entry.id),
        id,
        1,
      );
      if (!next) {
        dismiss();
        return;
      }
      focusId(next);
    },
    [dismiss, focusId],
  );

  const value = useMemo<KeyboardFormValue>(
    () => ({
      register,
      onFieldFocus,
      submit,
      dismiss,
      scrollRef,
      onScroll: (event) => {
        scrollY.current = event.nativeEvent.contentOffset.y;
      },
    }),
    [dismiss, onFieldFocus, register, submit],
  );

  // InputAccessoryView never appears on iOS 27, so the bar stays a plain view
  // pinned to the top of the keyboard. On web, a focused field is enough.
  const showBar = Platform.OS === "ios" ? keyboardHeight > 0 : focusedId != null || keyboardHeight > 0;

  return (
    <KeyboardFormContext.Provider value={value}>
      <FieldOrderContext.Provider value={ids}>
      {children}
      {showBar ? (
        <View pointerEvents="box-none" style={[styles.barDock, { bottom: keyboardHeight }]}>
          <ComposerKeyboardBar onDone={dismiss} />
        </View>
      ) : null}
      </FieldOrderContext.Provider>
    </KeyboardFormContext.Provider>
  );
}

/** Same Done bar for sheets that are not the new-entry composer. */
export function KeyboardDoneBar() {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [webFocused, setWebFocused] = useState(false);
  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const onFocus = (event: Event) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") setWebFocused(true);
    };
    const onBlur = (event: FocusEvent) => {
      const next = event.relatedTarget as HTMLElement | null;
      const tag = next?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      setWebFocused(false);
    };
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onBlur);
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onBlur);
    };
  }, []);
  const visible = Platform.OS === "ios" ? keyboardHeight > 0 : webFocused || keyboardHeight > 0;
  if (!visible) return null;
  return (
    <View pointerEvents="box-none" style={[styles.barDock, { bottom: keyboardHeight }]}>
      <ComposerKeyboardBar onDone={() => Keyboard.dismiss()} />
    </View>
  );
}

export function ComposerScroller({
  children,
  contentStyle,
  onOffset,
}: Readonly<{
  children: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  onOffset?: (y: number) => void;
}>) {
  const form = useKeyboardForm();
  const dismiss = form?.dismiss ?? Keyboard.dismiss;
  return (
    <ScrollView
      ref={form?.scrollRef}
      testID="composer-form"
      style={styles.scroller}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={composerKeyboardDismissMode}
      automaticallyAdjustKeyboardInsets
      bounces={false}
      overScrollMode="never"
      onScroll={(event) => {
        form?.onScroll(event);
        onOffset?.(event.nativeEvent.contentOffset.y);
      }}
      scrollEventThrottle={16}
    >
      <View style={[styles.fill, contentStyle]}>
        <Pressable
          accessible={false}
          style={styles.dismissBackdrop}
          onPress={dismiss}
        />
        <View pointerEvents="box-none" style={styles.fill}>
          {children}
        </View>
      </View>
    </ScrollView>
  );
}

/** Minimal keyboard accessory: one right-aligned Done control. */
export function ComposerKeyboardBar({ onDone }: Readonly<{ onDone: () => void }>) {
  const { colors } = useAppTheme();
  const dark = colors.scheme === "dark" || colors.appearance === "retro";
  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: dark ? "rgba(28,28,30,0.78)" : "rgba(249,249,250,0.82)" },
      ]}
    >
      {Platform.OS === "ios" ? (
        <BlurView
          pointerEvents="none"
          intensity={80}
          tint={dark ? "dark" : "light"}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Done"
        onPress={onDone}
        onPressIn={onDone}
        style={styles.doneHit}
      >
        <Text
          style={{
            fontFamily: fontInterface,
            fontWeight: fontWeight(600),
            fontSize: 17,
            lineHeight: 22,
            color: colors.action,
          }}
        >
          Done
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  scroller: { flex: 1, minHeight: 0 },
  content: { flexGrow: 1 },
  fill: { flexGrow: 1 },
  dismissBackdrop: { ...StyleSheet.absoluteFill },
  barDock: { position: "absolute", left: 0, right: 0, zIndex: 80 },
  bar: {
    height: 44,
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    overflow: "hidden",
  },
  doneHit: {
    minWidth: 44,
    height: 44,
    alignItems: "flex-end",
    justifyContent: "center",
  },
});
