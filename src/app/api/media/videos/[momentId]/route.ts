import { createHash } from "node:crypto";
import {
  localJournalIsEnabled,
  mediaDeliveryIsEnabled,
} from "../../../../../../config/our-days-environment";
import {
  byteSizeMatches,
  contentLengthAgrees,
  declaredByteSize,
  mediaTypeMatches,
} from "@/lib/private-media-delivery";
import { createOurDaysServerClient } from "@/lib/supabase/server";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const singleByteRangePattern = /^bytes=(?:\d+-\d*|\d*-\d+)$/u;
const defaultVideoRangeWindowBytes = 1_048_576;
const maximumVideoRangeWindowBytes = 2_097_152;
const videoRangeWindowBytes = Math.min(
  defaultVideoRangeWindowBytes,
  maximumVideoRangeWindowBytes,
);

const privateNoStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
} as const;
const privateCacheControl = "private, max-age=604800, immutable";
const privateCachedHeaders = {
  "Cache-Control": privateCacheControl,
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
} as const;

function unavailable() {
  return new Response(null, { status: 404, headers: privateNoStoreHeaders });
}

function etagFor(parts: readonly (string | number)[]) {
  const key = parts.join(":");
  const digest = createHash("sha256").update(key).digest("hex");
  return `"od-media-${digest}"`;
}

function varyWithRange() {
  return "Cookie, Range";
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

function contentRangeParts(response: Response) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(
    response.headers.get("content-range") ?? "",
  );
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: Number(match[3]),
  };
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

function boundedByteRange(range: string, total: number) {
  const requested = requestedByteRange(range, total);
  if (!requested) return null;
  const end = Math.min(
    requested.end,
    requested.start + videoRangeWindowBytes - 1,
  );
  return { start: requested.start, end };
}

function upstreamBodyStartsAt(
  response: Response,
  expectedSize: number,
  start: number,
  end: number,
) {
  if (
    response.status !== 206 ||
    !validPartialResponse(response, expectedSize)
  ) {
    return false;
  }
  const parts = contentRangeParts(response);
  return parts !== null && parts.start === start && parts.end >= end;
}

function limitStream(
  body: ReadableStream<Uint8Array>,
  count: number,
  skip: number,
  signal: AbortSignal,
) {
  const reader = body.getReader();
  let skipped = 0;
  let sent = 0;
  let settled = false;
  const stop = () => {
    if (settled) return;
    settled = true;
    signal.removeEventListener("abort", onAbort);
  };
  function onAbort() {
    void reader.cancel().catch(() => undefined);
  }
  signal.addEventListener("abort", onAbort, { once: true });

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (sent < count) {
          if (signal.aborted) {
            stop();
            await reader.cancel().catch(() => undefined);
            controller.error(
              signal.reason ??
                new DOMException("The operation was aborted.", "AbortError"),
            );
            return;
          }
          const { done, value } = await reader.read();
          if (done || !value) {
            stop();
            await reader.cancel().catch(() => undefined);
            controller.error(new Error("Video byte range ended early."));
            return;
          }
          if (value.byteLength === 0) continue;
          let offset = 0;
          if (skipped < skip) {
            const canSkip = Math.min(value.byteLength, skip - skipped);
            skipped += canSkip;
            offset = canSkip;
            if (offset >= value.byteLength) continue;
          }
          const take = Math.min(value.byteLength - offset, count - sent);
          controller.enqueue(
            new Uint8Array(value.subarray(offset, offset + take)),
          );
          sent += take;
          if (sent >= count) break;
          return;
        }
        stop();
        await reader.cancel().catch(() => undefined);
        controller.close();
      } catch (error) {
        stop();
        await reader.cancel().catch(() => undefined);
        controller.error(error);
      }
    },
    cancel() {
      stop();
      return reader.cancel();
    },
  });
}

function boundedPartialResponse(
  body: ReadableStream<Uint8Array>,
  start: number,
  end: number,
  total: number,
  headers: Headers,
  signal: AbortSignal,
  skip: number,
) {
  headers.set("Content-Length", String(end - start + 1));
  headers.set("Content-Range", `bytes ${start}-${end}/${total}`);
  return new Response(limitStream(body, end - start + 1, skip, signal), {
    status: 206,
    headers,
  });
}

