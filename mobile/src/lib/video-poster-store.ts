import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Poster bytes and the upload, with no React Native or Expo imports, so
 * posts.ts and pick-media.ts stay loadable by the Node e2e suite.
 */

/** Same ceiling the poster RPC enforces. */
export const maximumPosterBytes = 2 * 1024 * 1024;
/** A solid or near-black frame compresses far below a real picture. */
export const minimumPosterBytes = 2_500;

export type VideoPoster = Readonly<{
  bytes: ArrayBuffer;
  width: number;
  height: number;
  /** Local file the composer tile can show. Null when only bytes were captured. */
  uri: string | null;
}>;

/** Upload `poster/{momentId}` and record it, the same RPC the web composer uses. */
export async function persistVideoPoster(
  supabase: SupabaseClient,
  momentId: string,
  poster: VideoPoster,
) {
  if (poster.bytes.byteLength < minimumPosterBytes || poster.bytes.byteLength > maximumPosterBytes) {
    return false;
  }
  if (poster.width < 1 || poster.height < 1) return false;
  const path = `poster/${momentId}`;
  const { error: uploadError } = await supabase.storage.from("our-days-videos").upload(path, new Uint8Array(poster.bytes), {
    contentType: "image/jpeg",
    cacheControl: "3600",
    upsert: false,
  });
  if (
    uploadError &&
    !/already exists|duplicate|resource already/iu.test(uploadError.message)
  ) {
    return false;
  }
  const { error: attachError } = await supabase.rpc("attach_video_moment_poster", {
    moment_id: momentId,
    width_px: poster.width,
    height_px: poster.height,
  });
  return !attachError;
}
