import "server-only";

import { foundMinimumWords } from "@/features/insights/found-types";

const curlySingle = /[\u2018\u2019\u201A\u201B\u2032\u2035]/gu;
const curlyDouble = /[\u201C\u201D\u201E\u201F\u2033\u2036]/gu;
const dashes = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/gu;
const boundary = /[\s\p{P}\p{S}]/u;

export type FoundWordSpan = Readonly<{
  word: string;
  start: number;
  end: number;
}>;

/** NFKC, straight quotes, and plain dashes. Punctuation stays in place. */
export function canonicalFoundText(value: string) {
  return value
    .normalize("NFKC")
    .replace(curlySingle, "'")
    .replace(curlyDouble, '"')
    .replace(dashes, "-");
}

export function foundWordSpans(value: string): FoundWordSpan[] {
  const text = canonicalFoundText(value);
  const spans: FoundWordSpan[] = [];
  let index = 0;
  while (index < text.length) {
    if (boundary.test(text[index] ?? "")) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < text.length && !boundary.test(text[index] ?? "")) {
      index += 1;
    }
    spans.push({
      word: text.slice(start, index).toLowerCase(),
      start,
      end: index,
    });
  }
  return spans;
}

export function foundWords(value: string) {
  return foundWordSpans(value).map((span) => span.word);
}

export function hasFoundMinimumWords(value: string) {
  return foundWords(value).length >= foundMinimumWords;
}
