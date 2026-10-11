import { timingSafeEqual } from "node:crypto";
import { runMomentMediaPurge } from "@/lib/moment-media-purge/purge-trashed-moment-media";

// Vercel Cron calls this once a day. Hobby rejects more frequent schedules.
// Authorization matches /api/cron/moment-push: Authorization: Bearer CRON_SECRET.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || secret.length < 16 || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      { ok: false },
      { status: 401, headers: privateHeaders },
    );
  }
  try {
    const result = await runMomentMediaPurge();
    return Response.json(
      {
        ok: true,
        listed: result.listed,
        purged: result.purged,
        retained: result.retained,
      },
      { headers: privateHeaders },
    );
  } catch {
    return Response.json(
      { ok: false },
      { status: 503, headers: privateHeaders },
    );
  }
}
