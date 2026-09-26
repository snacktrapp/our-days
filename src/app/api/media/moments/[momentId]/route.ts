import {
  localJournalIsEnabled,
  mediaDeliveryIsEnabled,
} from "../../../../../../config/our-days-environment";
import { openSignedPrivateObject } from "@/lib/private-media-delivery";
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

function unavailable() {
  return new Response(null, { status: 404, headers: privateHeaders });
}

export async function GET(
  request: Request,
  context: Readonly<{ params: Promise<{ momentId: string }> }>,
) {
  const { momentId } = await context.params;
  if (!uuidPattern.test(momentId)) return unavailable();
  const requestedPhotoId = new URL(request.url).searchParams.get("photo");
  if (requestedPhotoId && !uuidPattern.test(requestedPhotoId)) {
    return unavailable();
  }
  if (localJournalIsEnabled()) {
    const { readLocalJournalAccess } = await import("@/lib/local-journal/auth");
    const { digestBuffer, readLocalMediaFile } =
      await import("@/lib/local-journal/media-coordinator");
    const { findLocalVisibleMoment } =
      await import("@/lib/local-journal/views");
    const access = await readLocalJournalAccess();
    if (!access) return unavailable();
    const moment = await findLocalVisibleMoment(momentId);
    if (moment?.kind !== "photo") return unavailable();
    const photos = moment.photos?.length
      ? moment.photos
      : moment.media
        ? [{ id: moment.id, ...moment.media }]
        : [];
    const selected =
      (requestedPhotoId
        ? photos.find((photo) => photo.id === requestedPhotoId)
        : photos[0]) ?? null;
    if (!selected) return unavailable();
    const relativePath =
      selected.displayRelativePath ?? selected.originalRelativePath;
    const bytes = readLocalMediaFile(relativePath);
    const expectedSha = selected.displaySha256 ?? selected.sha256;
    if (digestBuffer(bytes) !== expectedSha) return unavailable();
    return new Response(bytes, {
      status: 200,
      headers: {
        ...privateHeaders,
        "Content-Length": String(bytes.byteLength),
        "Content-Type": selected.displayMimeType ?? selected.mimeType,
      },
    });
  }
  if (!mediaDeliveryIsEnabled()) {
    return unavailable();
  }

  const supabase = await createOurDaysServerClient();
  const { data: rows, error: descriptorError } = await supabase.rpc(
    "get_photo_moment_delivery",
    { moment_id: momentId },
  );
  const descriptor = requestedPhotoId
    ? rows?.find((row) => row.photo_id === requestedPhotoId)
    : rows?.[0];
  if (descriptorError || !descriptor) return unavailable();

  const photo = await openSignedPrivateObject(
    supabase.storage.from(descriptor.bucket_id),
    descriptor.object_path,
    {
      size: descriptor.output_size_bytes,
      mime: descriptor.output_mime_type,
      sha: descriptor.output_sha256_hex,
    },
  );
  if (!photo) return unavailable();

  // No ETag: the descriptor digest is checked while the body streams, so a
  // hash ETag would require buffering the whole object before the first byte.
  // Cache-Control stays private/no-store, which is what keeps iOS from pinning.
  return new Response(photo.stream, {
    status: 200,
    headers: {
      ...privateHeaders,
      ...(photo.contentLength == null
        ? {}
        : { "Content-Length": String(photo.contentLength) }),
      "Content-Type": descriptor.output_mime_type,
    },
  });
}
