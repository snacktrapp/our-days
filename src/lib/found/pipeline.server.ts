import "server-only";

import { insightSourceLabel } from "@/features/insights/insight-source";
import {
  formatFoundClock,
  formatFoundRange,
  foundEmptyMessage,
  foundMaximumQuoteLength,
  foundSourceMessage,
  foundRestingMessage,
  foundSearchTimeoutMs,
  foundTimeoutMessage,
  foundUnavailableMessage,
  foundVerifiedBible,
  foundVerifiedSource,
  foundVerifiedTranscript,
  type FoundCandidate,
  type FoundSourceKind,
} from "@/features/insights/found-types";
import { youtubePlaybackFromSource } from "@/features/insights/youtube-source";
import { FoundBudgetError, FoundUnavailableError } from "./errors.server";
import { fetchFoundSource } from "./fetchers.server";
import {
  beginFoundRequest,
  finishFoundRequestLog,
  noteFoundLeads,
  type FoundLeadLog,
} from "./found-log.server";
import type {
  FetchedSource,
  FoundFetchAttempt,
  FoundFetchResult,
  FoundLead,
} from "./leads.server";
import { pickFoundQuote, proposeFoundLeads } from "./model.server";
import { normalizeYoutubeLead } from "./youtube.server";
import { foundWords } from "./normalize.server";
import {
  foundTopicWords,
  selectFoundPassages,
  type RankedPassage,
} from "./relevance.server";
import { timestampsForSlice, type TimedWord } from "./vtt.server";
import {
  assessFoundQuote,
  recoverNearQuote,
  type SpanPick,
} from "./verify.server";

const windowChars = 12_000;

export type FoundSearchDeps = Readonly<{
  generateLeads: (
    query: string,
    signal: AbortSignal,
  ) => Promise<readonly FoundLead[]>;
  pickQuote: (
    input: Readonly<{ query: string; window: string; signal: AbortSignal }>,
  ) => Promise<SpanPick | null>;
  fetchSource: (
    lead: FoundLead,
    signal: AbortSignal,
  ) => Promise<FoundFetchResult>;
}>;

export type FoundSearchOutcome =
  | Readonly<{ ok: true; candidates: readonly FoundCandidate[] }>
  | Readonly<{
      ok: false;
      reason: "empty" | "timeout" | "resting" | "unavailable";
      message: string;
    }>;

type TextWindow = Readonly<{ text: string; offset: number }>;

function clipAttribution(value: string | undefined) {
  const trimmed = value?.trim().replace(/\s+/g, " ") ?? "";
  if (!trimmed || trimmed.toLowerCase() === "source") return null;
  if (trimmed.length <= 160) return trimmed;
  return `${trimmed.slice(0, 157).trimEnd()}…`;
}

function namedParts(parts: Array<string | undefined>) {
  const cleaned = parts
    .map((part) => part?.trim().replace(/\s+/g, " "))
    .filter((part): part is string => {
      if (!part) return false;
      return part.toLowerCase() !== "source";
    });
  return clipAttribution(cleaned.join(" · "));
}

function bibleAttribution(source: FetchedSource, start: number, end: number) {
  const covered = (source.verseSpans ?? []).filter(
    (span) => span.end > start && span.start < end,
  );
  const first = covered[0];
  const last = covered[covered.length - 1];
  if (!first || !last) return null;
  const reference =
    first.chapter === last.chapter
      ? first.verse === last.verse
        ? `${first.book} ${first.chapter}:${first.verse}`
        : `${first.book} ${first.chapter}:${first.verse}–${last.verse}`
      : `${first.book} ${first.chapter}:${first.verse}–${last.chapter}:${last.verse}`;
  return clipAttribution(`${reference} · World English Bible`);
}

function displayHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "") || undefined;
  } catch {
    return undefined;
  }
}

function realName(value: string | undefined) {
  const trimmed = value?.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.toLowerCase() === "source") return undefined;
  return trimmed;
}

function speakerIsInSource(speaker: string, source: FetchedSource) {
  const words = foundWords(speaker).filter((word) => word.length >= 2);
  if (words.length === 0) return false;
  const haystack = new Set(
    foundWords(`${source.text}\n${source.fetchedTitle ?? ""}`),
  );
  return words.every((word) => haystack.has(word));
}

function presentationSite(source: FetchedSource): {
  site?: string;
  channel?: string;
} {
  if (source.kind === "bible") return { site: "ebible.org" };
  if (source.kind === "youtube" || source.videoId) {
    const channel = realName(source.channelName);
    return {
      site: "YouTube",
      ...(channel ? { channel } : {}),
    };
  }
  const site = displayHost(source.sourceUrl);
  return site ? { site } : {};
}

