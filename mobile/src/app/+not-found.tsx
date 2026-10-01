import { Redirect } from "expo-router";

/**
 * Links the app does not have a screen for (for example `ourdays://invite?token=…`
 * or an old path) land on the start screen instead of a dead end. The sign-in
 * screen reads invitation tokens from the opening link itself.
 */
export default function NotFound() {
  return <Redirect href="/" />;
}
