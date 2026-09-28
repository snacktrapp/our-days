import "server-only";

import {
  foundMaximumQuoteLength,
  foundMinimumWords,
} from "@/features/insights/found-types";
import {
  canonicalFoundText,
  foundWordSpans,
  type FoundWordSpan,
} from "./normalize.server";

function displayFoundText(value: string) {
  return value.normalize("NFKC");
}

export type LocatedQuote = Readonly<{
  quote: string;
  start: number;
  end: number;
}>;

export type SpanPick = Readonly<{
  quote?: string;
  hintSeconds?: number;
}>;

export type FoundQuoteAssessment =
  | Readonly<{ ok: true; located: LocatedQuote }>
  | Readonly<{ ok: false; reason: "no-match" | "too-long" }>;

function quoteFromSpans(
  text: string,
  spans: readonly FoundWordSpan[],
  from: number,
  through: number,
): LocatedQuote | null {
  if (through < from) return null;
  if (through - from + 1 < foundMinimumWords) return null;
  const start = spans[from]?.start;
  const end = spans[through]?.end;
  if (start === undefined || end === undefined) return null;
  const quote = text.slice(start, end);
  if (!quote.trim() || quote.length > foundMaximumQuoteLength) return null;
  return { quote, start, end };
}

/** Contiguous word-for-word match. A miss or a slice over 4000 characters drops. */
export function assessFoundQuote(
  source: string,
  quote: string,
): FoundQuoteAssessment {
  if (quote.length > foundMaximumQuoteLength) {
    return { ok: false, reason: "too-long" };
  }
  const text = canonicalFoundText(source);
  const sliceText =
    displayFoundText(source).length === text.length
      ? displayFoundText(source)
      : text;
  const sourceSpans = foundWordSpans(text);
  const quoteSpans = foundWordSpans(quote);
  if (quoteSpans.length < foundMinimumWords) {
    return { ok: false, reason: "no-match" };
  }
  const limit = sourceSpans.length - quoteSpans.length;
  let sawTooLong = false;
  for (let index = 0; index <= limit; index += 1) {
    let matches = true;
    for (let offset = 0; offset < quoteSpans.length; offset += 1) {
      if (sourceSpans[index + offset]?.word !== quoteSpans[offset]?.word) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    const from = index;
    const through = index + quoteSpans.length - 1;
    const located = quoteFromSpans(sliceText, sourceSpans, from, through);
    if (located) return { ok: true, located };
    const start = sourceSpans[from]?.start;
    const end = sourceSpans[through]?.end;
    if (
      start !== undefined &&
      end !== undefined &&
      end - start > foundMaximumQuoteLength
    ) {
      sawTooLong = true;
    }
  }
  return { ok: false, reason: sawTooLong ? "too-long" : "no-match" };
}

/** Contiguous word-for-word match. The returned quote is a source slice. */
export function locateContiguousQuote(
  source: string,
  quote: string,
): LocatedQuote | null {
  const assessed = assessFoundQuote(source, quote);
  return assessed.ok ? assessed.located : null;
}

/** Indexes pick a source slice. They never contribute outside wording. */
export function sliceFromIndexes(
  source: string,
  start: number,
  end: number,
): LocatedQuote | null {
  const text = canonicalFoundText(source);
  const sliceText =
    displayFoundText(source).length === text.length
      ? displayFoundText(source)
      : text;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || end > text.length || end <= start) return null;
  const spans = foundWordSpans(text);
  const covered = spans.filter((span) => span.end > start && span.start < end);
  if (covered.length < foundMinimumWords) return null;
  const first = spans.indexOf(covered[0]!);
  const last = spans.indexOf(covered[covered.length - 1]!);
  return quoteFromSpans(sliceText, spans, first, last);
}

/**
 * A supplied quote must sit in the source. A miss drops the card.
 * Offsets are never a fallback.
 */
export function verifySpan(
  source: string,
  pick: SpanPick | null | undefined,
): LocatedQuote | null {
  if (!pick?.quote) return null;
  return locateContiguousQuote(source, pick.quote);
}
