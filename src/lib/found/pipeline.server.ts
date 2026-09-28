import "server-only";

import { insightSourceLabel } from "@/features/insights/insight-source";
import {
  formatFoundRange,
  foundEmptyMessage,
  foundMaximumQuoteLength,
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

function clipAttribution(value: string) {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "Source";
  if (trimmed.length <= 160) return trimmed;
  return `${trimmed.slice(0, 157).trimEnd()}…`;
}

function speakerAttribution(speaker?: string, title?: string) {
  const left = speaker?.trim();
  const right = title?.trim();
  if (left && right) return clipAttribution(`${left} · ${right}`);
  return clipAttribution(left || right || "Source");
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
  const fetchStatus = source ? "ok" : (last?.fetchStatus ?? "empty");
  const httpStatus =
    fetchStatus === "http"
      ? (last?.httpStatus ?? okAttempt?.httpStatus)
      : undefined;
  return {
    sourceType: lead.kind,
    ...(hostOf(source?.sourceUrl) || okAttempt?.host || last?.host
      ? { host: hostOf(source?.sourceUrl) ?? okAttempt?.host ?? last?.host }
      : {}),
    fetchStatus,
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...(dropReason ? { dropReason } : {}),
    ...(near ? { similarity: near.similarity } : {}),
    ...(near?.modelQuotePreview
      ? { modelQuotePreview: near.modelQuotePreview }
      : {}),
    attempts,
  };
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
  const attribution =
    source.kind === "bible"
      ? (bibleAttribution(source, absoluteStart, absoluteEnd) ??
        speakerAttribution(source.speaker, source.title))
      : speakerAttribution(source.speaker, source.title);
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
    ...(timing
      ? {
          rangeLabel: formatFoundRange(timing.startSeconds, timing.endSeconds),
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
    const leads = (await deps.generateLeads(query, signal)).slice(0, 5);
    if (signal.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    const fetched = await Promise.all(
      leads.map(async (lead) => ({
        lead,
        result: await deps.fetchSource(lead, signal),
      })),
    );
    const candidates: FoundCandidate[] = [];
    const seen = new Set<string>();
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
      if (seen.has(source.identity)) {
        leadLogs.push(
          leadLog(item.lead, item.result.attempts, source, "duplicate"),
        );
        continue;
      }
      const direct =
        source.kind === "bible" && source.text.length <= foundMaximumQuoteLength
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
      let matched = false;
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
          candidates.push(
            candidateFromMatch(source, assessed.located, window.offset),
          );
          cards = candidates.length;
          seen.add(source.identity);
          matched = true;
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
        candidates.push(
          candidateFromMatch(source, recovered.located, window.offset),
        );
        cards = candidates.length;
        seen.add(source.identity);
        matched = true;
        dropReason = "near-match-recovered";
        break;
      }
      leadLogs.push(
        leadLog(
          item.lead,
          item.result.attempts,
          source,
          matched && dropReason !== "near-match-recovered"
            ? undefined
            : dropReason,
          similarity === undefined
            ? undefined
            : { similarity, modelQuotePreview },
        ),
      );
      if (candidates.length >= 3) break;
    }
    cards = candidates.length;
    if (candidates.length === 0) {
      return { ok: false, reason: "empty", message: foundEmptyMessage };
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
