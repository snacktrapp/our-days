import {
  localJournalIsEnabled,
  mediaDeliveryIsEnabled,
} from "../../../../../../config/our-days-environment";
import {
  byteSizeMatches,
  declaredByteSize,
  mediaTypeMatches,
} from "@/lib/private-media-delivery";
import { createOurDaysServerClient } from "@/lib/supabase/server";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const singleByteRangePattern = /^bytes=(?:\d+-\d*|\d*-\d+)$/u;

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
} as const;

function unavailable() {
  return new Response(null, { status: 404, headers: privateHeaders });
}

function validPartialResponse(response: Response, expectedSize: number) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(
    response.headers.get("content-range") ?? "",
  );
  if (!match) return false;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  const length = Number(response.headers.get("content-length"));
  return (
    Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    Number.isSafeInteger(total) &&
    start >= 0 &&
    end >= start &&
    total === expectedSize &&
    end < total &&
    length === end - start + 1
  );
}

function requestedByteRange(range: string, total: number) {
  const match = /^bytes=(\d*)-(\d*)$/u.exec(range);
  if (!match) return null;
  let start: number;
  let end: number;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? total - 1 : Number(match[2]);
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end >= total
  ) {
    return null;
  }
  return { start, end };
}

async function sliceStreamToRange(
  body: ReadableStream<Uint8Array>,
  start: number,
  end: number,
) {
  const reader = body.getReader();
  const needed = end - start + 1;
  const out = new Uint8Array(needed);
  let skipped = 0;
  let written = 0;
  try {
    while (written < needed) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      let offset = 0;
      if (skipped < start) {
        const canSkip = Math.min(value.length, start - skipped);
        skipped += canSkip;
        offset = canSkip;
        if (skipped < start) continue;
      }
      const take = Math.min(value.length - offset, needed - written);
      out.set(value.subarray(offset, offset + take), written);
      written += take;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return written === needed ? out : null;
}

export async function GET(
  request: Request,
  context: Readonly<{ params: Promise<{ momentId: string }> }>,
) {
  const { momentId } = await context.params;
  const range = request.headers.get("range");
  if (
    !uuidPattern.test(momentId) ||
    (range !== null && !singleByteRangePattern.test(range))
  ) {
    return unavailable();
  }
  if (localJournalIsEnabled()) {
    const { readLocalJournalAccess } = await import("@/lib/local-journal/auth");
    const { readLocalMediaFile } =
      await import("@/lib/local-journal/media-coordinator");
    const { findLocalVisibleMoment } =
      await import("@/lib/local-journal/views");
    const access = await readLocalJournalAccess();
    if (!access) return unavailable();
    const moment = await findLocalVisibleMoment(momentId);
    if (!moment?.media || moment.kind !== "video") return unavailable();
    const bytes = readLocalMediaFile(moment.media.originalRelativePath);
    const headers = new Headers(privateHeaders);
    headers.set("Accept-Ranges", "bytes");
    headers.set("Content-Type", moment.media.mimeType);
    headers.set("Vary", "Range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/u.exec(range);
      if (!match) return unavailable();
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : bytes.byteLength - 1;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end < start ||
        end >= bytes.byteLength
      ) {
        return unavailable();
      }
      headers.set("Content-Length", String(end - start + 1));
      headers.set("Content-Range", `bytes ${start}-${end}/${bytes.byteLength}`);
      return new Response(bytes.subarray(start, end + 1), {
        status: 206,
        headers,
      });
    }
    headers.set("Content-Length", String(bytes.byteLength));
    return new Response(bytes, { status: 200, headers });
  }
  if (!mediaDeliveryIsEnabled()) {
    return unavailable();
  }

  const supabase = await createOurDaysServerClient();
  const { data: rows, error: descriptorError } = await supabase.rpc(
    "get_video_moment_delivery",
    { moment_id: momentId },
  );
  const descriptor = rows?.[0];
  if (descriptorError || !descriptor) return unavailable();

  const { data: signed, error: signingError } = await supabase.storage
    .from(descriptor.bucket_id)
    .createSignedUrl(descriptor.object_path, 60);
  if (signingError || !signed?.signedUrl) return unavailable();

  let upstream: Response;
  try {
    upstream = await fetch(signed.signedUrl, {
      cache: "no-store",
      headers: range ? { Range: range } : undefined,
      redirect: "error",
    });
  } catch {
    return unavailable();
  }

  const expectedSize = declaredByteSize(descriptor.size_bytes);
  const contentType = upstream.headers.get("content-type");
  const contentLength = Number(upstream.headers.get("content-length"));
  if (
    expectedSize === null ||
    !upstream.body ||
    !mediaTypeMatches(contentType, descriptor.mime_type)
  ) {
    await upstream.body?.cancel();
    return unavailable();
  }

  const responseHeaders = new Headers(privateHeaders);
  responseHeaders.set("Accept-Ranges", "bytes");
  responseHeaders.set("Content-Type", descriptor.mime_type);
  responseHeaders.set("Vary", "Range");

  if (!range) {
    if (
      upstream.status !== 200 ||
      !byteSizeMatches(contentLength, expectedSize)
    ) {
      await upstream.body.cancel();
      return unavailable();
    }
    responseHeaders.set("Content-Length", String(contentLength));
    return new Response(upstream.body, {
      status: 200,
      headers: responseHeaders,
    });
  }

  if (upstream.status === 206 && validPartialResponse(upstream, expectedSize)) {
    responseHeaders.set("Content-Length", String(contentLength));
    const contentRange = upstream.headers.get("content-range");
    if (contentRange) responseHeaders.set("Content-Range", contentRange);
    return new Response(upstream.body, {
      status: 206,
      headers: responseHeaders,
    });
  }

  // iPhone Safari always sends Range. Some Storage/CDN objects (especially
  // TUS multipart videos) answer that with a 200 of the whole file. Slice
  // a truthful 206 so the lightbox does not get an empty error mat.
  if (upstream.status === 200 && byteSizeMatches(contentLength, expectedSize)) {
    const parsed = requestedByteRange(range, expectedSize);
    if (!parsed) {
      await upstream.body.cancel();
      return unavailable();
    }
    const sliced = await sliceStreamToRange(
      upstream.body,
      parsed.start,
      parsed.end,
    );
    if (!sliced) return unavailable();
    responseHeaders.set("Content-Length", String(sliced.byteLength));
    responseHeaders.set(
      "Content-Range",
      `bytes ${parsed.start}-${parsed.end}/${expectedSize}`,
    );
    return new Response(sliced, { status: 206, headers: responseHeaders });
  }

  await upstream.body.cancel();
  return unavailable();
}
