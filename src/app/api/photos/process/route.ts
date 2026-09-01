import { photoPostingIsEnabled } from "../../../../../config/our-days-environment";
import {
  processPhotoIntake,
  PhotoWorkerError,
} from "@/lib/photo-worker.server";
import { createOurDaysServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

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

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!photoPostingIsEnabled() || !sameOrigin(request)) {
    return response({ ok: false }, 404);
  }

  let intakeId: string | undefined;
  try {
    const body = (await request.json()) as unknown;
    if (
      typeof body === "object" &&
      body !== null &&
      "intakeId" in body &&
      typeof body.intakeId === "string"
    ) {
      intakeId = body.intakeId;
    }
  } catch {
    return response({ ok: false, message: "Photo request is invalid." }, 400);
  }
  if (!intakeId || !uuidPattern.test(intakeId)) {
    return response({ ok: false, message: "Photo request is invalid." }, 400);
  }

  const supabase = await createOurDaysServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return response({ ok: false }, 404);

  const { data: beforeRows, error: beforeError } = await supabase.rpc(
    "get_photo_moment_status",
    { intake_id: intakeId },
  );
  const before = beforeRows?.[0];
  if (beforeError || !before) return response({ ok: false }, 404);
  if (before.status === "published") {
    return response({ ok: true, momentId: before.moment_id }, 200);
  }
  if (before.status === "needs_attention" || before.status === "cancelled") {
    return response(
      {
        ok: false,
        message: "This photo needs attention before it can be added.",
      },
      409,
    );
  }

  console.info("[photo-process] started", { intakeId });
  try {
    await processPhotoIntake(intakeId);
  } catch (error) {
    const retryable =
      error instanceof PhotoWorkerError ? error.retryable : true;
    console.error("[photo-process] failed", {
      intakeId,
      kind: error instanceof Error ? error.name : "UnknownError",
      retryable,
    });
    return response(
      {
        ok: false,
        message: retryable
          ? "The photo is still being prepared. Check again shortly."
          : "This file could not be verified as a safe photo.",
      },
      retryable ? 503 : 409,
    );
  }

  const { data: afterRows, error: afterError } = await supabase.rpc(
    "get_photo_moment_status",
    { intake_id: intakeId },
  );
  const after = afterRows?.[0];
  if (afterError || after?.status !== "published" || !after.moment_id) {
    return response(
      { ok: false, message: "The photo is still being prepared." },
      202,
    );
  }
  console.info("[photo-process] published", {
    intakeId,
    momentId: after.moment_id,
  });
  return response({ ok: true, momentId: after.moment_id }, 200);
}
