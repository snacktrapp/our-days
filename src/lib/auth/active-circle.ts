import "server-only";

import { cookies } from "next/headers";
import {
  ACTIVE_CIRCLE_COOKIE,
  PREVIEW_CREATED_GROUP_NAME_COOKIE,
  isActiveCircleToken,
  normalizeGroupName,
} from "./active-circle-shared";

export {
  ACTIVE_CIRCLE_COOKIE,
  PREVIEW_CREATED_GROUP_NAME_COOKIE,
  isActiveCircleToken,
  normalizeGroupName,
};

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    secure:
      process.env.NODE_ENV === "production" ||
      process.env.NEXT_PUBLIC_SITE_URL?.startsWith("https://") === true,
    maxAge,
  };
}

export async function readActiveCircleCookie() {
  const value = (await cookies()).get(ACTIVE_CIRCLE_COOKIE)?.value;
  return value && isActiveCircleToken(value) ? value : null;
}

export async function readPreviewCreatedGroupName() {
  const value = (await cookies()).get(PREVIEW_CREATED_GROUP_NAME_COOKIE)?.value;
  return value ? normalizeGroupName(value) : null;
}

export async function writeActiveCircleCookie(
  circleId: string,
  previewGroupName?: string | null,
) {
  if (!isActiveCircleToken(circleId)) return;
  const store = await cookies();
  store.set(ACTIVE_CIRCLE_COOKIE, circleId, cookieOptions(60 * 60 * 24 * 400));
  if (previewGroupName) {
    const name = normalizeGroupName(previewGroupName);
    if (name) {
      store.set(
        PREVIEW_CREATED_GROUP_NAME_COOKIE,
        name,
        cookieOptions(60 * 60 * 24 * 400),
      );
    }
  }
}
