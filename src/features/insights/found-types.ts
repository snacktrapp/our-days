export const foundMinimumWords = 8;
export const foundMaximumQuoteLength = 4000;
export const foundSearchTimeoutMs = 45_000;

export const foundEmptyMessage =
  "Couldn't verify a match. Try naming the show, speaker, or roughly when.";
export const foundSourceMessage =
  "Couldn't open that source. Try again or add more detail.";
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
  speaker?: string;
  /** False when the speaker was only supplied by the model. */
  speakerInSource?: boolean;
  sourceTitle?: string;
  sourceSite?: string;
  channelName?: string;
  /** Clock where the quote starts, for example "at 1:52:27". */
  atLabel?: string;
}>;

function quoteWords(quote: string) {
  return quote
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}’']+/u)
    .map((word) => word.trim())
    .filter(Boolean);
}

function encodeFragmentWord(word: string) {
  return encodeURIComponent(word).replace(/-/g, "%2D");
}

function isYouTubeUrl(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return (
      host === "youtu.be" ||
      host === "youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "youtube-nocookie.com" ||
      host.endsWith(".youtube-nocookie.com")
    );
  } catch {
    return false;
  }
}

/** YouTube keeps its &t= link. A web page scrolls to the quote. */
export function foundSpotUrl(sourceUrl: string, quote: string) {
  if (isYouTubeUrl(sourceUrl)) return sourceUrl;
  const words = quoteWords(quote);
  if (words.length < 2) return sourceUrl;
  const headCount = Math.min(5, words.length);
  const tailCount = Math.min(5, words.length);
  const head = words.slice(0, headCount);
  const tail = words.slice(-tailCount);
  const same = words.length <= 8 || head.join(" ") === tail.join(" ");
  const text = same
    ? head.map(encodeFragmentWord).join("%20")
    : `${head.map(encodeFragmentWord).join("%20")},${tail.map(encodeFragmentWord).join("%20")}`;
  const base = sourceUrl.split("#")[0] ?? sourceUrl;
  return `${base}#:~:text=${text}`;
}

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
