"use client";

import { createOurDaysBrowserClient } from "@/lib/supabase/browser";

const maximumPosterBytes = 2 * 1024 * 1024;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const pending = new Set<string>();
const completed = new Set<string>();

function dataUrlToJpegBlob(dataUrl: string) {
  if (!dataUrl.startsWith("data:image/jpeg")) return null;
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (bytes.byteLength < 1 || bytes.byteLength > maximumPosterBytes)
    return null;
  return new Blob([bytes], { type: "image/jpeg" });
}

export async function persistVideoPoster(input: {
  momentId: string;
  posterDataUrl: string;
  width: number;
  height: number;
}) {
  const momentId = input.momentId.trim();
  if (!uuidPattern.test(momentId)) return false;
  if (
    !Number.isInteger(input.width) ||
    !Number.isInteger(input.height) ||
    input.width < 1 ||
    input.height < 1
  ) {
    return false;
  }
  if (completed.has(momentId) || pending.has(momentId)) return false;

  const blob = dataUrlToJpegBlob(input.posterDataUrl);
  if (!blob) return false;

  pending.add(momentId);
  try {
    const supabase = createOurDaysBrowserClient();
    const objectPath = `poster/${momentId}`;
    const { error: uploadError } = await supabase.storage
      .from("our-days-videos")
      .upload(objectPath, blob, {
        cacheControl: "3600",
        contentType: "image/jpeg",
        upsert: false,
      });
    if (
      uploadError &&
      !/already exists|duplicate|resource already/iu.test(uploadError.message)
    ) {
      return false;
    }

    const { error: attachError } = await supabase.rpc(
      "attach_video_moment_poster",
      {
        moment_id: momentId,
        width_px: input.width,
        height_px: input.height,
      },
    );
    if (attachError) return false;
    completed.add(momentId);
    return true;
  } catch {
    return false;
  } finally {
    pending.delete(momentId);
  }
}

export function markVideoPosterPersisted(momentId: string) {
  if (uuidPattern.test(momentId)) completed.add(momentId);
}
