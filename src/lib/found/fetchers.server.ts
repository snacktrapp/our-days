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
import {
  pageSiteNameFromHtml,
  pageTitleFromHtml,
  publisherDisplayTitle,
  readPublicPage,
} from "./web.server";
import {
  fetchYoutubeTranscript,
  normalizeYoutubeLead,
  youtubeVideoId,
} from "./youtube.server";
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
  step?: FoundFetchAttempt["step"],
  path?: string,
): FoundFetchAttempt {
  return {
    ...(host ? { host } : {}),
    fetchStatus,
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...(step ? { step } : {}),
    ...(path ? { path } : {}),
  };
}

function urlPath(value: string) {
  try {
    return new URL(value).pathname;
  } catch {
    return undefined;
  }
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
  return youtubeLinks(html, pageUrl).some((link) => link.id === videoId);
}

function youtubeClockSeconds(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d+$/u.test(trimmed)) return Number(trimmed);
  const clock = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/iu.exec(trimmed);
  if (!clock || (!clock[1] && !clock[2] && !clock[3])) return null;
  return (
    Number(clock[1] ?? 0) * 3600 +
    Number(clock[2] ?? 0) * 60 +
    Number(clock[3] ?? 0)
  );
}

function youtubeLinks(html: string, pageUrl: string) {
  const links: Array<{ id: string; seconds: number | null }> = [];
  if (!html) return links;
  for (const raw of attributeUrls(html)) {
    let url: URL;
    try {
      url = new URL(raw, pageUrl);
    } catch {
      continue;
    }
    if (!youtubeLinkHosts.has(url.hostname.toLowerCase())) continue;
    const id = youtubeVideoId(url.toString());
    if (!id) continue;
    const seconds = youtubeClockSeconds(
      url.searchParams.get("t") ?? url.searchParams.get("start") ?? "",
    );
    links.push({ id, seconds });
  }
  return links;
}

function majorityVideoId(ids: readonly string[]) {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  let best: string | undefined;
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

/** Video id from timestamped YouTube links. A t=0 full-episode link loses to a later marker. */
function timestampedVideoId(html: string, pageUrl: string) {
  const timed = youtubeLinks(html, pageUrl).filter(
    (link) => link.seconds !== null,
  );
  const positive = timed.filter((link) => (link.seconds ?? 0) > 0);
  const pool = positive.length > 0 ? positive : timed;
  return majorityVideoId(pool.map((link) => link.id));
}

function soleLinkedVideoId(html: string, pageUrl: string) {
  const ids = [...new Set(youtubeLinks(html, pageUrl).map((link) => link.id))];
  return ids.length === 1 ? ids[0] : undefined;
}

function resolvedTranscriptVideo(
  html: string,
  pageUrl: string,
  leadVideoId: string | null,
  hasClocks: boolean,
) {
  const stamped = hasClocks ? timestampedVideoId(html, pageUrl) : undefined;
  const linked =
    leadVideoId && htmlLinksToVideo(html, leadVideoId, pageUrl)
      ? leadVideoId
      : null;
  if (stamped && hasClocks) return stamped;
  if (linked) return linked;
  if (!hasClocks) return undefined;
  return soleLinkedVideoId(html, pageUrl);
}

function withFetchedDetails(
  source: FetchedSource,
  html: string | undefined,
  details: Readonly<{ title?: string; channel?: string }> | null,
): FetchedSource {
  const siteName = html ? pageSiteNameFromHtml(html) : undefined;
  const rawTitle = html ? pageTitleFromHtml(html) : undefined;
  const pageTitle = rawTitle
    ? publisherDisplayTitle(rawTitle, siteName)
    : undefined;
  const fetchedTitle =
    clean(details?.title ? publisherDisplayTitle(details.title) : undefined) ??
    clean(pageTitle);
  const channelName =
    clean(details?.channel) ??
    (source.kind === "youtube" ? clean(siteName) : undefined);
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
    const normalized = normalizeYoutubeLead(lead);
    const attempts: FoundFetchAttempt[] = [];
    const videoId =
      (normalized.videoId ? youtubeVideoId(normalized.videoId) : null) ??
      (normalized.url ? youtubeVideoId(normalized.url) : null);
    let source: FetchedSource | null = null;
    if (videoId) {
      const captions = await fetchYoutubeTranscript(videoId, signal);
      if (captions.attempts && captions.attempts.length > 0) {
        attempts.push(...captions.attempts);
      } else {
        attempts.push(
          attempt(captions.host, captions.fetchStatus, captions.httpStatus),
        );
      }
      if (captions.cues?.length) {
        const transcript = transcriptFromCues(captions.cues);
        if (transcript.text) {
          source = youtubeSource(
            videoId,
            transcript.text,
            normalized,
            transcript.words,
            `https://www.youtube.com/watch?v=${videoId}`,
            undefined,
            await youtubeDetails(videoId, signal),
          );
        }
      }
    }
    if (!source && normalized.transcriptUrl) {
      const page = await readPublicPage(normalized.transcriptUrl, signal);
      const path = urlPath(normalized.transcriptUrl);
      if (!page.page) {
        attempts.push(
          attempt(
            page.host,
            page.fetchStatus,
            page.httpStatus,
            "transcript",
            path,
          ),
        );
      } else {
        const timed = timedTranscriptFromPage(page.page.text);
        const html = page.page.html ?? "";
        const resolved = resolvedTranscriptVideo(
          html,
          page.page.url,
          videoId,
          timed.words.length > 0,
        );
        if (!timed.text) {
          attempts.push(
            attempt(page.host, "empty", page.httpStatus, "transcript", path),
          );
        } else if (resolved) {
          attempts.push(
            attempt(page.host, "ok", page.httpStatus, "transcript", path),
          );
          source = youtubeSource(
            resolved,
            timed.text,
            normalized,
            timed.words,
            page.page.url,
            html,
            await youtubeDetails(resolved, signal),
          );
        } else if (videoId) {
          attempts.push(
            attempt(page.host, "ok", page.httpStatus, "transcript", path),
          );
          source = webSource(
            normalized,
            timed.text,
            page.page.url,
            undefined,
            html,
          );
        } else {
          attempts.push(
            attempt(page.host, "ok", page.httpStatus, "transcript", path),
          );
          source = webSource(
            normalized,
            timed.text,
            page.page.url,
            timed.words,
            html,
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
    const path = urlPath(lead.url);
    if (!page.page) {
      return {
        source: null,
        attempts: [
          attempt(
            page.host,
            page.fetchStatus,
            page.httpStatus,
            undefined,
            path,
          ),
        ],
      };
    }
    const html = page.page.html ?? "";
    const timed = timedTranscriptFromPage(page.page.text);
    const resolved =
      timed.words.length > 0 && timed.text
        ? resolvedTranscriptVideo(html, page.page.url, null, true)
        : undefined;
    if (resolved) {
      return {
        source: youtubeSource(
          resolved,
          timed.text,
          lead,
          timed.words,
          page.page.url,
          html,
          await youtubeDetails(resolved, signal),
        ),
        attempts: [attempt(page.host, "ok", page.httpStatus, undefined, path)],
      };
    }
    return {
      source: webSource(
        lead,
        canonicalFoundText(page.page.text),
        page.page.url,
        undefined,
        html,
      ),
      attempts: [attempt(page.host, "ok", page.httpStatus, undefined, path)],
    };
  }
  return { source: null, attempts: [attempt(undefined, "empty")] };
}
