import { isOperationsDirectory } from "@/lib/circle-roles";
import {
  executePhotoCardBackfill,
  PhotoCardBackfillListError,
  type PhotoCardBackfillRequest,
} from "@/lib/photo-card-backfill.server";
import { withAuthenticatedPhotoWorker } from "@/lib/photo-worker.server";
import { createOurDaysServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

const bodyKeys = new Set(["live", "after", "limit", "budgetMs"]);

function empty(status: number, extraHeaders?: HeadersInit) {
  return new Response(null, {
    status,
    headers: { ...privateHeaders, ...extraHeaders },
  });
}

function methodNotAllowed() {
  return empty(405, { Allow: "POST" });
}

export function GET() {
  return methodNotAllowed();
}

export function PUT() {
  return methodNotAllowed();
}

export function PATCH() {
  return methodNotAllowed();
}

export function DELETE() {
  return methodNotAllowed();
}

export function HEAD() {
  return methodNotAllowed();
}

export function OPTIONS() {
  return methodNotAllowed();
}

function parseBackfillBody(value: unknown): PhotoCardBackfillRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!bodyKeys.has(key)) return null;
  }

  let live = false;
  if ("live" in record) {
    if (typeof record.live !== "boolean") return null;
    live = record.live;
  }

  let after: string | null = null;
  if ("after" in record && record.after !== null) {
    if (typeof record.after !== "string" || !uuidPattern.test(record.after)) {
      return null;
    }
    after = record.after;
  }

  let limit = 10;
  if ("limit" in record) {
    if (
      typeof record.limit !== "number" ||
      !Number.isInteger(record.limit) ||
      record.limit < 1 ||
      record.limit > 10
    ) {
      return null;
    }
    limit = record.limit;
  }

  let budgetMs = 60_000;
  if ("budgetMs" in record) {
    if (
      typeof record.budgetMs !== "number" ||
      !Number.isInteger(record.budgetMs) ||
      record.budgetMs < 1_000 ||
      record.budgetMs > 240_000
    ) {
      return null;
    }
    budgetMs = record.budgetMs;
  }

  return { after, budgetMs, limit, live };
}

async function parseBackfillRequest(
  request: Request,
): Promise<PhotoCardBackfillRequest | null> {
  let text = "";
  try {
    text = await request.text();
  } catch {
    return null;
  }
  if (text.trim() === "") return parseBackfillBody({});
  try {
    return parseBackfillBody(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

async function callerIsOperations() {
  try {
    const supabase = await createOurDaysServerClient();
    const { data, error } = await supabase.auth.getUser();
    const userId = data?.user?.id;
    if (error || !userId) return false;
    const memberships = await supabase
      .from("circle_memberships")
      .select("directory_kind, status")
      .eq("user_id", userId)
      .eq("status", "active")
      .limit(50);
    if (memberships.error || !memberships.data) return false;
    return memberships.data.some(
      (membership) =>
        membership.status === "active" &&
        isOperationsDirectory(membership.directory_kind),
    );
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const startedAt = performance.now();
  const elapsedMs = () => performance.now() - startedAt;
  if (!(await callerIsOperations())) {
    console.info("[photo-card-backfill]", { rejected: "auth" });
    return empty(404);
  }

  const parsed = await parseBackfillRequest(request);
  if (!parsed) {
    console.info("[photo-card-backfill]", { rejected: "body" });
    return empty(400);
  }

  try {
    const result = await withAuthenticatedPhotoWorker((io) =>
      executePhotoCardBackfill(io, parsed, elapsedMs),
    );
    console.info("[photo-card-backfill]", {
      candidates: result.candidates,
      elapsedMs: result.elapsedMs,
      failed: result.failed,
      made: result.made,
      mode: result.mode,
      skipped: result.skipped,
    });
    return Response.json(result, { headers: privateHeaders });
  } catch (error) {
    console.error("[photo-card-backfill]", {
      rejected: error instanceof PhotoCardBackfillListError ? "list" : "worker",
    });
    return empty(503);
  }
}
