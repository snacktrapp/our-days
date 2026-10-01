import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Same ceiling the poster RPC enforces. */
const maximumPosterBytes = 2 * 1024 * 1024;
/** A solid or near-black frame compresses far below a real picture. */
const minimumPosterBytes = 2_500;
const posterTimes = [0.18, 0.36, 0.72, 1.2];

export type VideoPoster = Readonly<{
  bytes: ArrayBuffer;
  width: number;
  height: number;
  /** Local file the composer tile can show. Null when only bytes were captured. */
  uri: string | null;
}>;

type ThumbPlayer = {
  muted: boolean;
  status?: string;
  addListener?: (
    event: "statusChange",
    listener: (event: { status?: string }) => void,
  ) => { remove: () => void };
  generateThumbnailsAsync?: (
    times: number[],
    options?: { maxWidth?: number },
  ) => Promise<readonly { width?: number; height?: number }[]>;
  release?: () => void;
};

function waitUntilReady(player: ThumbPlayer) {
  if (player.status === "readyToPlay") return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription?.remove();
      reject(new Error("poster-timeout"));
    }, 8_000);
    const subscription = player.addListener?.("statusChange", (event) => {
      if (event.status === "readyToPlay") {
        clearTimeout(timer);
        subscription?.remove();
        resolve();
      } else if (event.status === "error") {
        clearTimeout(timer);
        subscription?.remove();
        reject(new Error("poster-error"));
      }
    });
    if (!subscription) {
      clearTimeout(timer);
      reject(new Error("poster-unavailable"));
    }
  });
}

/**
 * Still from a local video using expo-video, which is already in the 0.5.0
 * binary. `expo-video-thumbnails` is not. Several times are tried because the
 * first frame of an iPhone clip is often black.
 */
export async function captureDeviceVideoPoster(uri: string): Promise<VideoPoster | null> {
  if (Platform.OS === "web" || !uri) return null;
  if (!requireOptionalNativeModule("ExpoVideo")) return null;
  let player: ThumbPlayer | null = null;
  try {
    const video = await import("expo-video");
    const images = await import("expo-image-manipulator");
    if (typeof video.createVideoPlayer !== "function") return null;
    player = video.createVideoPlayer(uri) as ThumbPlayer;
    player.muted = true;
    if (typeof player.generateThumbnailsAsync !== "function") return null;
    await waitUntilReady(player);
    const thumbs = await player.generateThumbnailsAsync(posterTimes, { maxWidth: 720 });
    let best: VideoPoster | null = null;
    for (const thumb of thumbs) {
      const width = thumb.width ?? 0;
      const height = thumb.height ?? 0;
      if (width < 2 || height < 2) continue;
      const rendered = await images.ImageManipulator.manipulate(
        thumb as Parameters<typeof images.ImageManipulator.manipulate>[0],
      ).renderAsync();
      const saved = await rendered.saveAsync({
        compress: 0.72,
        format: images.SaveFormat.JPEG,
      });
      const response = await fetch(saved.uri);
      if (!response.ok) continue;
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength < minimumPosterBytes || bytes.byteLength > maximumPosterBytes) continue;
      if (!best || bytes.byteLength > best.bytes.byteLength) {
        best = {
          bytes,
          width: Math.round(saved.width || width),
          height: Math.round(saved.height || height),
          uri: saved.uri,
        };
      }
    }
    return best;
  } catch {
    return null;
  } finally {
    try {
      player?.release?.();
    } catch {
      // The player is only a thumbnail source.
    }
  }
}

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
