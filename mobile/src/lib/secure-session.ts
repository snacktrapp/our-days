import * as SecureStore from "expo-secure-store";
import type { SupportedStorage } from "@supabase/supabase-js";

/** Stay under the historical iOS keychain value limit of about 2048 bytes. */
const CHUNK = 1800;

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
  for (let index = 0; index < 32; index += 1) {
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
    for (let index = 0; index < 32; index += 1) {
      const part = await readChunk(`${key}.${index}`);
      if (part == null) break;
      parts.push(part);
    }
    return parts.length > 0 ? parts.join("") : null;
  },

  async setItem(key, value) {
    if (value.length <= CHUNK) {
      await SecureStore.setItemAsync(key, value);
      await clearChunks(key);
      return;
    }

    await removeChunk(key);
    const count = Math.ceil(value.length / CHUNK);
    for (let index = 0; index < count; index += 1) {
      await SecureStore.setItemAsync(
        `${key}.${index}`,
        value.slice(index * CHUNK, (index + 1) * CHUNK),
      );
    }
    for (let index = count; index < 32; index += 1) {
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