async function readAtMost(body: ReadableStream<Uint8Array>, limit: number) {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let overflow = false;
  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      if (value.byteLength === 0) continue;
      if (value.byteLength > limit - total) {
        overflow = true;
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
    if (!overflow && total === limit) {
      const extra = await reader.read();
      if (!extra.done && extra.value && extra.value.byteLength > 0) {
        overflow = true;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (overflow) return null;
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
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
    if (!moment?.media) return unavailable();
    if (moment.kind !== "video" && moment.kind !== "insight") {
      return unavailable();
    }
    const bytes = readLocalMediaFile(moment.media.originalRelativePath);
    const headers = new Headers(privateNoStoreHeaders);
    headers.set("Accept-Ranges", "bytes");
    headers.set("Content-Type", moment.media.mimeType);
    headers.set("Vary", varyWithRange());
    if (range) {
      const bounded = boundedByteRange(range, bytes.byteLength);
      if (!bounded) return unavailable();
      headers.set("Content-Length", String(bounded.end - bounded.start + 1));
      headers.set(
        "Content-Range",
        `bytes ${bounded.start}-${bounded.end}/${bytes.byteLength}`,
      );
      return new Response(bytes.subarray(bounded.start, bounded.end + 1), {
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
  const expectedSize = declaredByteSize(descriptor.size_bytes);
  if (expectedSize === null) return unavailable();
  const etag = etagFor([
    "video",
    descriptor.bucket_id,
    descriptor.object_path,
    expectedSize,
    descriptor.mime_type,
  ]);
  const bounded = range ? boundedByteRange(range, expectedSize) : null;
  if (range && !bounded) return unavailable();
  if (!range) {
    const match = request.headers.get("if-none-match");
    if (
      match
        ?.split(",")
        .map((entry) => entry.trim())
        .includes(etag)
    ) {
      return new Response(null, {
        status: 304,
        headers: {
          ...privateCachedHeaders,
          ETag: etag,
          "Accept-Ranges": "bytes",
          "Content-Type": descriptor.mime_type,
          Vary: varyWithRange(),
        },
      });
    }
  }

  const { data: signed, error: signingError } = await supabase.storage
    .from(descriptor.bucket_id)
    .createSignedUrl(descriptor.object_path, 60);
  if (signingError || !signed?.signedUrl) return unavailable();

  let upstream: Response;
  try {
    upstream = await fetch(signed.signedUrl, {
      cache: "no-store",
      headers: bounded
        ? { Range: `bytes=${bounded.start}-${bounded.end}` }
        : undefined,
      redirect: "error",
      signal: request.signal,
    });
  } catch {
    return unavailable();
  }

  const contentType = upstream.headers.get("content-type");
  const contentLength = Number(upstream.headers.get("content-length"));
  if (!upstream.body || !mediaTypeMatches(contentType, descriptor.mime_type)) {
    await upstream.body?.cancel();
    return unavailable();
  }

  const responseHeaders = new Headers(privateCachedHeaders);
  responseHeaders.set("ETag", etag);
  responseHeaders.set("Accept-Ranges", "bytes");
  responseHeaders.set("Content-Type", descriptor.mime_type);
  responseHeaders.set("Vary", varyWithRange());

  if (!bounded) {
    if (
      upstream.status !== 200 ||
      !upstream.headers.has("content-length") ||
      !contentLengthAgrees(upstream.headers, expectedSize)
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

  if (
    upstreamBodyStartsAt(upstream, expectedSize, bounded.start, bounded.end)
  ) {
    return boundedPartialResponse(
      upstream.body,
      bounded.start,
      bounded.end,
      expectedSize,
      responseHeaders,
      request.signal,
      0,
    );
  }

  // Storage sometimes answers Range with a 200 of the whole object. Stream
  // only the bounded window and cancel the remainder. A missing Content-Length
  // is accepted only when the object fits in the window cap.
  if (
    upstream.status === 200 &&
    contentLengthAgrees(upstream.headers, expectedSize)
  ) {
    if (!upstream.headers.has("content-length")) {
      const cap = bounded.start + videoRangeWindowBytes;
      if (expectedSize > cap) {
        await upstream.body.cancel();
        return unavailable();
      }
      const bytes = await readAtMost(upstream.body, expectedSize);
      if (!bytes || !byteSizeMatches(bytes.byteLength, expectedSize)) {
        return unavailable();
      }
      const sliced = bytes.subarray(bounded.start, bounded.end + 1);
      responseHeaders.set("Content-Length", String(sliced.byteLength));
      responseHeaders.set(
        "Content-Range",
        `bytes ${bounded.start}-${bounded.end}/${expectedSize}`,
      );
      return new Response(sliced, { status: 206, headers: responseHeaders });
    }
    return boundedPartialResponse(
      upstream.body,
      bounded.start,
      bounded.end,
      expectedSize,
      responseHeaders,
      request.signal,
      bounded.start,
    );
  }

  await upstream.body.cancel();
  return unavailable();
}
