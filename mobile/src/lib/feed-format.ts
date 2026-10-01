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

const coordinatePair = /^-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?$/u;
const coordinateFragment = /^-?\d+\.\d+$/u;

/**
 * Place text for a card header. A stored "35.1276, -120.6308" is not a name;
 * shortPlaceLabel would otherwise keep "35.1276".
 */
export function displayPlaceLabel(value: string | null | undefined, short = true) {
  const trimmed = value?.trim().slice(0, 160) ?? "";
  if (!trimmed || coordinatePair.test(trimmed)) return "";
  const label = short ? shortPlaceLabel(trimmed) : trimmed;
  if (!label || coordinatePair.test(label) || coordinateFragment.test(label)) return "";
  return label;
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

/**
 * Same decisions as src/features/moments/moment-audience.ts.
 * A just_me moment still has moments.circle_id (often "Home") and may have
 * no moment_circles rows. The chip never uses that circle id.
 */
export function normalizeMomentAudience(value: unknown) {
  return value === "just_me" ? "just_me" : "family";
}

export function audienceCircleIds(input: Readonly<{
  audience: unknown;
  linkedCircleIds?: readonly string[] | null;
  circleId?: string | null;
}>) {
  if (normalizeMomentAudience(input.audience) === "just_me") return [];
  const linked = input.linkedCircleIds?.filter(Boolean) ?? [];
  if (linked.length > 0) return [...linked];
  return input.circleId ? [input.circleId] : [];
}

function compactAudienceCircleLabel(
  ids: readonly string[],
  names?: ReadonlyMap<string, string>,
) {
  const known = ids.flatMap((id) => {
    const name = names?.get(id)?.trim();
    return name ? [name] : [];
  });
  if (ids.length <= 1) return known[0] ?? "1 circle";
  if (ids.length === 2) return known[0] ? `${known[0]} +1` : "2 circles";
  return `${ids.length} circles`;
}

export function audienceChipLabel(input: Readonly<{
  audience: unknown;
  linkedCircleIds?: readonly string[] | null;
  circleId?: string | null;
  circleNames?: ReadonlyMap<string, string>;
  /** Set on a single-circle feed. Null on All circles and Just me. */
  feedCircleId?: string | null;
}>) {
  if (normalizeMomentAudience(input.audience) === "just_me") return "Just me";
  const ids = audienceCircleIds(input);
  const labeledIds = ids.length > 0 ? ids : [];
  if (input.feedCircleId) {
    const others = labeledIds.filter((id) => id !== input.feedCircleId);
    if (others.length > 0) {
      return `Also · ${compactAudienceCircleLabel(others, input.circleNames)}`;
    }
  }
  return compactAudienceCircleLabel(
    labeledIds.length > 0 ? labeledIds : ["_"],
    input.circleNames,
  );
}

/**
 * Where a saved post is listed. Mirrors the timeline RPCs:
 * list_all_timeline_moments includes the viewer's just_me posts;
 * list_timeline_moments for one circle (no journal person) keeps family only;
 * the personal journal includes that person's just_me posts.
 */
export function momentListedInFeed(input: Readonly<{
  audience: unknown;
  feed: "all" | "circle" | "personal";
}>) {
  if (normalizeMomentAudience(input.audience) !== "just_me") return true;
  return input.feed !== "circle";
}

export const visibleNoteLimit = 4;

export function visibleNotes<T>(notes: readonly T[], showAll: boolean) {
  const newestFirst = notes.slice().reverse();
  return showAll ? newestFirst : newestFirst.slice(0, visibleNoteLimit);
}

export function hiddenNoteCount(noteCount: number) {
  return Math.max(0, noteCount - visibleNoteLimit);
}
