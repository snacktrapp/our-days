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
} from "@/features/insights/found-types";
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
      parsed.searchParams.set("t", String(Math.floor(startSeconds)));
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

function retryPrompt(query: string, lead: FoundLead) {
  let place: string = lead.kind;
  const raw = lead.url || lead.transcriptUrl;
  if (raw) {
    try {
      const url = new URL(raw);
      place = `${url.hostname}${url.pathname}`;
    } catch {
      place = lead.kind;
    }
  }
  return `${query}\n\nThat source could not be opened (${place}). Return a different lead. If a public transcript page exists, set transcriptUrl to that https page.`;
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

async function executeFoundSearch(
  query: string,
  deps: FoundSearchDeps,
  signal: AbortSignal,
): Promise<FoundSearchOutcome> {
  const leadLogs: FoundLeadLog[] = [];
  let cards = 0;
  try {
    const candidates: FoundCandidate[] = [];
    const seen = new Set<string>();
    const tried = new Set<string>();
    let pending = (await deps.generateLeads(query, signal)).slice(0, 5);
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
          candidates.push(candidateFromMatch(source, direct.located, 0));
          cards = candidates.length;
          seen.add(source.identity);
          leadLogs.push(leadLog(item.lead, item.result.attempts, source));
          if (candidates.length >= 3) break;
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
        for (const passage of passages) {
          if (candidates.length >= 3) break;
          candidates.push(
            candidateFromMatch(
              source,
              { quote: passage.quote, start: passage.start, end: passage.end },
              passage.offset,
            ),
          );
        }
        cards = candidates.length;
        if (passages.length > 0) seen.add(source.identity);
        leadLogs.push(
          leadLog(
            item.lead,
            item.result.attempts,
            source,
            passages.length === 0
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
      const onlyLeadFailed =
        round === 1 &&
        candidates.length === 0 &&
        fetched.length === 1 &&
        !opened;
      if (!onlyLeadFailed) break;
      pending = (
        await deps.generateLeads(retryPrompt(query, fetched[0]!.lead), signal)
      ).slice(0, 5);
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
        executeFoundSearch(query, deps, controller.signal),
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
