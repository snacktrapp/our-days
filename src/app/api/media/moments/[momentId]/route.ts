import {
  localJournalIsEnabled,
  mediaDeliveryIsEnabled,
} from "../../../../../../config/our-days-environment";
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

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
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
    if (!moment?.media || moment.kind !== "photo") return unavailable();
    const relativePath =
      moment.media.displayRelativePath ?? moment.media.originalRelativePath;
    const bytes = readLocalMediaFile(relativePath);
    const expectedSha = moment.media.displaySha256 ?? moment.media.sha256;
    if (digestBuffer(bytes) !== expectedSha) return unavailable();
    return new Response(bytes, {
      status: 200,
      headers: {
        ...privateHeaders,
        "Content-Length": String(bytes.byteLength),
        "Content-Type": moment.media.displayMimeType ?? moment.media.mimeType,
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
  const descriptor = rows?.[0];
  if (descriptorError || !descriptor) return unavailable();

  const { data: photo, error: downloadError } = await supabase.storage
    .from(descriptor.bucket_id)
    .download(descriptor.object_path, {}, { cache: "no-store" });
  if (
    downloadError ||
    !photo ||
    photo.size !== descriptor.output_size_bytes ||
    photo.type !== descriptor.output_mime_type
  ) {
    return unavailable();
  }

  const bytes = await photo.arrayBuffer();
  const digest = hex(await crypto.subtle.digest("SHA-256", bytes));
  if (digest !== descriptor.output_sha256_hex) return unavailable();

  return new Response(bytes, {
    status: 200,
    headers: {
      ...privateHeaders,
      "Content-Length": String(bytes.byteLength),
      "Content-Type": descriptor.output_mime_type,
    },
  });
}
