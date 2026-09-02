import {
  localJournalIsEnabled,
  mediaDeliveryIsEnabled,
} from "../../../../../../config/our-days-environment";
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

  const contentType = upstream.headers.get("content-type");
  const contentLength = Number(upstream.headers.get("content-length"));
  if (
    !upstream.body ||
    contentType !== descriptor.mime_type ||
    (range
      ? upstream.status !== 206 ||
        !validPartialResponse(upstream, descriptor.size_bytes)
      : upstream.status !== 200 || contentLength !== descriptor.size_bytes)
  ) {
    await upstream.body?.cancel();
    return unavailable();
  }

  const responseHeaders = new Headers(privateHeaders);
  responseHeaders.set("Accept-Ranges", "bytes");
  responseHeaders.set("Content-Length", String(contentLength));
  responseHeaders.set("Content-Type", descriptor.mime_type);
  responseHeaders.set("Vary", "Range");
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) responseHeaders.set("Content-Range", contentRange);

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
