export const foundMinimumWords = 8;
export const foundMaximumQuoteLength = 4000;
export const foundSearchTimeoutMs = 45_000;

export const foundEmptyMessage =
  "Couldn't verify a match. Try naming the show, speaker, or roughly when.";
export const foundTimeoutMessage = "That took too long. Try again.";
export const foundCapMessage = "You've used today's Found searches.";
export const foundRestingMessage = "Found is resting for today.";
export const foundUnavailableMessage = "Found is unavailable.";
export const foundMemberMessage =
  "Only an organizer or Operations can create an Insight.";

export const foundVerifiedTranscript = "Verified from transcript";
export const foundVerifiedSource = "Verified from source";
export const foundVerifiedBible = "Verified from the World English Bible";

export type FoundCandidate = Readonly<{
  quote: string;
  attribution: string;
  sourceUrl: string;
  sourceLabel: "Listen" | "Read the source";
  verifiedLabel: string;
  rangeLabel?: string;
  videoId?: string;
}>;

export type FoundInsightPost = Readonly<{
  quote: string;
  attribution: string;
  sourceUrl: string;
  occurredOn: string;
  audience: "family" | "just_me";
  circleId?: string;
  circleIds: readonly string[];
}>;

/** The body POST /api/insights accepts. Verified marks stay on the picker. */
export function foundInsightRequestBody(post: FoundInsightPost) {
  return {
    quote: post.quote,
    attribution: post.attribution,
    sourceUrl: post.sourceUrl,
    occurredOn: post.occurredOn,
    audience: post.audience,
    ...(post.circleId ? { circleId: post.circleId } : {}),
    circleIds: [...post.circleIds],
  };
}

export function parseFoundQuery(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length < 1 || trimmed.length > 280) return null;
  return trimmed;
}

export function formatFoundClock(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function formatFoundRange(startSeconds: number, endSeconds: number) {
  return `${formatFoundClock(startSeconds)}–${formatFoundClock(endSeconds)}`;
}
