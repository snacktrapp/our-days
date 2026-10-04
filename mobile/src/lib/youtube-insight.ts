/** A YouTube link is an Insight, the same card the web shows with Listen. */

export function youtubeClipUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase();
    if (
      host === "youtu.be" ||
      host === "youtube.com" ||
      host.endsWith(".youtube.com")
    ) {
      return trimmed;
    }
  } catch {
    return null;
  }
  return null;
}

/** A written entry that is only a YouTube URL is posted as an Insight. */
export function loneYoutubeClip(body: string) {
  return youtubeClipUrl(body);
}

export function youtubeInsightAttribution(attribution: string, sourceUrl: string) {
  const named = attribution.trim();
  if (named) return named;
  return youtubeClipUrl(sourceUrl) ? "YouTube" : "";
}
