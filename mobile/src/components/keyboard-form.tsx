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
import {
  Dimensions,
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  useColorScheme,
  View,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { adjacentComposerField } from "../lib/composer-keyboard";

export const composerAccessoryId = "our-days-composer-accessory";

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
    inputAccessoryViewID: Platform.OS === "ios" ? composerAccessoryId : undefined,
    onFocus: () => form?.onFieldFocus(id, ref.current),
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
      keyboardTop.current = event.endCoordinates.screenY;
      reveal(focusedNode.current);
    });
    const hide = Keyboard.addListener(hideEvent, () => {
      keyboardTop.current = Dimensions.get("window").height;
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

  const index = focusedId == null ? -1 : ids.indexOf(focusedId);

  return (
    <KeyboardFormContext.Provider value={value}>
      <FieldOrderContext.Provider value={ids}>
      {children}
      {Platform.OS === "ios" ? (
        <InputAccessoryView nativeID={composerAccessoryId}>
          <ComposerKeyboardBar
            previousDisabled={index <= 0}
            nextDisabled={index < 0 || index >= ids.length - 1}
            onPrevious={() => focusId(adjacentComposerField(ids, focusedId, -1))}
            onNext={() => focusId(adjacentComposerField(ids, focusedId, 1))}
            onDone={dismiss}
          />
        </InputAccessoryView>
      ) : null}
      </FieldOrderContext.Provider>
    </KeyboardFormContext.Provider>
  );
}

export function ComposerScroller({
  children,
  contentStyle,
}: Readonly<{ children: ReactNode; contentStyle?: StyleProp<ViewStyle> }>) {
  const form = useKeyboardForm();
  return (
    <ScrollView
      ref={form?.scrollRef}
      testID="composer-form"
      style={styles.scroller}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      automaticallyAdjustKeyboardInsets
      onScroll={form?.onScroll}
      scrollEventThrottle={16}
    >
      <TouchableWithoutFeedback onPress={form?.dismiss ?? Keyboard.dismiss} accessible={false}>
        <View style={[styles.fill, contentStyle]}>{children}</View>
      </TouchableWithoutFeedback>
    </ScrollView>
  );
}

/** iOS / WebKit form accessory: previous, next, and a check that dismisses. */
export function ComposerKeyboardBar({
  previousDisabled,
  nextDisabled,
  onPrevious,
  onNext,
  onDone,
}: Readonly<{
  previousDisabled: boolean;
  nextDisabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onDone: () => void;
}>) {
  const dark = useColorScheme() === "dark";
  const tint = dark ? "#0a84ff" : "#007aff";
  const disabled = dark ? "#636366" : "#8e8e93";
  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: dark ? "#1c1c1e" : "#d1d3d9",
          borderTopColor: dark ? "#3a3a3c" : "#b8bac0",
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Previous field"
        accessibilityState={{ disabled: previousDisabled }}
        disabled={previousDisabled}
        onPress={onPrevious}
        style={styles.hit}
      >
        <Text style={[styles.chevron, { color: previousDisabled ? disabled : tint }]}>⌃</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Next field"
        accessibilityState={{ disabled: nextDisabled }}
        disabled={nextDisabled}
        onPress={onNext}
        style={styles.hit}
      >
        <Text style={[styles.chevron, { color: nextDisabled ? disabled : tint }]}>⌄</Text>
      </Pressable>
      <View style={styles.spacer} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Done"
        onPress={onDone}
        style={styles.hit}
      >
        <Text style={[styles.done, { color: tint }]}>✓</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  scroller: { flex: 1, minHeight: 0 },
  content: { flexGrow: 1 },
  fill: { flexGrow: 1 },
  bar: {
    height: 44,
    width: "100%",
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
  },
  hit: {
    width: 46,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  chevron: { fontSize: 22, lineHeight: 26 },
  done: { fontSize: 22, lineHeight: 26, fontWeight: "600" },
  spacer: { flex: 1 },
});
