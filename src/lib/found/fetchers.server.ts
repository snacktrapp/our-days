import "server-only";

import { canonicalFoundText } from "./normalize.server";
import { loadBiblePassage } from "./bible.server";
import type {
  FetchedSource,
  FoundFetchAttempt,
  FoundFetchResult,
  FoundFetchStatus,
  FoundLead,
} from "./leads.server";
import { pageTitleFromHtml, readPublicPage } from "./web.server";
import { fetchYoutubeTranscript, youtubeVideoId } from "./youtube.server";
import { timedTranscriptFromPage } from "./transcript-page.server";
import { transcriptFromCues } from "./vtt.server";

function clean(value: string | undefined) {
  const trimmed = value?.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, 200) : undefined;
}

function attempt(
  host: string | undefined,
  fetchStatus: FoundFetchStatus,
  httpStatus?: number,
): FoundFetchAttempt {
  return {
    ...(host ? { host } : {}),
    fetchStatus,
    ...(httpStatus !== undefined ? { httpStatus } : {}),
  };
}

const youtubeLinkHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
]);

function decodeAttribute(value: string) {
  return value
    .replace(/&#x0*26;|&#0*38;/gi, "&")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function attributeUrls(html: string) {
  const visible = html.replace(/<!--[\s\S]*?(?:-->|$)/g, " ");
  const pattern =
    /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+))/giu;
  const urls: string[] = [];
  for (const match of visible.matchAll(pattern)) {
    const value = decodeAttribute(
      match[1] ?? match[2] ?? match[3] ?? "",
    ).trim();
    if (value) urls.push(value);
  }
  return urls;
}

function htmlLinksToVideo(html: string, videoId: string, pageUrl: string) {
  const id = youtubeVideoId(videoId);
  if (!id || !html) return false;
  for (const raw of attributeUrls(html)) {
    let url: URL;
    try {
      url = new URL(raw, pageUrl);
    } catch {
      continue;
    }
    if (!youtubeLinkHosts.has(url.hostname.toLowerCase())) continue;
    if (youtubeVideoId(url.toString()) === id) return true;
  }
  return false;
}

function withFetchedDetails(
  source: FetchedSource,
  html: string | undefined,
  details: Readonly<{ title?: string; channel?: string }> | null,
): FetchedSource {
  const fetchedTitle =
    clean(html ? pageTitleFromHtml(html) : undefined) ?? clean(details?.title);
  const channelName = clean(details?.channel);
  return {
    ...source,
    ...(fetchedTitle ? { fetchedTitle } : {}),
    ...(channelName ? { channelName } : {}),
  };
}

