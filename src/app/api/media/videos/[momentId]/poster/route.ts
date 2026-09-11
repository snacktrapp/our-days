import {
  localJournalIsEnabled,
  mediaDeliveryIsEnabled,
} from "../../../../../../../config/our-days-environment";
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
    if (moment?.kind !== "video" || !moment.media?.posterRelativePath) {
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
        ...privateHeaders,
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

  const { data: file, error: downloadError } = await supabase.storage
    .from(descriptor.bucket_id)
    .download(descriptor.object_path);
  if (downloadError || !file) return unavailable();

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== descriptor.size_bytes) return unavailable();
  if (file.type && file.type !== descriptor.mime_type) return unavailable();

  return new Response(bytes, {
    status: 200,
    headers: {
      ...privateHeaders,
      "Content-Length": String(bytes.byteLength),
      "Content-Type": descriptor.mime_type,
    },
  });
}
