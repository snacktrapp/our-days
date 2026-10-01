/**
 * Inline video playback shared by video posts and Insight clips.
 *
 * The web player is `VideoMomentMedia`: a poster (or a 16:9 mat), no
 * autoplay, object-fit contain on #050b08. An Insight's source URL can carry
 * the time in the full source (`t=120`, `t=1m30s`, `t=1h2m3s`, `start=`, or
 * `#t=`). That time is attribution only: the stored clip already starts there.
 */

const plainSeconds = /^\d+(?:\.\d+)?s?$/iu;
const clock =
  /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/iu;

export function videoDeliveryPath(momentId: string) {
  return `/api/media/videos/${momentId}`;
}

/** Poster width/height when both are known. Otherwise the web's 16:9 video frame. */
export function videoAspectRatio(width?: number, height?: number) {
  if (width && height && width > 0 && height > 0) return width / height;
  return 16 / 9;
}

function clockSeconds(value: string) {
  const token = value.trim();
  if (!token) return null;
  if (plainSeconds.test(token)) {
    const seconds = Number(token.replace(/s$/iu, ""));
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
  }
  const match = clock.exec(token);
  if (!match || (!match[1] && !match[2] && !match[3])) return null;
  const seconds =
    Number(match[1] ?? 0) * 3600 +
    Number(match[2] ?? 0) * 60 +
    Number(match[3] ?? 0);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function positive(seconds: number | null) {
  return seconds !== null && seconds > 0 ? seconds : null;
}

/** Seconds into an Insight clip, from its saved source URL. Zero when none. */
export function insightClipStartSeconds(sourceUrl: string | undefined) {
  if (!sourceUrl) return 0;
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return 0;
  }
  const hash = url.hash.replace(/^#/u, "");
  if (hash) {
    const fragment = new URLSearchParams(hash).get("t");
    if (fragment) {
      const start = fragment.split(",")[0] ?? "";
      const seconds = positive(clockSeconds(start));
      if (seconds !== null) return seconds;
    }
  }
  const fromQuery = positive(clockSeconds(url.searchParams.get("t") ?? ""));
  if (fromQuery !== null) return fromQuery;
  return positive(clockSeconds(url.searchParams.get("start") ?? "")) ?? 0;
}

/**
 * Where playback of the stored file starts: always 0.
 *
 * An Insight's stored video is the excerpt itself, cut from the source at the
 * time on its URL (a 13 s clip for `&t=1695`). The `t=` on `sourceUrl` is
 * attribution for the full source, not an offset into the stored clip. The web
 * player starts these at 0 too. Seeking the clip to 1695 s asked AVPlayer for
 * a time far past the end of a 13 s file.
 */
export function clipStartSeconds(
  _moment: Readonly<{ kind: string; sourceUrl?: string }>,
) {
  return 0;
}

/**
 * Poster until the first tap. Playback continues only while the row is on
 * screen. Coming back on screen stays paused (`resumed: false`) until the
 * next tap.
 */
export function videoPlaybackPlan(
  input: Readonly<{
    started: boolean;
    onScreen: boolean;
    startSeconds: number;
    /** False after the row leaves the screen, until the next tap. */
    resumed?: boolean;
  }>,
) {
  const resumed = input.resumed !== false;
  const playing = input.started && input.onScreen && resumed;
  return {
    showPoster: !input.started,
    playing,
    paused: input.started && !playing,
    startSeconds: input.startSeconds,
  };
}

/**
 * iOS uses AVPlayerViewController’s inline bar (scrub, pause, fullscreen, volume).
 * A custom layer on top of that bar would cover those buttons, so the surface
 * does not steal taps there. Other platforms pause on tap.
 */
export function usesNativePlaybackControls(platform: string) {
  return platform === "ios";
}

/** Tap the poster or a paused frame to play. Tap a playing frame to pause. */
export function videoSurfaceAction(
  input: Readonly<{
    started: boolean;
    onScreen: boolean;
    resumed?: boolean;
    nativeControls?: boolean;
  }>,
) {
  const resumed = input.resumed !== false;
  if (!input.started || !input.onScreen || !resumed) return "play" as const;
  if (input.nativeControls) return "native" as const;
  return "pause" as const;
}
