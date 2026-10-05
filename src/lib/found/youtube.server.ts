import "server-only";

import type {
  FoundFetchAttempt,
  FoundFetchStatus,
  FoundFetchStep,
  FoundLead,
} from "./leads.server";
import type { CaptionCue } from "./vtt.server";

const videoIdPattern = /^[A-Za-z0-9_-]{11}$/u;
const captionByteLimit = 2_000_000;
const browserUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export function youtubeVideoId(value: string) {
  const trimmed = value.trim();
  if (videoIdPattern.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
      return videoIdPattern.test(id) ? id : null;
    }
    if (
      host === "youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "youtube-nocookie.com" ||
      host.endsWith(".youtube-nocookie.com")
    ) {
      const fromQuery = url.searchParams.get("v");
      if (fromQuery && videoIdPattern.test(fromQuery)) return fromQuery;
      const parts = url.pathname.split("/").filter(Boolean);
      const marker = parts.findIndex(
        (part) => part === "embed" || part === "shorts" || part === "live",
      );
      const id = marker >= 0 ? (parts[marker + 1] ?? "") : "";
      return videoIdPattern.test(id) ? id : null;
    }
  } catch {
    return null;
  }
  return null;
}

function youtubeHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "youtube.com" || host === "www.youtube.com";
}

function decodeXml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, digits: string) => {
      const code = Number(digits);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function cuesFromJson3(value: unknown): CaptionCue[] {
  const events = Array.isArray(value)
    ? value
    : value &&
        typeof value === "object" &&
        Array.isArray((value as { events?: unknown }).events)
      ? (value as { events: unknown[] }).events
      : null;
  if (!events) return [];
  const cues: CaptionCue[] = [];
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const record = event as {
      tStartMs?: unknown;
      dDurationMs?: unknown;
      segs?: unknown;
    };
    const startMs = Number(record.tStartMs);
    if (!Number.isFinite(startMs)) continue;
    const durationMs = Number(record.dDurationMs ?? 0);
    const segs = Array.isArray(record.segs) ? record.segs : [];
    const text = segs
      .map((seg) =>
        seg &&
        typeof seg === "object" &&
        typeof (seg as { utf8?: unknown }).utf8 === "string"
          ? (seg as { utf8: string }).utf8
          : "",
      )
      .join("");
    const cleaned = decodeXml(text);
    if (!cleaned) continue;
    const startSeconds = startMs / 1000;
    const endSeconds =
      startSeconds + (Number.isFinite(durationMs) ? durationMs / 1000 : 0);
    cues.push({
      startSeconds,
      endSeconds: Math.max(endSeconds, startSeconds),
      text: cleaned,
    });
  }
  return cues;
}

function cuesFromXml(xml: string): CaptionCue[] {
  const cues: CaptionCue[] = [];
  const textPattern = /<text\b([^>]*)>([\s\S]*?)<\/text>/giu;
  for (const match of xml.matchAll(textPattern)) {
    const attrs = match[1] ?? "";
    const start = Number(/start="([^"]+)"/iu.exec(attrs)?.[1]);
    const dur = Number(/dur="([^"]+)"/iu.exec(attrs)?.[1] ?? 0);
    const text = decodeXml(match[2] ?? "");
    if (!text || !Number.isFinite(start)) continue;
    cues.push({
      startSeconds: start,
      endSeconds: start + (Number.isFinite(dur) ? dur : 0),
      text,
    });
  }
  if (cues.length > 0) return cues;
  const paragraphPattern = /<p\b([^>]*)>([\s\S]*?)<\/p>/giu;
  for (const match of xml.matchAll(paragraphPattern)) {
    const attrs = match[1] ?? "";
    const startMs = Number(/\bt="([^"]+)"/iu.exec(attrs)?.[1]);
    const durMs = Number(/\bd="([^"]+)"/iu.exec(attrs)?.[1] ?? 0);
    const text = decodeXml(match[2] ?? "");
    if (!text || !Number.isFinite(startMs)) continue;
    const startSeconds = startMs / 1000;
    cues.push({
      startSeconds,
      endSeconds: startSeconds + (Number.isFinite(durMs) ? durMs / 1000 : 0),
      text,
    });
  }
  return cues;
}

export function parseCaptionPayload(body: string): CaptionCue[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return cuesFromJson3(JSON.parse(trimmed) as unknown);
    } catch {
      return [];
    }
  }
  if (trimmed.includes("<")) return cuesFromXml(trimmed);
  return [];
}

