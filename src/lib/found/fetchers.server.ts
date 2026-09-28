import "server-only";

import { canonicalFoundText } from "./normalize.server";
import { loadBiblePassage } from "./bible.server";
import type { FetchedSource, FoundLead } from "./leads.server";
import { fetchPublicPage } from "./web.server";
import { fetchYoutubeTranscript, youtubeVideoId } from "./youtube.server";
import { transcriptFromCues } from "./vtt.server";

function clean(value: string | undefined) {
  const trimmed = value?.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, 200) : undefined;
}

export async function fetchFoundSource(
  lead: FoundLead,
  signal: AbortSignal,
): Promise<FetchedSource | null> {
  if (signal.aborted) return null;
  if (lead.kind === "bible" && lead.book && lead.chapter) {
    const passage = await loadBiblePassage(
      lead.book,
      lead.chapter,
      lead.startVerse ?? 1,
      lead.endVerse ?? lead.startVerse ?? 1,
    );
    if (!passage) return null;
    return {
      kind: "bible",
      identity: `bible:${passage.book}:${passage.chapter}:${passage.verseSpans[0]?.verse ?? 1}`,
      text: passage.text,
      sourceUrl: passage.sourceUrl,
      title: passage.book,
      verseSpans: passage.verseSpans,
    };
  }
  if (lead.kind === "youtube") {
    const videoId =
      (lead.videoId ? youtubeVideoId(lead.videoId) : null) ??
      (lead.url ? youtubeVideoId(lead.url) : null);
    if (!videoId) return null;
    const cues = await fetchYoutubeTranscript(videoId, signal);
    if (!cues?.length) return null;
    const transcript = transcriptFromCues(cues);
    if (!transcript.text) return null;
    return {
      kind: "youtube",
      identity: `youtube:${videoId}`,
      text: transcript.text,
      sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
      speaker: clean(lead.speaker),
      title: clean(lead.title),
      videoId,
      timedWords: transcript.words,
    };
  }
  if (lead.kind === "web" && lead.url) {
    const page = await fetchPublicPage(lead.url, signal);
    if (!page) return null;
    return {
      kind: "web",
      identity: `web:${page.url}`,
      text: canonicalFoundText(page.text),
      sourceUrl: page.url,
      speaker: clean(lead.speaker),
      title: clean(lead.title),
    };
  }
  return null;
}
