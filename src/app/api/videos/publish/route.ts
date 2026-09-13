import { resolvedSiteOrigin } from "../../../../../config/our-days-environment";
import { notifyFamilyActivity } from "@/lib/notifications/family-activity";
import { createOurDaysServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
} as const;

function response(body: object, status: number) {
  return Response.json(body, { status, headers: privateHeaders });
}

function normalizeHost(value: string | null) {
  if (!value) return "";
  return value
    .split(",")[0]!
    .trim()
    .toLowerCase()
    .replace(/:(?:80|443)$/u, "");
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let originHost = "";
  try {
    originHost = normalizeHost(new URL(origin).host);
  } catch {
    return false;
  }
  if (!originHost) return false;

  const requestHost = normalizeHost(
    request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
  );
  if (requestHost && originHost === requestHost) return true;

  const siteOrigin = resolvedSiteOrigin();
  if (!siteOrigin) return false;
  try {
    return originHost === normalizeHost(new URL(siteOrigin).host);
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return response({ ok: false }, 404);
  }

  let requestId: string | undefined;
  let momentId: string | undefined;
  try {
    const body = (await request.json()) as unknown;
    if (typeof body === "object" && body !== null) {
      if ("requestId" in body && typeof body.requestId === "string") {
        requestId = body.requestId;
      }
      if ("momentId" in body && typeof body.momentId === "string") {
        momentId = body.momentId;
      }
    }
  } catch {
    return response({ ok: false, message: "Video request is invalid." }, 400);
  }
  if (!requestId || !uuidPattern.test(requestId)) {
    return response({ ok: false, message: "Video request is invalid." }, 400);
  }
  if (momentId && !uuidPattern.test(momentId)) {
    return response({ ok: false, message: "Video request is invalid." }, 400);
  }

  const supabase = await createOurDaysServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return response({ ok: false }, 404);

  if (momentId) {
    const { data: deliveryRows } = await supabase.rpc(
      "get_video_moment_delivery",
      { moment_id: momentId },
    );
    if (Array.isArray(deliveryRows) && deliveryRows.length > 0) {
      console.info("[notifications] skipped", {
        reason: "already_published",
        kind: "moment",
        activityId: momentId,
      });
      return response({ ok: true, momentId }, 200);
    }
  }

  const { data: publishedMomentId, error: finalizeError } = await supabase.rpc(
    "finalize_video_moment",
    { request_id: requestId },
  );
  if (
    finalizeError ||
    !publishedMomentId ||
    !uuidPattern.test(publishedMomentId)
  ) {
    return response(
      {
        ok: false,
        message:
          "The upload finished, but the video could not yet be added. Try again.",
      },
      409,
    );
  }

  console.info("[video-publish] published", {
    requestId,
    momentId: publishedMomentId,
  });
  await notifyFamilyActivity(supabase, "moment", publishedMomentId);
  return response({ ok: true, momentId: publishedMomentId }, 200);
}
