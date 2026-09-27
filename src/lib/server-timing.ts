const inflight = new Map<string, Headers>();
const maxTrackedDocuments = 100;

export const requestTimingHeader = "x-our-days-rid";

function metricPrefix(name: string) {
  return `${name};dur=`;
}

export function upsertServerTiming(headers: Headers, name: string, ms: number) {
  const duration = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const parts = (headers.get("server-timing") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith(metricPrefix(name)));
  parts.push(`${name};dur=${duration.toFixed(1)}`);
  headers.set("server-timing", parts.join(", "));
}

export function trackDocumentHeaders(id: string, headers: Headers) {
  inflight.set(id, headers);
  while (inflight.size > maxTrackedDocuments) {
    const oldest = inflight.keys().next().value;
    if (!oldest) break;
    inflight.delete(oldest);
  }
}

export function trackedTimingDocumentCount() {
  return inflight.size;
}

export function recordPageDataTiming(id: string, ms: number) {
  const headers = inflight.get(id);
  if (!headers) return;
  const current = (headers.get("server-timing") ?? "")
    .split(",")
    .map((part) => part.trim())
    .find((part) => part.startsWith(metricPrefix("db")));
  const previous = current
    ? Number(current.slice(metricPrefix("db").length))
    : 0;
  upsertServerTiming(headers, "db", previous + ms);
}
