import {
  activityMomentHref,
  readNotificationTarget,
} from "../../../src/lib/activity-notifications";

export type PushLanding = NonNullable<ReturnType<typeof readNotificationTarget>>;

/** Permission is requested from Settings, never while the journal is opening. */
export const requestsPushPermissionAtColdLaunch = false;

const tokenPattern = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{16,200}\]$/u;

export function validExpoPushToken(token: string) {
  return tokenPattern.test(token);
}

/** The web notification URL, kept as the push data payload. */
export function pushHrefForLanding(
  momentId: string,
  target?: Readonly<{ noteId?: string | null; thread?: boolean }>,
) {
  return activityMomentHref(momentId, target);
}

export function landingFromPushData(data: unknown): PushLanding | null {
  if (typeof data !== "object" || data === null) return null;
  const href = "href" in data && typeof data.href === "string" ? data.href : "";
  if (!href) return null;
  return readNotificationTarget(href);
}
