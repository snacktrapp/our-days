export type DraftMention = Readonly<{
  userId: string;
  name: string;
  start: number;
  end: number;
}>;

export type MentionCandidate = Readonly<{
  userId: string;
  name: string;
  initial: string;
  accent: string;
  circleId?: string;
}>;

export type MentionDisplay = Readonly<{
  userId: string;
  start: number;
  end: number;
  name: string | null;
  active: boolean;
}>;

const maxQueryLength = 40;

export function mentionToken(name: string) {
  return `@${name}`;
}

export function mentionQueryAt(
  text: string,
  cursor: number,
  mentions: readonly DraftMention[],
) {
  if (
    mentions.some((mention) => cursor > mention.start && cursor < mention.end)
  ) {
    return null;
  }
  const before = text.slice(0, cursor);
  let at = -1;
  for (let index = before.length - 1; index >= 0; index -= 1) {
    const character = before[index];
    if (character === "@") {
      at = index;
      break;
    }
    if (character === "\n") return null;
  }
  if (at < 0) return null;
  if (at > 0 && !/\s/u.test(before[at - 1] ?? "")) return null;
  if (mentions.some((mention) => at >= mention.start && at < mention.end)) {
    return null;
  }
  const query = before.slice(at + 1);
  if (query.length > maxQueryLength) return null;
  return { start: at, query };
}

export function filterMentionCandidates(
  members: readonly MentionCandidate[],
  query: string,
) {
  const needle = query.trim().toLocaleLowerCase("en-US");
  const seen = new Set<string>();
  const matches: MentionCandidate[] = [];
  for (const member of members) {
    if (seen.has(member.userId)) continue;
    const name = member.name.toLocaleLowerCase("en-US");
    if (needle && !name.includes(needle)) continue;
    seen.add(member.userId);
    matches.push(member);
    if (matches.length === 8) break;
  }
  return matches;
}

function shiftMentions(
  mentions: readonly DraftMention[],
  from: number,
  delta: number,
) {
  return mentions.map((mention) =>
    mention.start >= from
      ? {
          ...mention,
          start: mention.start + delta,
          end: mention.end + delta,
        }
      : mention,
  );
}

export function applyMentionTextChange(
  previous: string,
  next: string,
  mentions: readonly DraftMention[],
) {
  if (previous === next) return { text: next, mentions, cursor: next.length };
  let prefix = 0;
  const limit = Math.min(previous.length, next.length);
  while (prefix < limit && previous[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const oldEnd = previous.length - suffix;
  const newEnd = next.length - suffix;
  const insertion = next.slice(prefix, newEnd);
  let start = prefix;
  let end = oldEnd;
  let grew = true;
  while (grew) {
    grew = false;
    for (const mention of mentions) {
      if (mention.end > start && mention.start < end) {
        const nextStart = Math.min(start, mention.start);
        const nextEnd = Math.max(end, mention.end);
        if (nextStart !== start || nextEnd !== end) {
          start = nextStart;
          end = nextEnd;
          grew = true;
        }
      }
    }
  }
  const text =
    start === prefix && end === oldEnd
      ? next
      : previous.slice(0, start) + insertion + previous.slice(end);
  const cursor = start + insertion.length;
  const delta = insertion.length - (end - start);
  const kept = shiftMentions(
    mentions.filter((mention) => mention.end <= start || mention.start >= end),
    end,
    delta,
  ).filter(
    (mention) =>
      text.slice(mention.start, mention.end) === mentionToken(mention.name),
  );
  return { text, mentions: kept, cursor };
}

export function codePointLength(text: string) {
  return Array.from(text).length;
}

export function sliceCodePoints(text: string, start: number, end: number) {
  let index = 0;
  let result = "";
  for (const character of text) {
    if (index >= end) break;
    if (index >= start) result += character;
    index += 1;
  }
  return result;
}

function jsIndexToCodePoint(text: string, jsIndex: number) {
  return codePointLength(text.slice(0, jsIndex));
}

export function insertMention(
  text: string,
  cursor: number,
  queryStart: number,
  member: MentionCandidate,
  mentions: readonly DraftMention[],
) {
  const token = `${mentionToken(member.name)} `;
  const next = text.slice(0, queryStart) + token + text.slice(cursor);
  const span: DraftMention = {
    userId: member.userId,
    name: member.name,
    start: queryStart,
    end: queryStart + token.length - 1,
  };
  const delta = token.length - (cursor - queryStart);
  const shifted = mentions
    .filter((mention) => mention.end <= queryStart || mention.start >= cursor)
    .map((mention) =>
      mention.start >= cursor
        ? {
            ...mention,
            start: mention.start + delta,
            end: mention.end + delta,
          }
        : mention,
    );
  return {
    text: next,
    mentions: [...shifted, span].sort(
      (left, right) => left.start - right.start,
    ),
    cursor: queryStart + token.length,
  };
}

export function mentionsForSavedBody(
  body: string,
  mentions: readonly DraftMention[],
) {
  const trimmed = body.trim();
  const leading = body.length - body.trimStart().length;
  return mentions.flatMap((mention) => {
    const start = mention.start - leading;
    const end = mention.end - leading;
    if (start < 0 || end > trimmed.length) return [];
    if (trimmed.slice(start, end) !== mentionToken(mention.name)) return [];
    return [
      {
        userId: mention.userId,
        start: jsIndexToCodePoint(trimmed, start),
        end: jsIndexToCodePoint(trimmed, end),
      },
    ];
  });
}

export function draftFromMentionDisplay(
  text: string,
  mentions: readonly MentionDisplay[],
) {
  const ordered = [...mentions].sort((left, right) => left.start - right.start);
  let cursor = 0;
  let next = "";
  const drafts: DraftMention[] = [];
  for (const mention of ordered) {
    if (
      mention.start < cursor ||
      mention.end > codePointLength(text) ||
      mention.start < 0
    ) {
      continue;
    }
    next += sliceCodePoints(text, cursor, mention.start);
    if (mention.active && mention.name) {
      const token = mentionToken(mention.name);
      const start = next.length;
      next += token;
      drafts.push({
        userId: mention.userId,
        name: mention.name,
        start,
        end: start + token.length,
      });
    } else {
      next += sliceCodePoints(text, mention.start, mention.end);
    }
    cursor = mention.end;
  }
  next += sliceCodePoints(text, cursor, codePointLength(text));
  return { text: next, mentions: drafts };
}

export function mentionSnippet(text: string) {
  const compact = text.replace(/\s+/gu, " ").trim();
  if (compact.length <= 80) return compact;
  return `${compact.slice(0, 79).trimEnd()}…`;
}
