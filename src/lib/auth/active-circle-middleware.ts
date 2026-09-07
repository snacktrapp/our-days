import type { NextRequest, NextResponse } from "next/server";
import {
  ACTIVE_CIRCLE_COOKIE,
  PREVIEW_CREATED_GROUP_NAME_COOKIE,
  isActiveCircleToken,
  normalizeGroupName,
} from "./active-circle-shared";

export function applyActiveCircleCookie(
  request: NextRequest,
  response: NextResponse,
) {
  const circle = request.nextUrl.searchParams.get("circle");
  if (!circle || !isActiveCircleToken(circle)) return response;
  if (request.nextUrl.pathname !== "/family") return response;

  response.cookies.set({
    name: ACTIVE_CIRCLE_COOKIE,
    value: circle,
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    maxAge: 60 * 60 * 24 * 400,
  });
  const name = request.nextUrl.searchParams.get("name");
  const normalized = name ? normalizeGroupName(name) : null;
  if (normalized) {
    response.cookies.set({
      name: PREVIEW_CREATED_GROUP_NAME_COOKIE,
      value: normalized,
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      maxAge: 60 * 60 * 24 * 400,
    });
  }
  return response;
}