async function readLimitedText(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > captionByteLimit) return null;
  const text = await response.text();
  if (text.length > captionByteLimit) return null;
  return text;
}

type YoutubeRead = Readonly<{
  host: string;
  path: string;
  fetchStatus: FoundFetchStatus;
  httpStatus?: number;
  body: string | null;
}>;

export type YoutubeTranscriptFetch = Readonly<{
  cues: CaptionCue[] | null;
  host: string;
  fetchStatus: FoundFetchStatus;
  httpStatus?: number;
  attempts: readonly FoundFetchAttempt[];
}>;

function youtubeRead(
  host: string,
  fetchStatus: FoundFetchStatus,
  httpStatus?: number,
  body: string | null = null,
  path = "",
): YoutubeRead {
  return {
    host,
    path,
    fetchStatus,
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    body,
  };
}

function isYoutubeHost(hostname: string) {
  const host = hostname.toLowerCase();
  return (
    host === "youtu.be" ||
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtube-nocookie.com" ||
    host.endsWith(".youtube-nocookie.com")
  );
}

/** A publisher transcript page. A YouTube watch URL is not one. */
export function publisherTranscriptUrl(
  lead: Pick<FoundLead, "transcriptUrl" | "url">,
) {
  for (const value of [lead.transcriptUrl, lead.url]) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || isYoutubeHost(url.hostname)) continue;
      return url.toString();
    } catch {
      continue;
    }
  }
  return undefined;
}

/** Watch URLs from the model keep only the 11-character video id. */
export function normalizeYoutubeLead(lead: FoundLead): FoundLead {
  if (lead.kind !== "youtube") return lead;
  const id =
    (lead.videoId ? youtubeVideoId(lead.videoId) : null) ??
    (lead.url ? youtubeVideoId(lead.url) : null) ??
    (lead.transcriptUrl ? youtubeVideoId(lead.transcriptUrl) : null);
  const transcript = publisherTranscriptUrl(lead);
  return {
    ...lead,
    ...(id
      ? { videoId: id, url: `https://www.youtube.com/watch?v=${id}` }
      : {}),
    ...(transcript ? { transcriptUrl: transcript } : {}),
  };
}

function isBotWall(body: string) {
  const value = body.toLowerCase();
  return (
    value.includes("login_required") ||
    value.includes("confirm you're not a bot") ||
    value.includes("confirm you’re not a bot")
  );
}

function preferFailure(current: YoutubeRead | null, next: YoutubeRead) {
  if (!current) return next;
  if (current.fetchStatus === "http") return current;
  if (next.fetchStatus === "http" || next.fetchStatus === "blocked")
    return next;
  if (current.fetchStatus === "blocked") return current;
  return next;
}

async function fetchYoutubeText(
  url: string,
  signal: AbortSignal,
  init: RequestInit = {},
): Promise<YoutubeRead> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return youtubeRead("youtube.com", "blocked");
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;
  if (parsed.protocol !== "https:" || !youtubeHost(parsed.hostname)) {
    return youtubeRead(host, "blocked", undefined, null, path);
  }
  if (signal.aborted) return youtubeRead(host, "empty", undefined, null, path);
  let response: Response;
  try {
    response = await fetch(parsed, {
      ...init,
      redirect: "manual",
      signal,
      headers: {
        "user-agent": browserUserAgent,
        "accept-language": "en",
        ...(init.headers ?? {}),
      },
    });
  } catch {
    return youtubeRead(host, "empty", undefined, null, path);
  }
  if (response.status >= 300 && response.status < 400) {
    return youtubeRead(host, "http", response.status, null, path);
  }
  if (!response.ok)
    return youtubeRead(host, "http", response.status, null, path);
  const body = await readLimitedText(response);
  if (!body) return youtubeRead(host, "empty", response.status, null, path);
  if (isBotWall(body))
    return youtubeRead(host, "blocked", response.status, null, path);
  return youtubeRead(host, "ok", response.status, body, path);
}

function captionUrl(base: string, videoId: string) {
  const url = new URL(base, "https://www.youtube.com");
  if (!youtubeHost(url.hostname)) return null;
  if (!url.searchParams.get("v")) url.searchParams.set("v", videoId);
  if (!url.searchParams.get("fmt")) url.searchParams.set("fmt", "json3");
  return url;
}

