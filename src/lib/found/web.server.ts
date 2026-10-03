import "server-only";

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const pageByteLimit = 1_500_000;
const textLimit = 200_000;
const redirectLimit = 4;

const blocked = new BlockList();
blocked.addSubnet("0.0.0.0", 8, "ipv4");
blocked.addSubnet("10.0.0.0", 8, "ipv4");
blocked.addSubnet("100.64.0.0", 10, "ipv4");
blocked.addSubnet("127.0.0.0", 8, "ipv4");
blocked.addSubnet("169.254.0.0", 16, "ipv4");
blocked.addSubnet("172.16.0.0", 12, "ipv4");
blocked.addSubnet("192.0.0.0", 24, "ipv4");
blocked.addSubnet("192.0.2.0", 24, "ipv4");
blocked.addSubnet("192.168.0.0", 16, "ipv4");
blocked.addSubnet("198.18.0.0", 15, "ipv4");
blocked.addSubnet("198.51.100.0", 24, "ipv4");
blocked.addSubnet("203.0.113.0", 24, "ipv4");
blocked.addSubnet("224.0.0.0", 4, "ipv4");
blocked.addSubnet("240.0.0.0", 4, "ipv4");
blocked.addAddress("::", "ipv6");
blocked.addAddress("::1", "ipv6");
blocked.addSubnet("fc00::", 7, "ipv6");
blocked.addSubnet("fe80::", 10, "ipv6");
blocked.addSubnet("ff00::", 8, "ipv6");

export function isBlockedAddress(address: string) {
  const version = isIP(address);
  if (version === 4) return blocked.check(address, "ipv4");
  if (version !== 6) return true;
  const mapped = /(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/iu.exec(address);
  if (mapped?.[1]) return isBlockedAddress(mapped[1]);
  return blocked.check(address, "ipv6");
}

function blockedHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/u, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal"
  ) {
    return true;
  }
  if (isIP(host)) return isBlockedAddress(host);
  return false;
}

export async function isPublicHttpsUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (blockedHostname(url.hostname)) return null;
  if (isIP(url.hostname)) return isBlockedAddress(url.hostname) ? null : url;
  try {
    const records = await lookup(url.hostname, { all: true, verbatim: true });
    if (records.length === 0) return null;
    if (records.some((record) => isBlockedAddress(record.address))) return null;
  } catch {
    return null;
  }
  return url;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, digits: string) => {
      const code = Number(digits);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, digits: string) => {
      const code = Number.parseInt(digits, 16);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(tag: string) {
  const match = tag.match(
    /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i,
  );
  return decodeHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}

function metaByName(html: string, name: string) {
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  const pattern = new RegExp(
    `\\b(?:property|name)\\s*=\\s*["']${name}["']`,
    "i",
  );
  for (const tag of metas) {
    if (!pattern.test(tag)) continue;
    const content = metaContent(tag).slice(0, 200);
    if (content) return content;
  }
  return undefined;
}

/** og:title when the page published one, otherwise the document title. */
export function pageTitleFromHtml(html: string) {
  const titled = metaByName(html, "og:title");
  if (titled) return titled;
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (!title?.[1]) return undefined;
  const text = decodeHtmlEntities(title[1].replace(/<[^>]+>/g, " ")).slice(
    0,
    200,
  );
  return text || undefined;
}

export function pageSiteNameFromHtml(html: string) {
  return metaByName(html, "og:site_name");
}

/** Drop a leading "Transcript for" and a trailing " - <site>" from a page title. */
export function publisherDisplayTitle(title: string, siteName?: string) {
  let text = title.trim().replace(/\s+/g, " ");
  text = text.replace(/^transcript\s+for\b\s*/iu, "").trim();
  const site = siteName?.trim().replace(/\s+/g, " ");
  if (site) {
    const suffix = ` - ${site}`;
    if (text.toLowerCase().endsWith(suffix.toLowerCase())) {
      text = text.slice(0, -suffix.length).trim();
    }
  }
  return text.slice(0, 200) || undefined;
}

export function htmlToFoundText(html: string) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, digits: string) => {
      const code = Number(digits);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, digits: string) => {
      const code = Number.parseInt(digits, 16);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, textLimit);
}

export type PublicPageRead = Readonly<{
  host?: string;
  fetchStatus: "ok" | "empty" | "blocked" | "http";
  httpStatus?: number;
  page: { url: string; text: string; html: string } | null;
}>;

function pageHost(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}

export async function readPublicPage(
  value: string,
  signal: AbortSignal,
): Promise<PublicPageRead> {
  let current = value;
  for (let hop = 0; hop <= redirectLimit; hop += 1) {
    const host = pageHost(current);
    const url = await isPublicHttpsUrl(current);
    if (!url)
      return { ...(host ? { host } : {}), fetchStatus: "blocked", page: null };
    if (signal.aborted) {
      return { host: url.hostname, fetchStatus: "empty", page: null };
    }
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal,
        headers: {
          accept: "text/html, text/plain;q=0.9",
          "user-agent": "OurDaysFound/1.0",
        },
      });
    } catch {
      return { host: url.hostname, fetchStatus: "empty", page: null };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return {
          host: url.hostname,
          fetchStatus: "http",
          httpStatus: response.status,
          page: null,
        };
      }
      current = new URL(location, url).toString();
      continue;
    }
    if (!response.ok) {
      return {
        host: url.hostname,
        fetchStatus: "http",
        httpStatus: response.status,
        page: null,
      };
    }
    const type = (response.headers.get("content-type") ?? "").toLowerCase();
    if (
      type &&
      !type.includes("text/html") &&
      !type.includes("text/plain") &&
      !type.includes("application/xhtml+xml")
    ) {
      return {
        host: url.hostname,
        fetchStatus: "empty",
        httpStatus: response.status,
        page: null,
      };
    }
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > pageByteLimit) {
      return { host: url.hostname, fetchStatus: "empty", page: null };
    }
    const body = await response.text();
    if (body.length > pageByteLimit) {
      return { host: url.hostname, fetchStatus: "empty", page: null };
    }
    const text = htmlToFoundText(body);
    if (text.length < 40) {
      return { host: url.hostname, fetchStatus: "empty", page: null };
    }
    return {
      host: url.hostname,
      fetchStatus: "ok",
      httpStatus: response.status,
      page: { url: url.toString(), text, html: body },
    };
  }
  return {
    ...(pageHost(current) ? { host: pageHost(current) } : {}),
    fetchStatus: "empty",
    page: null,
  };
}

export async function fetchPublicPage(value: string, signal: AbortSignal) {
  const read = await readPublicPage(value, signal);
  return read.page;
}
