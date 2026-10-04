import type { Session } from "@supabase/supabase-js";

const MAX_CHUNK_SIZE = 3180;
const BASE64_PREFIX = "base64-";
const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * UTF-8 base64url without padding. Matches @supabase/ssr stringToBase64URL
 * for the session JSON the web cookie client stores.
 */
export function stringToBase64URL(value: string) {
  const bytes = new TextEncoder().encode(value);
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = index + 1 < bytes.length ? (bytes[index + 1] ?? 0) : 0;
    const third = index + 2 < bytes.length ? (bytes[index + 2] ?? 0) : 0;
    const triple = (first << 16) | (second << 8) | third;
    output += ALPHABET[(triple >> 18) & 63];
    output += ALPHABET[(triple >> 12) & 63];
    if (index + 1 < bytes.length) output += ALPHABET[(triple >> 6) & 63];
    if (index + 2 < bytes.length) output += ALPHABET[triple & 63];
  }
  return output;
}

/**
 * Same chunk boundaries as @supabase/ssr createChunks. The web media routes
 * read the session from these cookies and ignore an Authorization header.
 */
export function createChunks(
  key: string,
  value: string,
  chunkSize = MAX_CHUNK_SIZE,
) {
  let encodedValue = encodeURIComponent(value);
  if (encodedValue.length <= chunkSize) {
    return [{ name: key, value }];
  }

  const chunks: string[] = [];
  while (encodedValue.length > 0) {
    let encodedChunkHead = encodedValue.slice(0, chunkSize);
    const lastEscapePos = encodedChunkHead.lastIndexOf("%");
    if (lastEscapePos > chunkSize - 3) {
      encodedChunkHead = encodedChunkHead.slice(0, lastEscapePos);
    }

    let valueHead = "";
    while (encodedChunkHead.length > 0) {
      try {
        valueHead = decodeURIComponent(encodedChunkHead);
        break;
      } catch (error) {
        if (
          error instanceof URIError &&
          encodedChunkHead.at(-3) === "%" &&
          encodedChunkHead.length > 3
        ) {
          encodedChunkHead = encodedChunkHead.slice(
            0,
            encodedChunkHead.length - 3,
          );
        } else {
          throw error;
        }
      }
    }

    chunks.push(valueHead);
    encodedValue = encodedValue.slice(encodedChunkHead.length);
  }

  return chunks.map((chunkValue, index) => ({
    name: `${key}.${index}`,
    value: chunkValue,
  }));
}

export function sessionCookieHeader(storageKey: string, session: Session) {
  const encoded = BASE64_PREFIX + stringToBase64URL(JSON.stringify(session));
  return createChunks(storageKey, encoded)
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
}