function cuesFromRead(read: YoutubeRead) {
  return read.body ? parseCaptionPayload(read.body) : [];
}

function asAttempt(
  read: YoutubeRead,
  attempts: readonly FoundFetchAttempt[],
): YoutubeTranscriptFetch {
  return {
    cues: null,
    host: read.host,
    fetchStatus: read.fetchStatus,
    ...(read.httpStatus !== undefined ? { httpStatus: read.httpStatus } : {}),
    attempts,
  };
}

function attemptFrom(
  read: YoutubeRead,
  step: FoundFetchStep,
): FoundFetchAttempt {
  return {
    host: read.host,
    fetchStatus: read.fetchStatus,
    ...(read.httpStatus !== undefined ? { httpStatus: read.httpStatus } : {}),
    step,
    ...(read.path ? { path: read.path } : {}),
  };
}

export async function fetchYoutubeTranscript(
  videoId: string,
  signal: AbortSignal,
): Promise<YoutubeTranscriptFetch> {
  const attempts: FoundFetchAttempt[] = [];
  if (!videoIdPattern.test(videoId)) {
    return {
      cues: null,
      host: "www.youtube.com",
      fetchStatus: "empty",
      attempts,
    };
  }
  let failure: YoutubeRead | null = null;
  const note = (read: YoutubeRead, step: FoundFetchStep) => {
    attempts.push(attemptFrom(read, step));
    failure = preferFailure(failure, read);
  };
  const found = (
    cues: CaptionCue[],
    read: YoutubeRead,
    step: FoundFetchStep,
  ): YoutubeTranscriptFetch => {
    attempts.push(
      attemptFrom(
        youtubeRead(read.host, "ok", read.httpStatus, null, read.path),
        step,
      ),
    );
    return {
      cues,
      host: read.host,
      fetchStatus: "ok",
      ...(read.httpStatus !== undefined ? { httpStatus: read.httpStatus } : {}),
      attempts,
    };
  };
  const directUrls = [
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3`,
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en-US&fmt=json3`,
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&kind=asr&fmt=json3`,
  ];
  for (const url of directUrls) {
    const read = await fetchYoutubeText(url, signal);
    const cues = cuesFromRead(read);
    if (cues.length > 0) return found(cues, read, "timedtext");
    note(
      read.body
        ? youtubeRead(read.host, "empty", read.httpStatus, null, read.path)
        : read,
      "timedtext",
    );
  }
  const listed = await fetchYoutubeText(
    `https://www.youtube.com/api/timedtext?type=list&v=${videoId}`,
    signal,
  );
  if (listed.body) {
    const tracks = [...listed.body.matchAll(/<track\b([^>]*)\/?>/giu)];
    const preferred =
      tracks.find((track) =>
        /lang_code="en(?:-[A-Za-z]+)?"/iu.test(track[1] ?? ""),
      ) ?? tracks[0];
    if (preferred) {
      const attrs = preferred[1] ?? "";
      const lang = /lang_code="([^"]+)"/iu.exec(attrs)?.[1];
      const name = /name="([^"]*)"/iu.exec(attrs)?.[1] ?? "";
      const kind = /kind="([^"]+)"/iu.exec(attrs)?.[1];
      if (lang) {
        const url = new URL("https://www.youtube.com/api/timedtext");
        url.searchParams.set("v", videoId);
        url.searchParams.set("lang", lang);
        url.searchParams.set("fmt", "json3");
        if (name) url.searchParams.set("name", name);
        if (kind) url.searchParams.set("kind", kind);
        const read = await fetchYoutubeText(url.toString(), signal);
        const cues = cuesFromRead(read);
        if (cues.length > 0) return found(cues, read, "timedtext");
        note(
          read.body
            ? youtubeRead(read.host, "empty", read.httpStatus, null, read.path)
            : read,
          "timedtext",
        );
      } else {
        note(
          youtubeRead(
            listed.host,
            "empty",
            listed.httpStatus,
            null,
            listed.path,
          ),
          "timedtext",
        );
      }
    } else {
      note(
        youtubeRead(listed.host, "empty", listed.httpStatus, null, listed.path),
        "timedtext",
      );
    }
  } else {
    note(listed, "timedtext");
  }
  for (const clientName of ["WEB", "ANDROID"] as const) {
    const player = await captionsFromPlayer(videoId, clientName, signal);
    if (player.cues && player.cues.length > 0) {
      return found(player.cues, player, player.step);
    }
    note(player, player.step);
  }
  const watch = await captionsFromWatchPage(videoId, signal);
  if (watch.cues && watch.cues.length > 0) {
    return found(watch.cues, watch, watch.step);
  }
  note(watch, watch.step);
  return asAttempt(
    failure ??
      youtubeRead("www.youtube.com", "empty", undefined, null, "/watch"),
    attempts,
  );
}

