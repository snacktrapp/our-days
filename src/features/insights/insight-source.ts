const httpsUrlPattern = /^https:\/\/[^\s<>"]+$/u;

export function parseInsightSourceUrl(
  value: unknown,
): { ok: true; url: string | null } | { ok: false } {
  if (value == null || value === "") return { ok: true, url: null };
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, url: null };
  if (trimmed.length < 12 || trimmed.length > 2000) return { ok: false };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false };
  }
  if (parsed.protocol !== "https:" || !httpsUrlPattern.test(trimmed)) {
    return { ok: false };
  }
  return { ok: true, url: trimmed };
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

export function validInsightQuote(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= 4000
  );
}

export function validInsightAttribution(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= 160
  );
}
