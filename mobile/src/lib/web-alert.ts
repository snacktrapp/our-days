import { Alert, Platform, type AlertButton } from "react-native";

/**
 * react-native-web's Alert.alert does nothing, so on the Expo web stand-in the
 * ••• menu, Delete and Discard confirms could never be answered. Web only:
 * one action uses confirm(), several use prompt() with the button names.
 * iOS keeps the native alert.
 */
export function installWebAlert() {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  Alert.alert = (title: string, message?: string, buttons?: AlertButton[]) => {
    const list = buttons?.length ? buttons : [{ text: "OK" }];
    const text = [title, message].filter(Boolean).join("\n\n");
    const actions = list.filter((button) => button.style !== "cancel");
    const cancel = list.find((button) => button.style === "cancel");
    if (actions.length <= 1) {
      if (window.confirm(text)) actions[0]?.onPress?.();
      else cancel?.onPress?.();
      return;
    }
    const answer = window.prompt(`${text}\n\n${actions.map((button) => button.text).join(" / ")}`, "");
    const chosen = actions.find((button) => button.text?.toLowerCase() === answer?.trim().toLowerCase());
    (chosen ?? cancel)?.onPress?.();
  };
}
