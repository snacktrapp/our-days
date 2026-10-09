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

function boundedByteRange(range: string, total: number) {
  const match = /^bytes=(\d*)-(\d*)$/u.exec(range);
  if (!match || !Number.isSafeInteger(total) || total < 0) return null;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (total === 0) return "unsatisfiable";
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    const start = Math.max(0, total - suffix);
    return {
      start,
      end: Math.min(total - 1, start + videoRangeWindowBytes - 1),
    };
  }
  const start = Number(match[1]);
  if (!Number.isSafeInteger(start) || start < 0) return null;
  if (start >= total) return "unsatisfiable";
  const requestedEnd = match[2] === "" ? total - 1 : Number(match[2]);
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return null;
  return {
    start,
    end: Math.min(requestedEnd, total - 1, start + videoRangeWindowBytes - 1),
  };
}

function unsatisfiableRange(total: number) {
  const headers = new Headers(privateNoStoreHeaders);
  headers.set("Content-Range", `bytes */${total}`);
  return new Response(null, { status: 416, headers });
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
      if (bounded === "unsatisfiable") {
        return unsatisfiableRange(bytes.byteLength);
      }
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
  if (bounded === "unsatisfiable") return unsatisfiableRange(expectedSize);
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
      !contentLengthAgrees(upstream.headers, expectedSize)
    ) {
      await upstream.body.cancel();
      return unavailable();
    }
    if (upstream.headers.has("content-length")) {
      const bytes = { byteLength: contentLength };
      if (!byteSizeMatches(bytes.byteLength, expectedSize)) {
        await upstream.body.cancel();
        return unavailable();
      }
      responseHeaders.set("Content-Length", String(bytes.byteLength));
    }
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

  // Storage sometimes answers Range with a 200 of the whole object, including
  // TUS uploads that omit Content-Length. Stream only the bounded window.
  if (
    upstream.status === 200 &&
    contentLengthAgrees(upstream.headers, expectedSize)
  ) {
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
