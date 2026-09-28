import "server-only";

import { canonicalFoundText, foundWordSpans } from "./normalize.server";
import type { TimedWord } from "./vtt.server";

const stampPattern = /[(\[](\d{1,2}):(\d{2}):(\d{2})[)\]]/gu;

function stampSeconds(hours: string, minutes: string, seconds: string) {
  const minute = Number(minutes);
  const second = Number(seconds);
  if (minute > 59 || second > 59) return null;
  return Number(hours) * 3600 + minute * 60 + second;
}

/**
 * Publisher transcript pages keep times inline, as (01:52:42) or [1:52:42].
 * The returned text omits those markers so a quote can match word for word.
 * Each following word keeps the marker's start time.
 */
export function timedTranscriptFromPage(raw: string) {
  const source = canonicalFoundText(raw);
  const marks: Array<{ index: number; length: number; seconds: number }> = [];
  for (const match of source.matchAll(stampPattern)) {
    if (match.index === undefined) continue;
    const seconds = stampSeconds(
      match[1] ?? "",
      match[2] ?? "",
      match[3] ?? "",
    );
    if (seconds === null) continue;
    marks.push({ index: match.index, length: match[0].length, seconds });
  }

  let text = "";
  const words: TimedWord[] = [];
  const pushSegment = (
    segment: string,
    cueStart: number | null,
    cueEnd: number | null,
  ) => {
    for (const span of foundWordSpans(segment)) {
      if (text.length > 0) text += " ";
      const start = text.length;
      text += segment.slice(span.start, span.end);
      if (cueStart === null) continue;
      words.push({
        word: span.word,
        start,
        end: text.length,
        cueStart,
        cueEnd: cueEnd ?? cueStart,
      });
    }
  };

  if (marks.length === 0) {
    pushSegment(source, null, null);
    return { text, words };
  }

  pushSegment(source.slice(0, marks[0]!.index), null, null);
  for (let index = 0; index < marks.length; index += 1) {
    const mark = marks[index]!;
    const next = marks[index + 1];
    pushSegment(
      source.slice(mark.index + mark.length, next?.index ?? source.length),
      mark.seconds,
      next?.seconds ?? mark.seconds,
    );
  }
  return { text, words };
}
