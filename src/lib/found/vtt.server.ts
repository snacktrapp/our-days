import "server-only";

import { canonicalFoundText, foundWordSpans } from "./normalize.server";

export type CaptionCue = Readonly<{
  startSeconds: number;
  endSeconds: number;
  text: string;
}>;

export type TimedWord = Readonly<{
  word: string;
  start: number;
  end: number;
  cueStart: number;
  cueEnd: number;
}>;

function stamp(
  hours: number,
  minutes: number,
  seconds: number,
  fraction: string | undefined,
) {
  if (seconds > 59) return null;
  const millis = fraction ? Number(fraction.padEnd(3, "0").slice(0, 3)) : 0;
  if (!Number.isFinite(millis)) return null;
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

export function parseVttTimestamp(value: string) {
  const trimmed = value.trim();
  const three = /^(\d+):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/u.exec(trimmed);
  if (three) {
    const minutes = Number(three[2]);
    if (minutes > 59) return null;
    return stamp(Number(three[1]), minutes, Number(three[3]), three[4]);
  }
  const two = /^(\d+):(\d{2})(?:\.(\d{1,3}))?$/u.exec(trimmed);
  if (!two) return null;
  return stamp(0, Number(two[1]), Number(two[2]), two[3]);
}

function decodeCue(value: string) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseVtt(input: string): CaptionCue[] {
  const lines = input
    .replace(/^\uFEFF/u, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
  const cues: CaptionCue[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]?.trim() ?? "";
    if (!line) {
      index += 1;
      continue;
    }
    if (
      line.startsWith("NOTE") ||
      line.startsWith("STYLE") ||
      line.startsWith("REGION")
    ) {
      index += 1;
      while (index < lines.length && lines[index]?.trim()) index += 1;
      continue;
    }
    if (line.startsWith("WEBVTT")) {
      index += 1;
      continue;
    }
    let timing = line;
    if (!line.includes("-->") && index + 1 < lines.length) {
      index += 1;
      timing = lines[index]?.trim() ?? "";
    }
    const match = /^(\S+)\s+-->\s+(\S+)/u.exec(timing);
    if (!match) {
      index += 1;
      continue;
    }
    const start = parseVttTimestamp(match[1] ?? "");
    const end = parseVttTimestamp(match[2] ?? "");
    index += 1;
    const textLines: string[] = [];
    while (index < lines.length && lines[index]?.trim()) {
      textLines.push(lines[index] ?? "");
      index += 1;
    }
    if (start === null || end === null) continue;
    const text = decodeCue(textLines.join(" "));
    if (!text) continue;
    cues.push({
      startSeconds: start,
      endSeconds: Math.max(end, start),
      text,
    });
  }
  return cues;
}

function suffixPrefixOverlap(
  previous: readonly string[],
  next: readonly string[],
) {
  const max = Math.min(previous.length, next.length);
  let best = 0;
  for (let size = 1; size <= max; size += 1) {
    let same = true;
    for (let index = 0; index < size; index += 1) {
      if (previous[previous.length - size + index] !== next[index]) {
        same = false;
        break;
      }
    }
    if (same) best = size;
  }
  return best;
}

/** Drop rolling-caption repeats. Timestamps stay with the cue that introduced each word. */
export function transcriptFromCues(cues: readonly CaptionCue[]) {
  const words: TimedWord[] = [];
  let text = "";
  let previous: string[] = [];
  for (const cue of cues) {
    const canonical = canonicalFoundText(cue.text);
    const spans = foundWordSpans(canonical);
    const tokens = spans.map((span) => span.word);
    const overlap = suffixPrefixOverlap(previous, tokens);
    for (const span of spans.slice(overlap)) {
      if (text.length > 0) text += " ";
      const start = text.length;
      text += canonical.slice(span.start, span.end);
      words.push({
        word: span.word,
        start,
        end: text.length,
        cueStart: cue.startSeconds,
        cueEnd: cue.endSeconds,
      });
    }
    previous = tokens;
  }
  return { text, words };
}

export function timestampsForSlice(
  words: readonly TimedWord[] | undefined,
  start: number,
  end: number,
) {
  if (!words?.length) return null;
  const covered = words.filter((word) => word.end > start && word.start < end);
  const first = covered[0];
  const last = covered[covered.length - 1];
  if (!first || !last) return null;
  return { startSeconds: first.cueStart, endSeconds: last.cueEnd };
}
