const videoIdPattern = /^[A-Za-z0-9_-]{11}$/u;
const thumbVariants = ["hqdefault", "mqdefault", "default"] as const;

export type YoutubeThumbVariant = (typeof thumbVariants)[number];

export type YoutubePlayback = Readonly<{
  id: string;
  start: number;
}>;

function integerStart(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  if (/^\d+$/u.test(trimmed)) return Number(trimmed);
  if (/^\d+s$/iu.test(trimmed)) return Number(trimmed.slice(0, -1));
  const clock = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/iu.exec(trimmed);
  if (!clock || (!clock[1] && !clock[2] && !clock[3])) return 0;
  return (
    Number(clock[1] ?? 0) * 3600 +
    Number(clock[2] ?? 0) * 60 +
    Number(clock[3] ?? 0)
  );
}

function safeStart(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) return 0;
  return value;
}

/**
 * Video id and start second from a stored https YouTube watch URL.
 * Only youtube.com and youtu.be hosts are accepted, and the id must be
 * the 11-character watch id. Embed paths and other hosts are ignored.
 */
export function youtubePlaybackFromSource(
  value: string,
): YoutubePlayback | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  let id = "";
  if (host === "youtu.be") {
    id = url.pathname.split("/").filter(Boolean)[0] ?? "";
  } else if (host === "youtube.com" || host.endsWith(".youtube.com")) {
    id = url.searchParams.get("v") ?? "";
  } else {
    return null;
  }
  if (!videoIdPattern.test(id)) return null;
  const start = safeStart(
    integerStart(
      url.searchParams.get("t") ?? url.searchParams.get("start") ?? "",
    ),
  );
  return { id, start };
}

export function youtubeThumbnailUrl(id: string, variant: YoutubeThumbVariant) {
  if (!videoIdPattern.test(id) || !thumbVariants.includes(variant)) return null;
  return `https://i.ytimg.com/vi/${id}/${variant}.jpg`;
}

export function youtubeEmbedSrc(playback: YoutubePlayback) {
  if (!videoIdPattern.test(playback.id)) return null;
  const start = safeStart(playback.start);
  const params = new URLSearchParams({
    start: String(start),
    autoplay: "1",
    playsinline: "1",
    rel: "0",
  });
  return `https://www.youtube-nocookie.com/embed/${playback.id}?${params.toString()}`;
}
