import * as SecureStore from "expo-secure-store";
import type { SupportedStorage } from "@supabase/supabase-js";

/**
 * Stay under the historical SecureStore value limit of 2048 bytes. Measured in
 * UTF-8 bytes, not UTF-16 code units, so non-ASCII names cannot overflow.
 */
const CHUNK_BYTES = 1800;
const MAX_CHUNKS = 32;

function utf8Length(codePoint: number) {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/** Split on code point boundaries so each piece is at most maxBytes of UTF-8. */
export function splitUtf8(value: string, maxBytes = CHUNK_BYTES) {
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of value) {
    const size = utf8Length(char.codePointAt(0) ?? 0);
    if (bytes + size > maxBytes && current.length > 0) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  if (current.length > 0 || parts.length === 0) parts.push(current);
  return parts;
}

async function readChunk(key: string) {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function removeChunk(key: string) {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Missing keys reject on some OS versions. The slot is already empty.
  }
}

async function clearChunks(key: string) {
  for (let index = 0; index < MAX_CHUNKS; index += 1) {
    const chunkKey = `${key}.${index}`;
    const existing = await readChunk(chunkKey);
    if (existing == null) break;
    await removeChunk(chunkKey);
  }
}

/**
 * Supabase session JSON is larger than one SecureStore value.
 * Chunks use the same key alphabet SecureStore allows (letters, digits, ., -, _).
 */
export const secureSessionStorage: SupportedStorage = {
  async getItem(key) {
    const single = await readChunk(key);
    if (single != null) return single;

    const parts: string[] = [];
    for (let index = 0; index < MAX_CHUNKS; index += 1) {
      const part = await readChunk(`${key}.${index}`);
      if (part == null) break;
      parts.push(part);
    }
    return parts.length > 0 ? parts.join("") : null;
  },

  async setItem(key, value) {
    const parts = splitUtf8(value);
    if (parts.length > MAX_CHUNKS) {
      throw new Error(`Session is too large to store (${parts.length} chunks)`);
    }
    if (parts.length === 1) {
      await SecureStore.setItemAsync(key, value);
      await clearChunks(key);
      return;
    }

    await removeChunk(key);
    const count = parts.length;
    for (let index = 0; index < count; index += 1) {
      await SecureStore.setItemAsync(`${key}.${index}`, parts[index] ?? "");
    }
    for (let index = count; index < MAX_CHUNKS; index += 1) {
      const chunkKey = `${key}.${index}`;
      const existing = await readChunk(chunkKey);
      if (existing == null) break;
      await removeChunk(chunkKey);
    }
  },

  async removeItem(key) {
    await removeChunk(key);
    await clearChunks(key);
  },
};