async function youtubeDetails(videoId: string, signal: AbortSignal) {
  const target = `https://www.youtube.com/watch?v=${videoId}`;
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(target)}&format=json`;
  try {
    const timeout = AbortSignal.timeout(2_000);
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.any([signal, timeout]),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      title?: unknown;
      author_name?: unknown;
    };
    return {
      ...(typeof body.title === "string" ? { title: body.title } : {}),
      ...(typeof body.author_name === "string"
        ? { channel: body.author_name }
        : {}),
    };
  } catch {
    return null;
  }
}

function webSource(
  lead: FoundLead,
  text: string,
  sourceUrl: string,
  timedWords?: FetchedSource["timedWords"],
  html?: string,
): FetchedSource {
  return withFetchedDetails(
    {
      kind: "web",
      identity: `web:${sourceUrl}`,
      text,
      sourceUrl,
      speaker: clean(lead.speaker),
      title: clean(lead.title),
      ...(timedWords && timedWords.length > 0 ? { timedWords } : {}),
    },
    html,
    null,
  );
}

function youtubeSource(
  videoId: string,
  text: string,
  lead: FoundLead,
  timedWords: FetchedSource["timedWords"],
  sourceUrl: string,
  html?: string,
  details?: Readonly<{ title?: string; channel?: string }> | null,
): FetchedSource {
  return withFetchedDetails(
    {
      kind: "youtube",
      identity: `youtube:${videoId}`,
      text,
      sourceUrl,
      speaker: clean(lead.speaker),
      title: clean(lead.title),
      videoId,
      ...(timedWords && timedWords.length > 0 ? { timedWords } : {}),
    },
    html,
    details ?? null,
  );
}

export async function fetchFoundSource(
  lead: FoundLead,
  signal: AbortSignal,
): Promise<FoundFetchResult> {
  if (signal.aborted)
    return { source: null, attempts: [attempt(undefined, "empty")] };
  if (lead.kind === "bible" && lead.book && lead.chapter) {
    const passage = await loadBiblePassage(
      lead.book,
      lead.chapter,
      lead.startVerse ?? 1,
      lead.endVerse ?? lead.startVerse ?? 1,
    );
    if (!passage) {
      return { source: null, attempts: [attempt("ebible.org", "empty")] };
    }
    return {
      source: {
        kind: "bible",
        identity: `bible:${passage.book}:${passage.chapter}:${passage.verseSpans[0]?.verse ?? 1}`,
        text: passage.text,
        sourceUrl: passage.sourceUrl,
        title: passage.book,
        verseSpans: passage.verseSpans,
      },
      attempts: [attempt("ebible.org", "ok")],
    };
  }
  if (lead.kind === "youtube") {
    const attempts: FoundFetchAttempt[] = [];
    const videoId =
      (lead.videoId ? youtubeVideoId(lead.videoId) : null) ??
      (lead.url ? youtubeVideoId(lead.url) : null);
    let source: FetchedSource | null = null;
    if (videoId) {
      const captions = await fetchYoutubeTranscript(videoId, signal);
      attempts.push(
        attempt(captions.host, captions.fetchStatus, captions.httpStatus),
      );
      if (captions.cues?.length) {
        const transcript = transcriptFromCues(captions.cues);
        if (transcript.text) {
          source = youtubeSource(
            videoId,
            transcript.text,
            lead,
            transcript.words,
            `https://www.youtube.com/watch?v=${videoId}`,
            undefined,
            await youtubeDetails(videoId, signal),
          );
        }
      }
    }
    if (!source && lead.transcriptUrl) {
      const page = await readPublicPage(lead.transcriptUrl, signal);
      if (!page.page) {
        attempts.push(attempt(page.host, page.fetchStatus, page.httpStatus));
      } else {
        const timed = timedTranscriptFromPage(page.page.text);
        if (!timed.text) {
          attempts.push(attempt(page.host, "empty", page.httpStatus));
        } else if (
          videoId &&
          htmlLinksToVideo(page.page.html ?? "", videoId, page.page.url)
        ) {
          attempts.push(attempt(page.host, "ok", page.httpStatus));
          source = youtubeSource(
            videoId,
            timed.text,
            lead,
            timed.words,
            page.page.url,
            page.page.html,
            await youtubeDetails(videoId, signal),
          );
        } else if (videoId) {
          attempts.push(attempt(page.host, "ok", page.httpStatus));
          source = webSource(
            lead,
            timed.text,
            page.page.url,
            undefined,
            page.page.html,
          );
        } else {
          attempts.push(attempt(page.host, "ok", page.httpStatus));
          source = webSource(
            lead,
            timed.text,
            page.page.url,
            timed.words,
            page.page.html,
          );
        }
      }
    }
    if (attempts.length === 0) {
      attempts.push(attempt("www.youtube.com", "empty"));
    }
    return { source, attempts };
  }
  if (lead.kind === "web" && lead.url) {
    const page = await readPublicPage(lead.url, signal);
    if (!page.page) {
      return {
        source: null,
        attempts: [attempt(page.host, page.fetchStatus, page.httpStatus)],
      };
    }
    return {
      source: webSource(
        lead,
        canonicalFoundText(page.page.text),
        page.page.url,
        undefined,
        page.page.html,
      ),
      attempts: [attempt(page.host, "ok", page.httpStatus)],
    };
  }
  return { source: null, attempts: [attempt(undefined, "empty")] };
}
