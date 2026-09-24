import type { ReactNode } from "react";
import {
  codePointLength,
  sliceCodePoints,
  type MentionDisplay,
} from "./mention-draft";

export function renderMentionText(
  text: string,
  mentions: readonly MentionDisplay[] = [],
) {
  const usable = mentions
    .filter(
      (mention) =>
        mention.start >= 0 &&
        mention.end > mention.start &&
        mention.end <= codePointLength(text),
    )
    .sort((left, right) => left.start - right.start);
  if (usable.length === 0) return text;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const mention of usable) {
    if (mention.start < cursor) continue;
    if (mention.start > cursor)
      nodes.push(sliceCodePoints(text, cursor, mention.start));
    const raw = sliceCodePoints(text, mention.start, mention.end);
    if (mention.active && mention.name) {
      nodes.push(
        <span
          key={`${mention.userId}-${mention.start}`}
          className="mention-token"
        >
          {`@${mention.name}`}
        </span>,
      );
    } else {
      nodes.push(raw);
    }
    cursor = mention.end;
  }
  if (cursor < codePointLength(text)) {
    nodes.push(sliceCodePoints(text, cursor, codePointLength(text)));
  }
  return nodes;
}

export function MentionText({
  text,
  mentions,
}: Readonly<{
  text: string;
  mentions?: readonly MentionDisplay[];
}>) {
  return renderMentionText(text, mentions);
}
