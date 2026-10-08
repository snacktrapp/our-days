import {
  localJournalIsEnabled,
  mediaDeliveryIsEnabled,
} from "../../../../../../config/our-days-environment";
import {
  isTimelineCardPhotoWidth,
  type TimelineCardPhotoWidth,
} from "@/features/moments/moment-photos";
import {
  readCachedCardRendition,
  rememberCardRendition,
  renderCardPhoto,
} from "@/lib/card-photo-rendition.server";
import {
  readCappedVerifiedPrivateBytes,
} from "@/lib/private-media-delivery.server";
import { normalizedSha256Hex } from "@/lib/private-media-delivery";
import { upsertServerTiming } from "@/lib/server-timing";
import { createOurDaysServerClient } from "@/lib/supabase/server";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
} as const;

function mediaTiming(auth: number, fetchMs: number, resize: number, queue = 0) {
  const headers = new Headers();
  upsertServerTiming(headers, "auth", auth);
  upsertServerTiming(headers, "fetch", fetchMs);
  upsertServerTiming(headers, "queue", queue);
  upsertServerTiming(headers, "resize", resize);
  return headers.get("server-timing") ?? "";
}

function unavailable(serverTiming?: string) {
  return new Response(null, {
    status: 404,
    headers: {
      ...privateHeaders,
      ...(serverTiming ? { "Server-Timing": serverTiming } : {}),
    },
  });
}

function imageResponse(
  bytes: Uint8Array,
  contentType: string,
  serverTiming: string,
) {
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      ...privateHeaders,
      "Content-Length": String(bytes.byteLength),
      "Content-Type": contentType,
      "Server-Timing": serverTiming,
    },
  });
}

function elapsedSince(started: number) {
  return Math.max(0, performance.now() - started);
}

type StoredCard = {
  bucket: string;
  path: string;
  mime: string;
  size: unknown;
  sha: string;
};

function storedCard(value: unknown, width: TimelineCardPhotoWidth) {
  const rows = Array.isArray(value) ? value : null;
  if (!rows) return null;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    if (Number(record.width) !== width) continue;
    if (
      record.bucket_id !== "our-days-display" ||
      record.mime_type !== "image/webp" ||
      typeof record.object_path !== "string" ||
      record.object_path.length === 0
    ) {
      return null;
    }
    const sha = normalizedSha256Hex(record.sha256_hex);
    if (!sha) return null;
    const card: StoredCard = {
      bucket: "our-days-display",
      mime: "image/webp",
      path: record.object_path,
      sha,
      size: record.size_bytes,
    };
    return card;
  }
  return null;
}

