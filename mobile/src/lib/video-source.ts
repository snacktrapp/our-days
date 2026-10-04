import type { SupabaseClient } from "@supabase/supabase-js";

import { videoDeliveryPath } from "./video-playback";

export type VideoSource = Readonly<{
  uri: string;
  headers?: Record<string, string>;
  /** "storage" is a signed Supabase Storage URL. "proxy" is the web app's media route. */
  via: "storage" | "proxy";
}>;

/** Long enough for a two-minute clip plus pauses. AVPlayer keeps issuing range reads while it plays. */
export const signedVideoTtlSeconds = 60 * 60;

/**
 * Where native playback reads a video's bytes.
 *
 * AVPlayer sends every range read as its own request. Through
 * `/api/media/videos/{id}`, each read is a new serverless call: it checks the
 * cookie, calls the delivery RPC, signs a URL, and only then fetches from
 * Storage. iPhone MOVs keep the `moov` index at the end, so the player needs
 * several of those round trips before the first frame, and the frame sits
 * black meanwhile. On a 32 MB 4K HEVC MOV with the moov at the end, playing
 * through the proxy took about 7 s to the first frame, against about 3 s
 * straight from Storage.
 *
 * The app makes the same two calls the route makes, with the same session and
 * the same rules (`get_video_moment_delivery`, then a signed URL under the
 * `our_days_videos_select_live_family` policy), then hands AVPlayer the
 * Storage URL. Storage answers ranges natively with the right Content-Type.
 * If signing fails for any reason, it falls back to the route with the cookie.
 */
export async function resolveVideoSource(
  supabase: SupabaseClient | null,
  momentId: string,
  fallback: Readonly<{ url: (path: string) => string; headers?: Record<string, string> | null }>,
): Promise<VideoSource> {
  const proxy: VideoSource = {
    uri: fallback.url(videoDeliveryPath(momentId)),
    headers: fallback.headers ?? undefined,
    via: "proxy",
  };
  if (!supabase) return proxy;
  try {
    const { data: rows, error } = await supabase.rpc("get_video_moment_delivery", {
      moment_id: momentId,
    });
    const descriptor = (Array.isArray(rows) ? rows[0] : rows) as
      | { bucket_id?: string; object_path?: string }
      | null
      | undefined;
    if (error || !descriptor?.bucket_id || !descriptor.object_path) return proxy;
    const { data: signed, error: signingError } = await supabase.storage
      .from(descriptor.bucket_id)
      .createSignedUrl(descriptor.object_path, signedVideoTtlSeconds);
    if (signingError || !signed?.signedUrl) return proxy;
    return { uri: signed.signedUrl, via: "storage" };
  } catch {
    return proxy;
  }
}
