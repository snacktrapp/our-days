/**
 * Feed copy helpers mirrored from the web.
 * Audience: src/features/moments/moment-audience.ts
 * Bible marker: src/features/composer/bible-verse-catalog.ts parse pattern
 * Insight link: src/features/insights/insight-source.ts insightSourceLabel
 * Mentions: src/features/mentions/mention-text.tsx
 * Place: src/lib/place-coordinates.ts shortPlaceLabel
 * Notes window: src/features/timeline/moment-conversation-notes.ts
 */

export type MentionSpan = Readonly<{
  userId: string;
  start: number;
  end: number;
  name: string | null;
  active: boolean;
}>;

export function shortPlaceLabel(value: string) {
  const trimmed = value.trim().slice(0, 160);
  if (!trimmed) return "";
  const comma = trimmed.indexOf(",");
  return comma > 0 ? trimmed.slice(0, comma).trim() : trimmed;
}

export function personInitial(name: string) {
  return Array.from(name.trim())[0]?.toLocaleUpperCase("en-US") ?? "•";
}

export function insightSourceLabel(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (
      host === "youtu.be" ||
      host.endsWith(".youtube.com") ||
      host === "youtube.com" ||
      host.endsWith(".spotify.com") ||
      host === "spotify.com" ||
      host === "podcasts.apple.com"
    ) {
      return "Listen";
    }
  } catch {
    return "Read the source";
  }
  return "Read the source";
}

const bibleVerseMomentPattern =
  /^([\s\S]+)\n\n— ([^\n]+) · World English Bible$/u;

export function parseBibleVerse(text: string) {
  const match = bibleVerseMomentPattern.exec(text);
  if (!match) return null;
  return { verse: match[1] ?? "", reference: match[2] ?? "" };
}

function sliceCodePoints(text: string, start: number, end: number) {
  let index = 0;
  let result = "";
  for (const character of text) {
    if (index >= end) break;
    if (index >= start) result += character;
    index += 1;
  }
  return result;
}

export type MentionPiece = Readonly<{
  key: string;
  text: string;
  mention: boolean;
}>;

export function mentionPieces(
  text: string,
  mentions: readonly MentionSpan[] = [],
): readonly MentionPiece[] {
  const length = Array.from(text).length;
  const usable = mentions
    .filter(
      (mention) =>
        mention.start >= 0 &&
        mention.end > mention.start &&
        mention.end <= length,
    )
    .slice()
    .sort((left, right) => left.start - right.start);
  if (usable.length === 0) return [{ key: "all", text, mention: false }];
  const pieces: MentionPiece[] = [];
  let cursor = 0;
  for (const mention of usable) {
    if (mention.start < cursor) continue;
    if (mention.start > cursor) {
      pieces.push({
        key: `t-${cursor}`,
        text: sliceCodePoints(text, cursor, mention.start),
        mention: false,
      });
    }
    const raw = sliceCodePoints(text, mention.start, mention.end);
    if (mention.active && mention.name) {
      pieces.push({
        key: `${mention.userId}-${mention.start}`,
        text: `@${mention.name}`,
        mention: true,
      });
    } else {
      pieces.push({
        key: `r-${mention.start}`,
        text: raw,
        mention: false,
      });
    }
    cursor = mention.end;
  }
  if (cursor < length) {
    pieces.push({
      key: `t-${cursor}`,
      text: sliceCodePoints(text, cursor, length),
      mention: false,
    });
  }
  return pieces;
}

export function audienceChipLabel(input: Readonly<{
  audience: string;
  linkedCircleIds: readonly string[];
  circleId: string;
  circleNames: ReadonlyMap<string, string>;
}>) {
  if (input.audience === "just_me") return "Just me";
  const ids =
    input.linkedCircleIds.length > 0 ? input.linkedCircleIds : [input.circleId];
  const names = ids.flatMap((id) => {
    const name = input.circleNames.get(id)?.trim();
    return name ? [name] : [];
  });
  if (ids.length <= 1) return names[0] ?? "1 circle";
  if (ids.length === 2) return names[0] ? `${names[0]} +1` : "2 circles";
  return `${ids.length} circles`;
}

export const visibleNoteLimit = 4;

export function visibleNotes<T>(notes: readonly T[], showAll: boolean) {
  const newestFirst = notes.slice().reverse();
  return showAll ? newestFirst : newestFirst.slice(0, visibleNoteLimit);
}

export function hiddenNoteCount(noteCount: number) {
  return Math.max(0, noteCount - visibleNoteLimit);
}