function hintOffset(source: FetchedSource, hintSeconds?: number) {
  const words = source.timedWords;
  if (!words?.length || hintSeconds === undefined) return 0;
  let best: TimedWord = words[0]!;
  let bestDistance = Math.abs(best.cueStart - hintSeconds);
  for (const word of words) {
    const distance = Math.abs(word.cueStart - hintSeconds);
    if (distance < bestDistance) {
      best = word;
      bestDistance = distance;
    }
  }
  return best.start;
}

function textWindows(text: string, hint: number): TextWindow[] {
  if (text.length <= windowChars) return [{ text, offset: 0 }];
  const start = Math.max(
    0,
    Math.min(text.length - windowChars, hint - Math.floor(windowChars / 2)),
  );
  const windows: TextWindow[] = [
    { text: text.slice(start, start + windowChars), offset: start },
  ];
  if (start > 0) windows.push({ text: text.slice(0, windowChars), offset: 0 });
  return windows.slice(0, 2);
}

function hostOf(url: string | undefined) {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function isListenUrl(url: string) {
  return insightSourceLabel(url) === "Listen";
}

function cardSourceUrl(source: FetchedSource, startSeconds?: number) {
  if (startSeconds === undefined) return source.sourceUrl;
  if (source.videoId) {
    return withStartTime(
      `https://www.youtube.com/watch?v=${source.videoId}`,
      startSeconds,
    );
  }
  if (isListenUrl(source.sourceUrl)) {
    return withStartTime(source.sourceUrl, startSeconds);
  }
  return source.sourceUrl;
}

function withStartTime(url: string, startSeconds?: number) {
  if (startSeconds === undefined) return url;
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has("t")) {
      parsed.searchParams.set("t", `${Math.floor(startSeconds)}s`);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function isAbort(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function leadLog(
  lead: FoundLead,
  attempts: readonly FoundFetchAttempt[],
  source: FetchedSource | null,
  dropReason?: string,
  near?: Readonly<{ similarity: number; modelQuotePreview?: string }>,
): FoundLeadLog {
  const okAttempt = attempts.find((item) => item.fetchStatus === "ok");
  const last = attempts[attempts.length - 1];
  const httpAttempt = [...attempts]
    .reverse()
    .find((item) => item.fetchStatus === "http");
  const reported = source ? (okAttempt ?? last) : (httpAttempt ?? last);
  const fetchStatus = source ? "ok" : (reported?.fetchStatus ?? "empty");
  const httpStatus = fetchStatus === "http" ? reported?.httpStatus : undefined;
  return {
    sourceType: lead.kind,
    ...(hostOf(source?.sourceUrl) || reported?.host
      ? { host: hostOf(source?.sourceUrl) ?? reported?.host }
      : {}),
    fetchStatus,
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...(reported?.step ? { step: reported.step } : {}),
    ...(reported?.path ? { path: reported.path } : {}),
    ...(dropReason ? { dropReason } : {}),
    ...(near ? { similarity: near.similarity } : {}),
    ...(near?.modelQuotePreview
      ? { modelQuotePreview: near.modelQuotePreview }
      : {}),
    attempts,
  };
}

function leadIdentity(lead: FoundLead) {
  const normalized =
    lead.kind === "youtube" ? normalizeYoutubeLead(lead) : lead;
  return [
    normalized.kind,
    normalized.videoId ?? "",
    normalized.url ?? "",
    normalized.transcriptUrl ?? "",
    normalized.book ?? "",
    normalized.chapter ?? "",
    normalized.startVerse ?? "",
    normalized.endVerse ?? "",
  ].join("|");
}

function leadPlace(lead: FoundLead) {
  const raw = lead.url || lead.transcriptUrl;
  if (raw) {
    try {
      const url = new URL(raw);
      return `${url.hostname}${url.pathname}`;
    } catch {
      return lead.kind;
    }
  }
  return lead.kind;
}

function longestTopicWord(query: string) {
  const words = foundTopicWords(query);
  const longest = words.reduce<string>(
    (best, word) => (word.length > best.length ? word : best),
    "",
  );
  return longest.length >= 6 ? longest : undefined;
}

function missedTopic(query: string, candidates: readonly FoundCandidate[]) {
  const word = longestTopicWord(query);
  if (!word || candidates.length === 0) return undefined;
  const blob = candidates
    .map((candidate) => candidate.quote)
    .join(" ")
    .toLowerCase();
  return blob.includes(word) ? undefined : word;
}

function retryPrompt(query: string, lead: FoundLead, missing?: string) {
  const place = leadPlace(lead);
  if (missing) {
    return `${query}\n\nThe page at ${place} did not contain "${missing}". Do not return that page. Search for a different episode. Return the public transcript page on the show's own site that includes "${missing}", in url or transcriptUrl.`;
  }
  const topic = longestTopicWord(query);
  const about = topic ? ` The passage has to include "${topic}".` : "";
  return `${query}\n\nThat source could not be opened (${place}). Do not return that same page. Return a different lead: a public transcript page on the show's own site, in url or transcriptUrl.${about}`;
}

function noCardMessage(logs: readonly FoundLeadLog[]) {
  if (
    logs.length > 0 &&
    logs.every((lead) => lead.dropReason === "fetch-failed")
  ) {
    return foundSourceMessage;
  }
  return foundEmptyMessage;
}

function candidateFromMatch(
  source: FetchedSource,
  located: { quote: string; start: number; end: number },
  offset: number,
): FoundCandidate {
  const absoluteStart = offset + located.start;
  const absoluteEnd = offset + located.end;
  const timing = timestampsForSlice(
    source.timedWords,
    absoluteStart,
    absoluteEnd,
  );
  const sourceUrl = cardSourceUrl(source, timing?.startSeconds);
  const label = insightSourceLabel(sourceUrl);
  const speaker = realName(source.speaker);
  const fetchedTitle = realName(source.fetchedTitle);
  const modelTitle = realName(source.title);
  const site = presentationSite(source);
  const attribution =
    (source.kind === "bible"
      ? bibleAttribution(source, absoluteStart, absoluteEnd)
      : null) ??
    namedParts([speaker, fetchedTitle ?? modelTitle]) ??
    namedParts([site.site]) ??
    displayHost(source.sourceUrl) ??
    (source.kind === "bible"
      ? "World English Bible"
      : source.kind === "youtube"
        ? "YouTube"
        : "Page");
  return {
    quote: located.quote,
    attribution,
    sourceUrl,
    sourceLabel: label === "Listen" ? "Listen" : "Read the source",
    verifiedLabel:
      source.kind === "bible"
        ? foundVerifiedBible
        : source.kind === "youtube" || source.timedWords
          ? foundVerifiedTranscript
          : foundVerifiedSource,
    ...(speaker
      ? { speaker, speakerInSource: speakerIsInSource(speaker, source) }
      : {}),
    ...(fetchedTitle ? { sourceTitle: fetchedTitle } : {}),
    ...(site.site ? { sourceSite: site.site } : {}),
    ...(site.channel ? { channelName: site.channel } : {}),
    ...(timing
      ? {
          rangeLabel: formatFoundRange(timing.startSeconds, timing.endSeconds),
          atLabel: `at ${formatFoundClock(timing.startSeconds)}`,
        }
      : {}),
    ...(source.videoId ? { videoId: source.videoId } : {}),
  };
}

function leadMatchesSourceKind(lead: FoundLead, sourceKind: FoundSourceKind) {
  if (sourceKind === "youtube") return lead.kind === "youtube";
  if (sourceKind === "bible") return lead.kind === "bible";
  return lead.kind !== "youtube";
}

function candidateMatchesSourceKind(
  candidate: FoundCandidate,
  sourceKind: FoundSourceKind,
) {
  const video = youtubePlaybackFromSource(candidate.sourceUrl) !== null;
  if (sourceKind === "youtube") return video;
  if (sourceKind === "bible") {
    return !video && candidate.verifiedLabel === foundVerifiedBible;
  }
  return !video;
}

function scopedFoundQuery(query: string, sourceKind?: FoundSourceKind) {
  if (!sourceKind) return query;
  const rule =
    sourceKind === "youtube"
      ? "Return only youtube leads with a videoId. Do not return web or bible leads."
      : sourceKind === "bible"
        ? "Return only a World English Bible lead. Do not return youtube or web leads."
        : "Return only web or bible leads. Do not return YouTube.";
  return `${query}\n\n${rule}`;
}

async function executeFoundSearch(
  query: string,
  deps: FoundSearchDeps,
  signal: AbortSignal,
  sourceKind?: FoundSourceKind,
): Promise<FoundSearchOutcome> {
  const leadLogs: FoundLeadLog[] = [];
  let cards = 0;
  try {
    const candidates: FoundCandidate[] = [];
    const seen = new Set<string>();
    const tried = new Set<string>();
    const ask = (prompt: string) =>
      deps.generateLeads(scopedFoundQuery(prompt, sourceKind), signal);
    const takeLeads = async (prompt: string) => {
      const raw = (await ask(prompt)).slice(0, 5);
      if (!sourceKind) return raw;
      const allowed = raw.filter((lead) =>
        leadMatchesSourceKind(lead, sourceKind),
      );
      if (allowed.length > 0 || raw.length === 0) return allowed;
      const again = (
        await ask(`${prompt}\n\nThose leads were the wrong kind of source.`)
      ).slice(0, 5);
      return again.filter((lead) => leadMatchesSourceKind(lead, sourceKind));
    };
    const keepCandidate = (candidate: FoundCandidate) => {
      if (sourceKind && !candidateMatchesSourceKind(candidate, sourceKind)) {
        return false;
      }
      candidates.push(candidate);
      return true;
    };
    let pending = await takeLeads(query);
    let round = 0;
    while (pending.length > 0 && candidates.length < 3) {
      if (signal.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      const fresh: FoundLead[] = [];
      for (const lead of pending) {
        const normalized =
          lead.kind === "youtube" ? normalizeYoutubeLead(lead) : lead;
        const key = leadIdentity(normalized);
        if (tried.has(key)) continue;
        tried.add(key);
        if (sourceKind && !leadMatchesSourceKind(normalized, sourceKind)) {
          leadLogs.push(leadLog(normalized, [], null, "source-kind"));
          continue;
        }
        fresh.push(normalized);
      }
      if (fresh.length === 0) break;
      const fetched = await Promise.all(
        fresh.map(async (lead) => ({
          lead,
          result: await deps.fetchSource(lead, signal),
        })),
      );
      let opened = false;
      let openedLead: FoundLead | null = null;
      let pageMissedTopic = false;
      for (const item of fetched) {
        if (signal.aborted) {
          throw new DOMException("The operation was aborted.", "AbortError");
        }
        const source = item.result.source;
        if (!source) {
          leadLogs.push(
            leadLog(item.lead, item.result.attempts, null, "fetch-failed"),
          );
          continue;
        }
        opened = true;
        openedLead = item.lead;
        if (seen.has(source.identity)) {
          leadLogs.push(
            leadLog(item.lead, item.result.attempts, source, "duplicate"),
          );
          continue;
        }
        const direct =
          source.kind === "bible" &&
          source.text.length <= foundMaximumQuoteLength
            ? assessFoundQuote(source.text, source.text)
            : null;
        if (direct) {
          if (!direct.ok) {
            leadLogs.push(
              leadLog(item.lead, item.result.attempts, source, direct.reason),
            );
            continue;
          }
          if (!keepCandidate(candidateFromMatch(source, direct.located, 0))) {
            leadLogs.push(
              leadLog(item.lead, item.result.attempts, source, "source-kind"),
            );
            continue;
          }
          cards = candidates.length;
          seen.add(source.identity);
          leadLogs.push(leadLog(item.lead, item.result.attempts, source));
          if (candidates.length >= 3) break;
          continue;
        }
        const topicWord = longestTopicWord(query);
        if (topicWord && !source.text.toLowerCase().includes(topicWord)) {
          pageMissedTopic = true;
          seen.add(source.identity);
          leadLogs.push(
            leadLog(item.lead, item.result.attempts, source, "topic-miss"),
          );
          continue;
        }
        const windows = textWindows(
          source.text,
          hintOffset(source, item.lead.hintSeconds),
        );
        let dropReason = "no-match";
        let similarity: number | undefined;
        let modelQuotePreview: string | undefined;
        let modelPassage: RankedPassage | null = null;
        for (const window of windows) {
          let pick: SpanPick | null = null;
          try {
            pick = await deps.pickQuote({
              query,
              window: window.text,
              signal,
            });
          } catch (error) {
            leadLogs.push(
              leadLog(item.lead, item.result.attempts, source, "model-error"),
            );
            cards = candidates.length;
            throw error;
          }
          if (!pick?.quote) continue;
          const assessed = assessFoundQuote(window.text, pick.quote);
          if (assessed.ok) {
            modelPassage = {
              quote: assessed.located.quote,
              start: assessed.located.start,
              end: assessed.located.end,
              offset: window.offset,
            };
            similarity = undefined;
            modelQuotePreview = undefined;
            break;
          }
          if (assessed.reason === "too-long") {
            dropReason = "too-long";
            continue;
          }
          const recovered = recoverNearQuote(window.text, pick.quote);
          similarity = recovered.similarity;
          modelQuotePreview = pick.quote.slice(0, 120);
          if (!recovered.ok || !recovered.located) {
            dropReason = "no-match";
            continue;
          }
          modelPassage = {
            quote: recovered.located.quote,
            start: recovered.located.start,
            end: recovered.located.end,
            offset: window.offset,
          };
          dropReason = "near-match-recovered";
          break;
        }
        const passages = selectFoundPassages(
          source.text,
          foundTopicWords(query),
          modelPassage,
        );
        let kept = 0;
        for (const passage of passages) {
          if (candidates.length >= 3) break;
          const accepted = keepCandidate(
            candidateFromMatch(
              source,
              { quote: passage.quote, start: passage.start, end: passage.end },
              passage.offset,
            ),
          );
          if (accepted) kept += 1;
        }
        if (passages.length > 0 && kept === 0) dropReason = "source-kind";
        cards = candidates.length;
        if (kept > 0) seen.add(source.identity);
        leadLogs.push(
          leadLog(
            item.lead,
            item.result.attempts,
            source,
            passages.length === 0 || kept === 0
              ? dropReason
              : dropReason === "near-match-recovered"
                ? dropReason
                : undefined,
            dropReason === "near-match-recovered" && similarity !== undefined
              ? { similarity, modelQuotePreview }
              : undefined,
          ),
        );
        if (candidates.length >= 3) break;
      }
      round += 1;
      const missing =
        sourceKind === "bible"
          ? undefined
          : (missedTopic(query, candidates) ??
            (pageMissedTopic && candidates.length === 0
              ? longestTopicWord(query)
              : undefined));
      if (missing) {
        candidates.length = 0;
        cards = 0;
        for (let index = leadLogs.length - 1; index >= 0; index -= 1) {
          const entry = leadLogs[index];
          if (!entry || entry.dropReason) continue;
          leadLogs[index] = { ...entry, dropReason: "topic-miss" };
          break;
        }
      }
      const promptLead = openedLead ?? fetched[0]?.lead;
      const onlyLeadFailed =
        round === 1 &&
        candidates.length === 0 &&
        fetched.length === 1 &&
        !opened;
      const topicRetry = Boolean(missing) && round < 3;
      if (!promptLead || (!onlyLeadFailed && !topicRetry)) break;
      pending = (await ask(retryPrompt(query, promptLead, missing))).slice(
        0,
        5,
      );
    }
    cards = candidates.length;
    if (candidates.length === 0) {
      return { ok: false, reason: "empty", message: noCardMessage(leadLogs) };
    }
    return { ok: true, candidates };
  } finally {
    noteFoundLeads(leadLogs, cards);
  }
}

export async function runFoundSearch(
  query: string,
  deps: FoundSearchDeps,
  timeoutMs = foundSearchTimeoutMs,
  sourceKind?: FoundSourceKind,
): Promise<FoundSearchOutcome> {
  return beginFoundRequest(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let rejectAbort: ((error: DOMException) => void) | null = null;
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = reject;
      if (controller.signal.aborted) {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      }
    });
    void aborted.catch(() => undefined);
    const onAbort = () => {
      rejectAbort?.(
        new DOMException("The operation was aborted.", "AbortError"),
      );
    };
    controller.signal.addEventListener("abort", onAbort, { once: true });
    try {
      return await Promise.race([
        executeFoundSearch(query, deps, controller.signal, sourceKind),
        aborted,
      ]);
    } catch (error) {
      if (error instanceof FoundBudgetError) {
        return { ok: false, reason: "resting", message: foundRestingMessage };
      }
      if (error instanceof FoundUnavailableError) {
        return {
          ok: false,
          reason: "unavailable",
          message: foundUnavailableMessage,
        };
      }
      if (controller.signal.aborted || isAbort(error)) {
        return { ok: false, reason: "timeout", message: foundTimeoutMessage };
      }
      return { ok: false, reason: "empty", message: foundEmptyMessage };
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", onAbort);
      finishFoundRequestLog();
    }
  });
}

export function connectedFoundDeps(): FoundSearchDeps {
  return {
    generateLeads: proposeFoundLeads,
    pickQuote: pickFoundQuote,
    fetchSource: fetchFoundSource,
  };
}

export { foundSearchTimeoutMs };
