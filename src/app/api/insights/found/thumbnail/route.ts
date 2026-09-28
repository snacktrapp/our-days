import sharp from "sharp";
import { foundSearchIsEnabled } from "../../../../../../config/our-days-environment";
import { readJournalAccessState } from "@/lib/auth/journal-access";
import { canCreateInsight } from "@/lib/circle-roles";

export const runtime = "nodejs";

const videoIdPattern = /^[A-Za-z0-9_-]{11}$/u;
const byteLimit = 2_000_000;

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
} as const;

function text(message: string, status: number) {
  return new Response(message, {
    status,
    headers: { ...privateHeaders, "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function GET(request: Request) {
  if (!foundSearchIsEnabled()) return text("Found is disabled.", 404);

  const videoId = new URL(request.url).searchParams.get("v") ?? "";
  if (!videoIdPattern.test(videoId))
    return text("Check the thumbnail and try again.", 400);

  const access = await readJournalAccessState();
  if (access.mode !== "authenticated" || !canCreateInsight(access.role)) {
    return text("Only an organizer or Operations can create an Insight.", 403);
  }

  const upstream = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  let fetched: Response;
  try {
    fetched = await fetch(upstream, { redirect: "manual" });
  } catch {
    return text("Thumbnail unavailable.", 502);
  }
  if (fetched.status >= 300 && fetched.status < 400) {
    return text("Thumbnail unavailable.", 502);
  }
  if (!fetched.ok) return text("Thumbnail unavailable.", 502);
  const type = (fetched.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("image/")) return text("Thumbnail unavailable.", 502);
  const declared = Number(fetched.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > byteLimit) {
    return text("Thumbnail unavailable.", 502);
  }
  const bytes = Buffer.from(await fetched.arrayBuffer());
  if (bytes.length === 0 || bytes.length > byteLimit) {
    return text("Thumbnail unavailable.", 502);
  }
  try {
    const jpeg = await sharp(bytes, { failOn: "error" })
      .rotate()
      .jpeg({ quality: 80 })
      .toBuffer();
    return new Response(new Uint8Array(jpeg), {
      status: 200,
      headers: {
        ...privateHeaders,
        "Content-Type": "image/jpeg",
      },
    });
  } catch {
    return text("Thumbnail unavailable.", 502);
  }
}
