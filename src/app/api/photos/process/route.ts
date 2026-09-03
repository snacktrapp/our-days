import {
  photoPostingIsEnabled,
  resolvedSiteOrigin,
} from "../../../../../config/our-days-environment";
import {
  processPhotoIntake,
  PhotoWorkerError,
  PHOTO_WORKER_VERSION,
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

  console.info("[photo-process] started", {
    intakeId,
    workerVersion: PHOTO_WORKER_VERSION,
  });
  try {
    await processPhotoIntake(intakeId);
  } catch (error) {
    const workerRetryable =
      error instanceof PhotoWorkerError ? error.retryable : true;
    let terminal = false;
    let serverStatus = "unavailable";
    if (!workerRetryable) {
      const { data: failureRows, error: failureStatusError } =
        await supabase.rpc("get_photo_moment_status", {
          intake_id: intakeId,
        });
      const failureStatus = failureRows?.[0]?.status;
      if (!failureStatusError && failureStatus) serverStatus = failureStatus;
      terminal =
        !failureStatusError &&
        (failureStatus === "needs_attention" || failureStatus === "cancelled");
    }
    const retryable = workerRetryable || !terminal;
    console.error("[photo-process] failed", {
      code:
        error instanceof PhotoWorkerError
          ? error.code
          : "PHOTO_WORKER_UNEXPECTED",
      intakeId,
      kind: error instanceof Error ? error.name : "UnknownError",
      retryable,
      serverStatus,
      stage: error instanceof PhotoWorkerError ? error.stage : "worker",
      workerVersion: PHOTO_WORKER_VERSION,
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
