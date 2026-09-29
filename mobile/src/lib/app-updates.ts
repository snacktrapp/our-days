import * as Updates from "expo-updates";

/** Apply an OTA that finishes downloading this soon after launch right away. */
const applyWindowMs = 10_000;

/**
 * Build 5 checks on launch but only applies a downloaded update on the next
 * cold start, so fixes needed two full relaunches. Fetch at launch and reload
 * immediately if the update lands before the user is likely mid-task.
 */
export async function applyUpdateAtLaunch(canReload: () => boolean) {
  if (__DEV__ || !Updates.isEnabled) return;
  const started = Date.now();
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return;
    const fetched = await Updates.fetchUpdateAsync();
    if (!fetched.isNew) return;
    if (Date.now() - started <= applyWindowMs && canReload()) {
      await Updates.reloadAsync();
    }
  } catch {
    // Offline or update server unavailable: the embedded or cached bundle runs.
  }
}

/** Short label so a screenshot shows exactly which JS is running. */
export function runningVersionLabel() {
  const build = Updates.isEmbeddedLaunch
    ? "embedded"
    : `update ${Updates.updateId?.slice(0, 8) ?? "unknown"}`;
  return `${Updates.runtimeVersion ?? "dev"} · ${Updates.channel ?? "no channel"} · ${build}`;
}