export async function GET(
  request: Request,
  context: Readonly<{ params: Promise<{ momentId: string }> }>,
) {
  const { momentId } = await context.params;
  if (!uuidPattern.test(momentId)) return unavailable();
  const url = new URL(request.url);
  const requestedPhotoId = url.searchParams.get("photo");
  if (requestedPhotoId && !uuidPattern.test(requestedPhotoId)) {
    return unavailable();
  }
  const widthParam = url.searchParams.get("w");
  if (widthParam !== null && !isTimelineCardPhotoWidth(widthParam)) {
    return unavailable();
  }
  const cardWidth: TimelineCardPhotoWidth | null =
    widthParam === null ? null : (Number(widthParam) as TimelineCardPhotoWidth);

  if (localJournalIsEnabled()) {
    const authStarted = performance.now();
    const { readLocalJournalAccess } = await import("@/lib/local-journal/auth");
    const { digestBuffer, readLocalMediaFile } =
      await import("@/lib/local-journal/media-coordinator");
    const { findLocalVisibleMoment } =
      await import("@/lib/local-journal/views");
    const access = await readLocalJournalAccess();
    if (!access)
      return unavailable(mediaTiming(elapsedSince(authStarted), 0, 0));
    const moment = await findLocalVisibleMoment(momentId);
    if (moment?.kind !== "photo") {
      return unavailable(mediaTiming(elapsedSince(authStarted), 0, 0));
    }
    const photos = moment.photos?.length
      ? moment.photos
      : moment.media
        ? [{ id: moment.id, ...moment.media }]
        : [];
    const selected =
      (requestedPhotoId
        ? photos.find((photo) => photo.id === requestedPhotoId)
        : photos[0]) ?? null;
    if (!selected)
      return unavailable(mediaTiming(elapsedSince(authStarted), 0, 0));
    const authMs = elapsedSince(authStarted);
    const expectedSha = selected.displaySha256 ?? selected.sha256;
    if (cardWidth != null && expectedSha) {
      const cached = readCachedCardRendition(expectedSha, cardWidth);
      if (cached)
        return imageResponse(cached, "image/webp", mediaTiming(authMs, 0, 0));
    }
    const fetchStarted = performance.now();
    const relativePath =
      selected.displayRelativePath ?? selected.originalRelativePath;
    const bytes = readLocalMediaFile(relativePath);
    const fetchMs = elapsedSince(fetchStarted);
    if (digestBuffer(bytes) !== expectedSha) {
      return unavailable(mediaTiming(authMs, fetchMs, 0));
    }
    if (cardWidth == null) {
      return new Response(bytes, {
        status: 200,
        headers: {
          ...privateHeaders,
          "Content-Length": String(bytes.byteLength),
          "Content-Type": selected.displayMimeType ?? selected.mimeType,
          "Server-Timing": mediaTiming(authMs, fetchMs, 0),
        },
      });
    }
    const rendered = await renderCardPhoto(bytes, cardWidth);
    if (!rendered.bytes) {
      return unavailable(
        mediaTiming(authMs, fetchMs, rendered.resizeMs, rendered.queueMs),
      );
    }
    if (expectedSha) {
      rememberCardRendition(expectedSha, cardWidth, rendered.bytes);
    }
    return imageResponse(
      rendered.bytes,
      "image/webp",
      mediaTiming(authMs, fetchMs, rendered.resizeMs, rendered.queueMs),
    );
  }
  if (!mediaDeliveryIsEnabled()) {
    return unavailable();
  }

  const authStarted = performance.now();
  const supabase = await createOurDaysServerClient();
  const { data: rows, error: descriptorError } = await supabase.rpc(
    "get_photo_moment_delivery",
    { moment_id: momentId },
  );
  const descriptor = requestedPhotoId
    ? rows?.find((row) => row.photo_id === requestedPhotoId)
    : rows?.[0];
  const authMs = elapsedSince(authStarted);
  if (descriptorError || !descriptor) {
    return unavailable(mediaTiming(authMs, 0, 0));
  }

  if (cardWidth != null) {
    const sha = normalizedSha256Hex(descriptor.output_sha256_hex);
    if (!sha) return unavailable(mediaTiming(authMs, 0, 0));
    const cached = readCachedCardRendition(sha, cardWidth);
    if (cached) {
      return imageResponse(cached, "image/webp", mediaTiming(authMs, 0, 0));
    }
    const stored = storedCard(descriptor.card_renditions, cardWidth);
    if (stored) {
      const fetchStarted = performance.now();
      const verified = await readCappedVerifiedPrivateBytes(
        supabase.storage.from(stored.bucket),
        stored.path,
        { mime: stored.mime, sha: stored.sha, size: stored.size },
        stored.bucket,
      );
      const fetchMs = elapsedSince(fetchStarted);
      if (verified) {
        rememberCardRendition(sha, cardWidth, verified);
        return imageResponse(
          verified,
          "image/webp",
          mediaTiming(authMs, fetchMs, 0),
        );
      }
    }
    const fetchStarted = performance.now();
    const verified = await readCappedVerifiedPrivateBytes(
      supabase.storage.from(descriptor.bucket_id),
      descriptor.object_path,
      {
        size: descriptor.output_size_bytes,
        mime: descriptor.output_mime_type,
        sha: descriptor.output_sha256_hex,
      },
      descriptor.bucket_id,
    );
    const fetchMs = elapsedSince(fetchStarted);
    if (!verified) return unavailable(mediaTiming(authMs, fetchMs, 0));
    const rendered = await renderCardPhoto(verified, cardWidth);
    if (!rendered.bytes) {
      return unavailable(
        mediaTiming(authMs, fetchMs, rendered.resizeMs, rendered.queueMs),
      );
    }
    rememberCardRendition(sha, cardWidth, rendered.bytes);
    return imageResponse(
      rendered.bytes,
      "image/webp",
      mediaTiming(authMs, fetchMs, rendered.resizeMs, rendered.queueMs),
    );
  }

  const fetchStarted = performance.now();
  const photo = await readCappedVerifiedPrivateBytes(
    supabase.storage.from(descriptor.bucket_id),
    descriptor.object_path,
    {
      size: descriptor.output_size_bytes,
      mime: descriptor.output_mime_type,
      sha: descriptor.output_sha256_hex,
    },
    descriptor.bucket_id,
  );
  const fetchMs = elapsedSince(fetchStarted);
  if (!photo) return unavailable(mediaTiming(authMs, fetchMs, 0));
  return imageResponse(photo, descriptor.output_mime_type, mediaTiming(authMs, fetchMs, 0));
}