async function captionsFromPlayer(
  videoId: string,
  clientName: "WEB" | "ANDROID",
  signal: AbortSignal,
): Promise<YoutubeRead & { cues: CaptionCue[] | null; step: FoundFetchStep }> {
  const read = await fetchYoutubeText(
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    signal,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName,
            clientVersion:
              clientName === "WEB" ? "2.20250901.00.00" : "19.35.36",
            hl: "en",
            gl: "US",
          },
        },
      }),
    },
  );
  if (!read.body) return { ...read, cues: null, step: "player" };
  try {
    const parsed = JSON.parse(read.body) as {
      captions?: {
        playerCaptionsTracklistRenderer?: {
          captionTracks?: Array<{ baseUrl?: string; languageCode?: string }>;
        };
      };
    };
    const tracks =
      parsed.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const track =
      tracks.find((item) =>
        item.languageCode?.toLowerCase().startsWith("en"),
      ) ?? tracks[0];
    if (!track?.baseUrl) {
      return {
        ...youtubeRead(read.host, "empty", read.httpStatus, null, read.path),
        cues: null,
        step: "player",
      };
    }
    const url = captionUrl(track.baseUrl, videoId);
    if (!url) {
      return {
        ...youtubeRead(read.host, "blocked", read.httpStatus, null, read.path),
        cues: null,
        step: "player",
      };
    }
    const captions = await fetchYoutubeText(url.toString(), signal);
    const cues = cuesFromRead(captions);
    if (cues.length > 0) return { ...captions, cues, step: "timedtext" };
    return {
      ...(captions.body
        ? youtubeRead(
            captions.host,
            "empty",
            captions.httpStatus,
            null,
            captions.path,
          )
        : captions),
      cues: null,
      step: "timedtext",
    };
  } catch {
    return {
      ...youtubeRead(read.host, "empty", read.httpStatus, null, read.path),
      cues: null,
      step: "player",
    };
  }
}

function extractJsonArray(source: string, marker: string) {
  const at = source.indexOf(marker);
  if (at < 0) return null;
  const start = source.indexOf("[", at);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "[") depth += 1;
    if (char === "]") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}

async function captionsFromWatchPage(
  videoId: string,
  signal: AbortSignal,
): Promise<YoutubeRead & { cues: CaptionCue[] | null; step: FoundFetchStep }> {
  const read = await fetchYoutubeText(
    `https://www.youtube.com/watch?v=${videoId}&hl=en`,
    signal,
  );
  if (!read.body) return { ...read, cues: null, step: "watch" };
  const raw = extractJsonArray(read.body, '"captionTracks":');
  if (!raw) {
    return {
      ...youtubeRead(read.host, "empty", read.httpStatus, null, read.path),
      cues: null,
      step: "watch",
    };
  }
  try {
    const tracks = JSON.parse(raw) as Array<{
      baseUrl?: string;
      languageCode?: string;
    }>;
    const track =
      tracks.find((item) =>
        item.languageCode?.toLowerCase().startsWith("en"),
      ) ?? tracks[0];
    if (!track?.baseUrl) {
      return {
        ...youtubeRead(read.host, "empty", read.httpStatus, null, read.path),
        cues: null,
        step: "watch",
      };
    }
    const url = captionUrl(track.baseUrl.replace(/\\u0026/g, "&"), videoId);
    if (!url) {
      return {
        ...youtubeRead(read.host, "blocked", read.httpStatus, null, read.path),
        cues: null,
        step: "watch",
      };
    }
    const captions = await fetchYoutubeText(url.toString(), signal);
    const cues = cuesFromRead(captions);
    if (cues.length > 0) return { ...captions, cues, step: "timedtext" };
    return {
      ...(captions.body
        ? youtubeRead(
            captions.host,
            "empty",
            captions.httpStatus,
            null,
            captions.path,
          )
        : captions),
      cues: null,
      step: "timedtext",
    };
  } catch {
    return {
      ...youtubeRead(read.host, "empty", read.httpStatus, null, read.path),
      cues: null,
      step: "watch",
    };
  }
}
