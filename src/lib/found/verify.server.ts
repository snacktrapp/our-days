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
  start: number;
  end: number;
  quote?: string;
}>;

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

/** Contiguous word-for-word match. The returned quote is a source slice. */
export function locateContiguousQuote(
  source: string,
  quote: string,
): LocatedQuote | null {
  const text = canonicalFoundText(source);
  const sliceText =
    displayFoundText(source).length === text.length
      ? displayFoundText(source)
      : text;
  const sourceSpans = foundWordSpans(text);
  const quoteSpans = foundWordSpans(quote);
  if (quoteSpans.length < foundMinimumWords) return null;
  const limit = sourceSpans.length - quoteSpans.length;
  for (let index = 0; index <= limit; index += 1) {
    let matches = true;
    for (let offset = 0; offset < quoteSpans.length; offset += 1) {
      if (sourceSpans[index + offset]?.word !== quoteSpans[offset]?.word) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    const located = quoteFromSpans(
      sliceText,
      sourceSpans,
      index,
      index + quoteSpans.length - 1,
    );
    if (located) return located;
  }
  return null;
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
 * A supplied quote must sit in the source. A miss drops the card. Indexes
 * are used only when the model did not supply wording.
 */
export function verifySpan(
  source: string,
  pick: SpanPick | null | undefined,
): LocatedQuote | null {
  if (!pick) return null;
  if (pick.quote !== undefined) {
    return locateContiguousQuote(source, pick.quote);
  }
  return sliceFromIndexes(source, pick.start, pick.end);
}
