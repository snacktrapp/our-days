import "server-only";

import {
  foundMaximumQuoteLength,
  foundMinimumWords,
} from "@/features/insights/found-types";
import {
  foundWordSpans,
  foundWords,
  type FoundWordSpan,
} from "./normalize.server";

const stopwords = new Set([
  "about",
  "after",
  "again",
  "also",
  "and",
  "are",
  "because",
  "been",
  "before",
  "being",
  "but",
  "can",
  "did",
  "discussing",
  "does",
  "doing",
  "for",
  "from",
  "had",
  "has",
  "have",
  "her",
  "his",
  "how",
  "into",
  "its",
  "just",
  "not",
  "our",
  "over",
  "she",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
  "your",
]);

export type RankedPassage = Readonly<{
  quote: string;
  start: number;
  end: number;
  offset: number;
}>;

/** Topic words from the request. Short words and filler drop out. */
export function foundTopicWords(query: string) {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const word of foundWords(query)) {
    if (word.length < 3 || stopwords.has(word) || seen.has(word)) continue;
    seen.add(word);
    words.push(word);
  }
  return words;
}

function startsSentence(
  text: string,
  spans: readonly FoundWordSpan[],
  index: number,
) {
  if (index <= 0) return true;
  const previous = spans[index - 1]!;
  const current = spans[index]!;
  const gap = text.slice(previous.end, current.start);
  if (/[.!?\n]/u.test(gap)) return true;
  if (gap !== "" && !/^\s+$/u.test(gap)) return false;
  const word = text.slice(current.start, current.end);
  return word.length >= 2 && /^[\p{Lu}]/u.test(word);
}

function sentenceBounds(text: string, spans: readonly FoundWordSpan[]) {
  const sentences: Array<{ from: number; through: number }> = [];
  let from = 0;
  for (let index = 1; index <= spans.length; index += 1) {
    if (index === spans.length || startsSentence(text, spans, index)) {
      if (index > from) sentences.push({ from, through: index - 1 });
      from = index;
    }
  }
  return sentences;
}

function sliceSpans(
  text: string,
  spans: readonly FoundWordSpan[],
  from: number,
  through: number,
) {
  if (through - from + 1 < foundMinimumWords) return null;
  const start = spans[from]?.start;
  const end = spans[through]?.end;
  if (start === undefined || end === undefined) return null;
  const quote = text.slice(start, end);
  if (!quote.trim() || quote.length > foundMaximumQuoteLength) return null;
  return { quote, start, end };
}

function passageScore(quote: string, topicWords: readonly string[]) {
  const present = new Set(foundWords(quote));
  let weight = 0;
  for (const word of topicWords) {
    if (!present.has(word)) continue;
    weight += word.length * word.length;
  }
  return weight;
}

function wordKey(quote: string) {
  return foundWords(quote).join(" ");
}

/**
 * Up to three verifiable passages from one source.
 * Topic matches outrank an intro. With no topic words, only the model passage is kept.
 */
export function selectFoundPassages(
  text: string,
  topicWords: readonly string[],
  model: RankedPassage | null,
) {
  if (topicWords.length === 0) return model ? [model] : [];
  const spans = foundWordSpans(text);
  const sentences = sentenceBounds(text, spans);
  const ranked: Array<RankedPassage & { score: number }> = [];
  sentences.forEach((sentence, index) => {
    const opening = spans
      .slice(sentence.from, sentence.through + 1)
      .map((span) => span.word);
    if (passageScore(opening.join(" "), topicWords) === 0) return;
    let located: { quote: string; start: number; end: number } | null = null;
    for (
      let through = index;
      through < sentences.length && through <= index + 3;
      through += 1
    ) {
      const slice = sliceSpans(
        text,
        spans,
        sentence.from,
        sentences[through]!.through,
      );
      if (slice) {
        located = slice;
        break;
      }
      const wordCount = sentences[through]!.through - sentence.from + 1;
      if (wordCount >= foundMinimumWords) break;
    }
    if (!located) return;
    const score = passageScore(located.quote, topicWords);
    if (score === 0) return;
    ranked.push({ ...located, offset: 0, score });
  });
  if (model) {
    const key = wordKey(model.quote);
    const score = passageScore(model.quote, topicWords);
    const duplicate = ranked.some((passage) => wordKey(passage.quote) === key);
    if (!duplicate && (score > 0 || ranked.length === 0)) {
      ranked.push({ ...model, score });
    }
  }
  const tightened = ranked.filter((passage) => {
    const words = wordKey(passage.quote);
    return !ranked.some((other) => {
      if (other === passage || other.score !== passage.score) return false;
      const otherWords = wordKey(other.quote);
      return (
        otherWords.length < words.length && words.startsWith(`${otherWords} `)
      );
    });
  });
  tightened.sort(
    (left, right) =>
      right.score - left.score ||
      right.end - right.start - (left.end - left.start) ||
      left.start - right.start,
  );
  const seen = new Set<string>();
  const chosen: RankedPassage[] = [];
  for (const passage of tightened) {
    const key = wordKey(passage.quote);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    chosen.push({
      quote: passage.quote,
      start: passage.start,
      end: passage.end,
      offset: passage.offset,
    });
    if (chosen.length >= 3) break;
  }
  return chosen;
}
