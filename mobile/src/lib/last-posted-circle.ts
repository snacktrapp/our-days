import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

function storageKey(userId: string) {
  return `our-days.last-posted-circle.${userId}`;
}

/** The circle this person last posted to, on this device. Web keeps the site cookie. */
export async function readLastPostedCircle(userId: string) {
  if (Platform.OS === "web") return null;
  return SecureStore.getItemAsync(storageKey(userId));
}

export async function rememberPostedCircle(userId: string, circleId: string) {
  if (Platform.OS === "web") return;
  await SecureStore.setItemAsync(storageKey(userId), circleId);
}
