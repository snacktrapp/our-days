import { createHash } from "node:crypto";
import {
  localJournalIsEnabled,
  mediaDeliveryIsEnabled,
} from "../../../../../../../config/our-days-environment";
import {
  byteSizeMatches,
  mediaTypeMatches,
} from "@/lib/private-media-delivery";
import { fetchSignedPrivateObject } from "@/lib/private-media-delivery.server";
import { createOurDaysServerClient } from "@/lib/supabase/server";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const privateNoStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
  Vary: "Cookie",
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

export async function GET(
  _request: Request,
  context: Readonly<{ params: Promise<{ momentId: string }> }>,
) {
  const { momentId } = await context.params;
  if (!uuidPattern.test(momentId)) return unavailable();

  if (localJournalIsEnabled()) {
    const { readLocalJournalAccess } = await import("@/lib/local-journal/auth");
    const { digestBuffer, readLocalMediaFile } =
      await import("@/lib/local-journal/media-coordinator");
    const { findLocalVisibleMoment } =
      await import("@/lib/local-journal/views");
    const access = await readLocalJournalAccess();
    if (!access) return unavailable();
    const moment = await findLocalVisibleMoment(momentId);
    if (
      (moment?.kind !== "video" && moment?.kind !== "insight") ||
      !moment.media?.posterRelativePath
    ) {
      return unavailable();
    }
    const bytes = readLocalMediaFile(moment.media.posterRelativePath);
    const expectedSha = moment.media.posterSha256;
    if (expectedSha && digestBuffer(bytes) !== expectedSha) {
      return unavailable();
    }
    return new Response(bytes, {
      status: 200,
      headers: {
        ...privateNoStoreHeaders,
        "Content-Length": String(bytes.byteLength),
        "Content-Type": moment.media.posterMimeType ?? "image/jpeg",
      },
    });
  }

  if (!mediaDeliveryIsEnabled()) return unavailable();

  const supabase = await createOurDaysServerClient();
  const { data: rows, error } = await supabase.rpc(
    "get_video_moment_poster_delivery",
    { moment_id: momentId },
  );
  const descriptor = rows?.[0];
  if (error || !descriptor) return unavailable();
  const etag = etagFor([
    "poster",
    descriptor.bucket_id,
    descriptor.object_path,
    String(descriptor.size_bytes),
    descriptor.mime_type,
  ]);
  const match = _request.headers.get("if-none-match");
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
        "Content-Type": descriptor.mime_type,
      },
    });
  }

  const file = await fetchSignedPrivateObject(
    supabase.storage.from(descriptor.bucket_id),
    descriptor.object_path,
  );
  if (
    !file ||
    !byteSizeMatches(file.bytes.byteLength, descriptor.size_bytes) ||
    !mediaTypeMatches(file.contentType, descriptor.mime_type)
  ) {
    return unavailable();
  }

  const bytes = new Uint8Array(file.bytes);

  return new Response(bytes, {
    status: 200,
    headers: {
      ...privateCachedHeaders,
      "Content-Length": String(bytes.byteLength),
      "Content-Type": descriptor.mime_type,
      ETag: etag,
    },
  });
}
