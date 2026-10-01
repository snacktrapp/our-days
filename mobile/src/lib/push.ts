import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import {
  landingFromPushData,
  type PushLanding,
} from "./push-landing";
import { getSupabase } from "./supabase";

let registeredToken: string | null = null;
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
    return { ok: true as const, message: "Notifications are on." };
  } catch {
    return { ok: false as const, message: "Notifications could not be turned on." };
  }
}

export async function disablePushNotifications() {
  const supabase = getSupabase();
  const token = registeredToken;
  registeredToken = null;
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
