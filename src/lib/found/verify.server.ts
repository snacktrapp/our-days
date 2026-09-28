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

/**
 * A near match may differ by a few words. 0.85 keeps a two-word paraphrase of
 * the 26-word excellence passage (24/26 = 0.923) and rejects the fixture's
 * three-word rewrite (about 0.76). The window stays within 25% of the quote.
 */
export const foundNearMatchMinimumSimilarity = 0.85;
export const foundNearMatchLengthSlack = 0.25;
const foundNearMatchMaximumTokens = 120;
const foundNearMatchMaximumComparisons = 2500;

export type NearQuoteRecovery = Readonly<{
  ok: boolean;
  similarity: number;
  located: LocatedQuote | null;
}>;

type ContentToken = Readonly<{ word: string; start: number; end: number }>;

function roundSimilarity(value: number) {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

function isNameToken(text: string, span: FoundWordSpan) {
  return /^[A-Z][\p{L}'’.-]{0,40}$/u.test(text.slice(span.start, span.end));
}

function isLabelGap(gap: string) {
  return /^[\s([]+$/u.test(gap);
}

function timestampSpanCount(
  text: string,
  spans: readonly FoundWordSpan[],
  index: number,
) {
  const first = spans[index];
  const second = spans[index + 1];
  const third = spans[index + 2];
  if (!first || !second || !third) return 0;
  if (!/^\d{1,2}$/u.test(first.word)) return 0;
  if (!/^\d{2}$/u.test(second.word) || !/^\d{2}$/u.test(third.word)) return 0;
  const gapOne = text.slice(first.end, second.start);
  const gapTwo = text.slice(second.end, third.start);
  if (!/^[\s:()[\]]+$/u.test(gapOne) || !gapOne.includes(":")) return 0;
  if (!/^[\s:()[\]]+$/u.test(gapTwo) || !gapTwo.includes(":")) return 0;
  return 3;
}

function atSentenceBoundary(
  text: string,
  spans: readonly FoundWordSpan[],
  index: number,
) {
  if (index <= 0) return true;
  return /[.!?\n]/u.test(
    text.slice(spans[index - 1]!.end, spans[index]!.start),
  );
}

/** Words used for comparison. Speaker labels and clock times are not words. */
function contentTokens(value: string): ContentToken[] {
  const text = canonicalFoundText(value);
  const spans = foundWordSpans(text);
  const skip = new Set<number>();
  for (let index = 0; index < spans.length; index += 1) {
    const count = timestampSpanCount(text, spans, index);
    if (count > 0) {
      for (let offset = 0; offset < count; offset += 1)
        skip.add(index + offset);
      const names: number[] = [];
      let name = index - 1;
      while (name >= 0 && names.length < 4 && isNameToken(text, spans[name]!)) {
        const gap = text.slice(spans[name]!.end, spans[name + 1]!.start);
        if (!isLabelGap(gap)) break;
        names.push(name);
        name -= 1;
      }
      const firstName = names[names.length - 1];
      if (
        firstName !== undefined &&
        atSentenceBoundary(text, spans, firstName)
      ) {
        for (const id of names) skip.add(id);
      }
      index += count - 1;
      continue;
    }
    const next = spans[index + 1];
    const gap = text.slice(spans[index]!.end, next?.start ?? text.length);
    if (
      gap.trimStart().startsWith(":") &&
      isNameToken(text, spans[index]!) &&
      atSentenceBoundary(text, spans, index)
    ) {
      skip.add(index);
    }
  }
  return spans
    .filter((_, index) => !skip.has(index))
    .map((span) => ({ word: span.word, start: span.start, end: span.end }));
}

function tokenSimilarity(left: readonly string[], right: readonly string[]) {
  const maxLen = Math.max(left.length, right.length);
  if (maxLen === 0) return 0;
  const difference = Math.abs(left.length - right.length);
  const maxDistance = Math.floor(
    maxLen * (1 - foundNearMatchMinimumSimilarity),
  );
  if (difference > maxDistance) return (maxLen - difference) / maxLen;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = Array.from(
      { length: right.length + 1 },
      () => maxDistance + 1,
    );
    current[0] = row;
    const from = Math.max(1, row - maxDistance);
    const to = Math.min(right.length, row + maxDistance);
    let rowBest = current[0] ?? row;
    for (let column = from; column <= to; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      const value = Math.min(
        (previous[column] ?? maxDistance + 1) + 1,
        (current[column - 1] ?? maxDistance + 1) + 1,
        (previous[column - 1] ?? maxDistance + 1) + cost,
      );
      current[column] = value;
      if (value < rowBest) rowBest = value;
    }
    if (rowBest > maxDistance) return (maxLen - rowBest) / maxLen;
    previous = current;
  }
  return (maxLen - (previous[right.length] ?? maxDistance + 1)) / maxLen;
}

function sliceTextFor(source: string) {
  const text = canonicalFoundText(source);
  return displayFoundText(source).length === text.length
    ? displayFoundText(source)
    : text;
}

function locatedSlice(
  source: string,
  from: ContentToken,
  to: ContentToken,
): LocatedQuote | null {
  const text = sliceTextFor(source);
  let end = to.end;
  while (end < text.length && /["”')\].!?…]/u.test(text[end] ?? "")) end += 1;
  const quote = text.slice(from.start, end);
  if (!quote.trim() || quote.length > foundMaximumQuoteLength) return null;
  if (foundWordSpans(quote).length < foundMinimumWords) return null;
  return { quote, start: from.start, end };
}

/**
 * Best source passage for a quote that missed the exact check.
 * The returned quote is a source slice, never the supplied wording.
 */
export function recoverNearQuote(
  source: string,
  quote: string,
): NearQuoteRecovery {
  const empty = { ok: false, similarity: 0, located: null } as const;
  if (!quote.trim() || quote.length > foundMaximumQuoteLength) return empty;
  const quoteTokens = contentTokens(quote);
  const sourceTokens = contentTokens(source);
  if (
    quoteTokens.length < foundMinimumWords ||
    quoteTokens.length > foundNearMatchMaximumTokens
  ) {
    return empty;
  }
  const quoteWords = quoteTokens.map((token) => token.word);
  const first = quoteWords[0]!;
  const last = quoteWords[quoteWords.length - 1]!;
  const minLen = Math.max(
    foundMinimumWords,
    Math.ceil(quoteTokens.length * (1 - foundNearMatchLengthSlack)),
  );
  const maxLen = Math.floor(
    quoteTokens.length * (1 + foundNearMatchLengthSlack),
  );
  const ends: number[] = [];
  for (let index = 0; index < sourceTokens.length; index += 1) {
    if (sourceTokens[index]?.word === last) ends.push(index);
  }
  let best = 0;
  let located: LocatedQuote | null = null;
  let examined = 0;
  const consider = (end: number) => {
    if (examined >= foundNearMatchMaximumComparisons) return;
    const minStart = Math.max(0, end - maxLen + 1);
    const maxStart = end - minLen + 1;
    if (maxStart < minStart) return;
    const ideal = end - quoteTokens.length + 1;
    const starts: number[] = [];
    for (let start = minStart; start <= maxStart; start += 1) {
      if (sourceTokens[start]?.word === first) starts.push(start);
    }
    starts.sort(
      (left, right) => Math.abs(left - ideal) - Math.abs(right - ideal),
    );
    for (const start of starts.slice(0, 3)) {
      if (examined >= foundNearMatchMaximumComparisons) return;
      examined += 1;
      const window = sourceTokens
        .slice(start, end + 1)
        .map((token) => token.word);
      if (window[0] !== first || window[window.length - 1] !== last) continue;
      const similarity = tokenSimilarity(quoteWords, window);
      if (similarity <= best) continue;
      best = similarity;
      if (similarity + 1e-12 < foundNearMatchMinimumSimilarity) continue;
      const slice = locatedSlice(
        source,
        sourceTokens[start]!,
        sourceTokens[end]!,
      );
      if (slice) located = slice;
    }
  };
  let left = 0;
  let right = ends.length - 1;
  while (left <= right && examined < foundNearMatchMaximumComparisons) {
    consider(ends[right]!);
    if (best >= 0.999) break;
    right -= 1;
    if (left <= right && examined < foundNearMatchMaximumComparisons) {
      consider(ends[left]!);
      if (best >= 0.999) break;
      left += 1;
    }
  }
  if (!located) {
    return { ok: false, similarity: roundSimilarity(best), located: null };
  }
  return { ok: true, similarity: roundSimilarity(best), located };
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
