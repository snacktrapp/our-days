import "server-only";

import { insightSourceLabel } from "@/features/insights/insight-source";
import {
  formatFoundRange,
  foundEmptyMessage,
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
import type { FetchedSource, FoundLead } from "./leads.server";
import { pickFoundSpan, proposeFoundLeads } from "./model.server";
import { timestampsForSlice, type TimedWord } from "./vtt.server";
import { verifySpan, type SpanPick } from "./verify.server";

const windowChars = 12_000;

export type FoundSearchDeps = Readonly<{
  generateLeads: (
    query: string,
    signal: AbortSignal,
  ) => Promise<readonly FoundLead[]>;
  pickSpan: (
    input: Readonly<{ query: string; window: string; signal: AbortSignal }>,
  ) => Promise<SpanPick | null>;
  fetchSource: (
    lead: FoundLead,
    signal: AbortSignal,
  ) => Promise<FetchedSource | null>;
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

async function executeFoundSearch(
  query: string,
  deps: FoundSearchDeps,
  signal: AbortSignal,
): Promise<FoundSearchOutcome> {
  const leads = (await deps.generateLeads(query, signal)).slice(0, 5);
  if (signal.aborted)
    throw new DOMException("The operation was aborted.", "AbortError");
  const fetched = await Promise.all(
    leads.map(async (lead) => ({
      lead,
      source: await deps.fetchSource(lead, signal),
    })),
  );
  const candidates: FoundCandidate[] = [];
  const seen = new Set<string>();
  for (const item of fetched) {
    if (signal.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    const source = item.source;
    if (!source || seen.has(source.identity)) continue;
    const windows = textWindows(
      source.text,
      hintOffset(source, item.lead.hintSeconds),
    );
    for (const window of windows) {
      const pick = await deps.pickSpan({
        query,
        window: window.text,
        signal,
      });
      const located = verifySpan(window.text, pick);
      if (!located) continue;
      const absoluteStart = window.offset + located.start;
      const absoluteEnd = window.offset + located.end;
      const timing = timestampsForSlice(
        source.timedWords,
        absoluteStart,
        absoluteEnd,
      );
      const sourceUrl = withStartTime(source.sourceUrl, timing?.startSeconds);
      const label = insightSourceLabel(sourceUrl);
      const attribution =
        source.kind === "bible"
          ? (bibleAttribution(source, absoluteStart, absoluteEnd) ??
            speakerAttribution(source.speaker, source.title))
          : speakerAttribution(source.speaker, source.title);
      const candidate: FoundCandidate = {
        quote: located.quote,
        attribution,
        sourceUrl,
        sourceLabel: label === "Listen" ? "Listen" : "Read the source",
        verifiedLabel:
          source.kind === "bible"
            ? foundVerifiedBible
            : source.kind === "youtube"
              ? foundVerifiedTranscript
              : foundVerifiedSource,
        ...(timing
          ? {
              rangeLabel: formatFoundRange(
                timing.startSeconds,
                timing.endSeconds,
              ),
            }
          : {}),
        ...(source.videoId ? { videoId: source.videoId } : {}),
      };
      candidates.push(candidate);
      seen.add(source.identity);
      break;
    }
    if (candidates.length >= 3) break;
  }
  if (candidates.length === 0) {
    return { ok: false, reason: "empty", message: foundEmptyMessage };
  }
  return { ok: true, candidates };
}

export async function runFoundSearch(
  query: string,
  deps: FoundSearchDeps,
  timeoutMs = foundSearchTimeoutMs,
): Promise<FoundSearchOutcome> {
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
    rejectAbort?.(new DOMException("The operation was aborted.", "AbortError"));
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
  }
}

export function connectedFoundDeps(): FoundSearchDeps {
  return {
    generateLeads: proposeFoundLeads,
    pickSpan: pickFoundSpan,
    fetchSource: fetchFoundSource,
  };
}

export { foundSearchTimeoutMs };
