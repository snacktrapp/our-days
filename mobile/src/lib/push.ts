import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import {
  landingFromPushData,
  type PushLanding,
} from "./push-landing";
import { getSupabase } from "./supabase";

let registeredToken: string | null = null;

/** Set when this iPhone turned notifications off, so Settings does not turn them back on. */
const optedOutKey = "our-days.push-opted-out";

export async function pushOptedOut() {
  try {
    return (await SecureStore.getItemAsync(optedOutKey)) === "1";
  } catch {
    return false;
  }
}

async function rememberOptOut(optedOut: boolean) {
  try {
    if (optedOut) await SecureStore.setItemAsync(optedOutKey, "1");
    else await SecureStore.deleteItemAsync(optedOutKey);
  } catch {
    // Best effort. The server token is the source of truth for delivery.
  }
}
let handlerReady = false;

function projectId() {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? "";
}

/** Shows a banner if a push arrives while the journal is open. Does not ask permission. */
export function preparePushPresentation() {
  if (handlerReady || Platform.OS !== "ios") return;
  handlerReady = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export async function pushPermissionState() {
  if (Platform.OS !== "ios") return "unavailable" as const;
  const current = await Notifications.getPermissionsAsync();
  if (current.status === "granted") return "granted" as const;
  if (current.status === "denied") return "denied" as const;
  return "undetermined" as const;
}

export async function enablePushNotifications() {
  if (Platform.OS !== "ios") {
    return { ok: false as const, message: "Notifications are available on the iPhone app." };
  }
  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false as const, message: "Notifications could not be turned on." };
  }
  try {
    const current = await Notifications.getPermissionsAsync();
    const next =
      current.status === "granted"
        ? current
        : await Notifications.requestPermissionsAsync({
            ios: { allowAlert: true, allowBadge: false, allowSound: true },
          });
    if (next.status !== "granted") {
      return {
        ok: false as const,
        blocked: next.status === "denied",
        message:
          next.status === "denied"
            ? "Notifications are off in iOS Settings."
            : "Notifications could not be turned on.",
      };
    }
    const id = projectId();
    if (!id) {
      return { ok: false as const, message: "Notifications could not be turned on." };
    }
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
    const { error } = await supabase.rpc("save_expo_push_token", {
      requested_token: token,
    });
    if (error) {
      return { ok: false as const, message: "Notifications could not be turned on." };
    }
    registeredToken = token;
    await rememberOptOut(false);
    return { ok: true as const, message: "Notifications are on." };
  } catch {
    return { ok: false as const, message: "Notifications could not be turned on." };
  }
}

async function currentDeviceToken() {
  if (registeredToken) return registeredToken;
  if (Platform.OS !== "ios") return null;
  try {
    const current = await Notifications.getPermissionsAsync();
    const id = projectId();
    if (current.status !== "granted" || !id) return null;
    return (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
  } catch {
    return null;
  }
}

/**
 * Removes this iPhone's token. `optOut` is true when the person turned the
 * switch off (remembered on this device); sign-out passes false.
 */
export async function disablePushNotifications(optOut = true) {
  const supabase = getSupabase();
  const token = await currentDeviceToken();
  registeredToken = null;
  if (optOut) await rememberOptOut(true);
  if (!supabase || !token) return { ok: true as const, message: "Notifications are off." };
  const { error } = await supabase.rpc("delete_expo_push_token", {
    requested_token: token,
  });
  if (error) {
    return { ok: false as const, message: "Notifications could not be turned off." };
  }
  return { ok: true as const, message: "Notifications are off." };
}

function landingFromResponse(
  response: Notifications.NotificationResponse | null,
): PushLanding | null {
  return landingFromPushData(response?.notification.request.content.data);
}

/** Listens for a tap. Does not request permission. */
export function subscribeNotificationOpens(onOpen: (landing: PushLanding) => void) {
  if (Platform.OS !== "ios") return () => undefined;
  preparePushPresentation();
  let cancelled = false;
  const emit = (response: Notifications.NotificationResponse | null) => {
    const landing = landingFromResponse(response);
    if (landing) onOpen(landing);
  };
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    emit(response);
    Notifications.clearLastNotificationResponse();
  });
  void Notifications.getLastNotificationResponseAsync().then((response) => {
    if (cancelled || !response) return;
    emit(response);
    Notifications.clearLastNotificationResponse();
  });
  return () => {
    cancelled = true;
    subscription.remove();
  };
}
