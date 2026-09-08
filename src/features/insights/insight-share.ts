export type ShareInsightAction = (input: {
  momentId: string;
  circleIds: readonly string[];
}) => Promise<{ ok: boolean; message: string; momentId?: string }>;

export const sharedInsightBodyPrefix = "OD:insight-share\n";

export type SharedInsightMoment = Readonly<{
  quote: string;
  attribution: string;
}>;

export function formatSharedInsightMoment(quote: string, attribution: string) {
  return `${sharedInsightBodyPrefix}${quote.trim()}\n\n— ${attribution.trim()}`;
}

const sharedInsightPattern = /^OD:insight-share\n([\s\S]+)\n\n— ([^\n]+)$/u;

export function parseSharedInsightMoment(
  body: string,
): SharedInsightMoment | null {
  const match = sharedInsightPattern.exec(body);
  if (!match) return null;
  const quote = match[1]?.trim() ?? "";
  const attribution = match[2]?.trim() ?? "";
  if (!quote || !attribution) return null;
  return { quote, attribution };
}
